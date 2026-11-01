package Gyroid.Services

import Gyroid.Models
import System
import System.Diagnostics
import System.Globalization
import System.IO
import System.Net.Http
import System.Reflection
import System.Runtime.InteropServices
import System.Text.Json
import System.Threading
import System.Threading.Tasks

@DllImport("libc", EntryPoint: "kill")
func SignalWalletDaemon(processId int32, signal int32) int32;

class NodeSupervisor : IDisposable {
    var process Process? = nil
    let ownership Object = Object()
    let shutdown CancellationTokenSource = CancellationTokenSource()
    var disposed bool
    var lease FileStream? = nil
    var nextStart DateTimeOffset
    var Progress Action? = nil
    var Exited Action? = nil
    var Source string = "External"
    var Executable string = ""
    var Phase NodePhase = NodePhase.None
    var DownloadPercent int32?
    var CheckpointHeight uint64

    prop NeedsRestart bool -> process != nil && !Owned

    prop Owned bool {
        get {
            lock ownership {
                return process != nil && !process!!.HasExited
            }
        }
    }

    async func ConnectAsync(settings WalletSettings, cancellation CancellationToken) {
        try {
            await ConnectCoreAsync(settings, cancellation)
        } finally {
            ReportProgress(NodePhase.None, nil)
        }
    }

    private async func ConnectCoreAsync(settings WalletSettings, cancellation CancellationToken) {
        using let stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation, shutdown.Token)
        let ct = stop.Token
        ct.ThrowIfCancellationRequested()
        SettingsValidation.Validate(settings)
        if await TryAttachAsync(settings, ct) {
            return
        }
        if Owned {
            throw WalletException("Owned daemon is running but its API is not ready")
        }
        if settings.BinaryPath.Length == 0 || settings.BinaryPath == CoreRelease.InstallationPath() && !File.Exists(
            settings.BinaryPath
        ) {
            settings.BinaryPath = await CoreRelease.DownloadAsync(
                value -> {
                    int32.TryParse(value.TrimEnd('%'), out let percent)
                    ReportProgress(NodePhase.Core, percent)
                },
                ct
            )
        }
        let program = NodeDiscovery.ProgramError(settings.BinaryPath)
        if program.Length > 0 {
            throw WalletException(program)
        }
        Directory.CreateDirectory(settings.DataDirectory)
        let installed = settings.DataDirectory == settings.DiscoveredDataDirectory
        if !installed {
            EnsureOwnedData(settings)
            PrivateFiles.ProtectDirectory(settings.DataDirectory)
        }
        let walletsExist = Directory.Exists(settings.WalletDirectory)
        Directory.CreateDirectory(settings.WalletDirectory)
        if !walletsExist {
            PrivateFiles.ProtectDirectory(settings.WalletDirectory)
        }
        if !OperatingSystem.IsWindows() {
            if !installed {
                File.SetUnixFileMode(
                    settings.DataDirectory,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                )
            }
            if !walletsExist {
                File.SetUnixFileMode(
                    settings.WalletDirectory,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                )
            }
        }
        if DateTimeOffset.UtcNow < nextStart {
            throw WalletException("Node is restarting. Try again shortly")
        }
        Stop()
        ReportProgress(NodePhase.Starting, nil)
        for attempt in 0 ... 120 {
            ct.ThrowIfCancellationRequested()
            try {
                lease = FileStream(
                    Path.Combine(settings.DataDirectory, "gyroid.lock"),
                    FileStreamOptions{Mode: FileMode.OpenOrCreate, Access: FileAccess.ReadWrite, Share: FileShare.None}
                )
                break
            } catch (error IOException) {
                if await ReachableAsync(settings.Endpoint, ct) {
                    Attach(settings)
                    return
                }
                await Task.Delay(250, ct)
            }
        }
        if lease == nil {
            throw WalletException("Node is starting in another Gyroid process")
        }
        if await ReachableAsync(settings.Endpoint, ct) {
            lease?.Dispose()
            lease = nil
            Attach(settings)
            return
        }
        let trusted = await SaveCheckpointsAsync(settings, ct)
        await SaveCoreSettingsAsync(settings, !trusted, ct)
        ReportProgress(NodePhase.Starting, nil)
        let endpoint = Uri(settings.Endpoint)
        let start = ProcessStartInfo{
            FileName: settings.BinaryPath,
            WorkingDirectory: settings.DataDirectory,
            UseShellExecute: false,
            CreateNoWindow: true,
            RedirectStandardOutput: true,
            RedirectStandardError: true,
            RedirectStandardInput: true
        }
        settings.OwnedProcessId = 0
        if OperatingSystem.IsWindows() {
            start.FileName = Environment.ProcessPath ?? throw WalletException("Application executable is unavailable")
            start.ArgumentList.Add("--owned-core")
            start.ArgumentList.Add(settings.BinaryPath)
        }
        start.ArgumentList.Add("--data")
        start.ArgumentList.Add(settings.DataDirectory)
        start.ArgumentList.Add("--api")
        start.ArgumentList.Add(endpoint.Authority)
        if settings.Network == "testnet" {
            start.ArgumentList.Add("--testnet")
        }
        start.Environment["HOME"] = Path.Combine(settings.DataDirectory, "home")
        start.Environment["USERPROFILE"] = Path.Combine(settings.DataDirectory, "home")
        start.Environment["XDG_CONFIG_HOME"] = Path.Combine(settings.DataDirectory, "config")
        start.Environment["XDG_DATA_HOME"] = settings.DataDirectory
        start.Environment["APPDATA"] = Path.Combine(settings.DataDirectory, "config")
        start.Environment["LOCALAPPDATA"] = settings.DataDirectory
        start.Environment["BLOCKNET_P2P_KEY"] = Path.Combine(settings.DataDirectory, "identity.key")
        start.Environment.Remove("BLOCKNET_VIEW_PRIV")
        stop.CancelAfter(TimeSpan.FromSeconds(60))
        try {
            lock ownership {
                ct.ThrowIfCancellationRequested()
                if disposed {
                    throw WalletException("Daemon owner is closed")
                }
                nextStart = DateTimeOffset.UtcNow.AddSeconds(2)
                process = Process.Start(start)
            }
            let owned = process
            if owned == nil {
                throw WalletException("Could not start the configured core executable")
            }
            settings.OwnedProcessId = if OperatingSystem.IsWindows() {
                int32.Parse(await owned.StandardOutput.ReadLineAsync(ct) ?? "0", CultureInfo.InvariantCulture)
            } else {
                owned.Id
            }
            Executable = settings.BinaryPath
            Source = if Executable == settings.LauncherBinaryPath {
                "Launcher"
            } else {
                "Gyroid"
            }
            if !OperatingSystem.IsWindows() {
                owned.StandardInput.Close()
            }
            owned.StandardOutput.BaseStream.CopyToAsync(Stream.Null)
            owned.StandardError.BaseStream.CopyToAsync(Stream.Null)
            owned.Exited += (_, _) -> {
                if Object.ReferenceEquals(process, owned) && !disposed {
                    Exited?.Invoke()
                }
            }
            owned.EnableRaisingEvents = true
            using let core = Process.GetProcessById(settings.OwnedProcessId)
            var processorTime = core.TotalProcessorTime
            while !owned.HasExited {
                core.Refresh()
                let currentProcessorTime = core.TotalProcessorTime
                if currentProcessorTime > processorTime {
                    processorTime = currentProcessorTime
                    stop.CancelAfter(TimeSpan.FromSeconds(60))
                }
                if await ReachableAsync(settings.Endpoint, ct) {
                    Attach(settings)
                    return
                }
                await Task.Delay(250, ct)
            }
            throw WalletException("Configured core exited before its API became ready")
        } catch (error Exception) {
            Stop()
            if error is OperationCanceledException &&
                !cancellation.IsCancellationRequested &&
                !shutdown.IsCancellationRequested {
                throw WalletException("Core startup timed out")
            }
            if error is WalletException {
                throw error
            }
            throw WalletException("Could not start the configured core executable")
        }
    }

    private func UseInstallation(settings WalletSettings) {
        settings.BinaryPath = settings.DiscoveredBinaryPath
        settings.DataDirectory = settings.DiscoveredDataDirectory
        settings.Endpoint = settings.DiscoveredEndpoint
        settings.WalletDirectory = Path.GetDirectoryName(settings.DiscoveredWalletFile) ??
            throw WalletException("Installed wallet file must have a parent directory")
        settings.ActiveWallet = Path.GetFileName(settings.DiscoveredWalletFile)
        SettingsValidation.Validate(settings)
    }

    private func Attach(settings WalletSettings) {
        let pid = CoreProcess.Listener(Uri(settings.Endpoint))
        CoreProcess.VerifyIdentity(pid, settings.BinaryPath, settings.DiscoveredBinaryPath)
        let executable = CoreProcess.ProcessExecutable(pid)
        Executable = if OperatingSystem.IsLinux() {
            File.ResolveLinkTarget(executable, true)?.FullName ?? executable
        } else {
            executable
        }
        CoreProcess.VerifyNetwork(pid, settings.Network)
        if !Owned {
            settings.OwnedProcessId = 0
        } else if settings.OwnedProcessId != pid {
            throw WalletException("API listener is not the app-owned core process")
        }
        Source = if Executable == settings.LauncherBinaryPath {
            "Launcher"
        } else if Owned {
            "Gyroid"
        } else {
            "External"
        }
    }

    async func TryAttachAsync(settings WalletSettings, ct CancellationToken) bool {
        if await ReachableAsync(settings.Endpoint, ct) {
            Attach(settings)
            return true
        }
        if settings.NodeMode == "manual" {
            throw WalletException("Node is not running. Manual mode never starts or downloads a core")
        }
        if settings.DiscoveredEndpoint.Length > 0 && settings.DiscoveredEndpoint != settings.Endpoint {
            let installation = settings.Copy()
            UseInstallation(installation)
            if await ReachableAsync(installation.Endpoint, ct) {
                Attach(installation)
                UseInstallation(settings)
                settings.OwnedProcessId = 0
                return true
            }
        }
        if OperatingSystem.IsLinux() || OperatingSystem.IsWindows() {
            for candidate in Process.GetProcesses() {
                using let current = candidate
                try {
                    if !current.ProcessName.StartsWith("blocknet", StringComparison.Ordinal) {
                        continue
                    }
                    let arguments = CoreProcess.Arguments(current.Id)
                    var endpoint = ""
                    var data = ""
                    for index in 0 ... arguments.Length {
                        if index + 1 < arguments.Length {
                            if arguments[index] == "--api" || arguments[index] == "-api" {
                                endpoint = arguments[index + 1]
                            } else if arguments[index] == "--data" || arguments[index] == "-data" {
                                data = arguments[index + 1]
                            }
                        }
                        if arguments[index].StartsWith("--api=", StringComparison.Ordinal) {
                            endpoint = arguments[index].Substring(6)
                        } else if arguments[index].StartsWith("--data=", StringComparison.Ordinal) {
                            data = arguments[index].Substring(7)
                        }
                    }
                    if CoreProcess.IsTestnet(arguments) != (settings.Network == "testnet") ||
                        endpoint.Length == 0 ||
                        !Path.IsPathFullyQualified(data) {
                        continue
                    }
                    if Path.GetFullPath(data) != Path.GetFullPath(settings.DataDirectory) &&
                        (
                        settings.DiscoveredDataDirectory.Length == 0 || Path.GetFullPath(data) != Path.GetFullPath(
                            settings.DiscoveredDataDirectory
                        )
                    ) {
                        continue
                    }
                    let discovered = settings.Copy()
                    discovered.Endpoint = "http://" + endpoint + "/"
                    discovered.DataDirectory = data
                    SettingsValidation.Validate(discovered)
                    if !await ReachableAsync(discovered.Endpoint, ct) {
                        continue
                    }
                    Attach(discovered)
                    settings.Endpoint = discovered.Endpoint
                    settings.DataDirectory = data
                    return true
                } catch (error Exception) {
                    if error is OperationCanceledException {
                        throw error
                    }
                }
            }
        }
        return false
    }

    private func EnsureOwnedData(settings WalletSettings) {
        let marker = Path.Combine(settings.DataDirectory, "gyroid.owner")
        let identity = "Gyroid:" + settings.Network
        if File.Exists(marker) {
            if PrivateFiles.ReadText(marker, 1024) != identity {
                throw WalletException("Data directory ownership marker is invalid")
            }
            return
        }
        for entry in Directory.EnumerateFileSystemEntries(settings.DataDirectory) {
            if Path.GetFullPath(entry) != Path.GetFullPath(settings.WalletDirectory) || !Directory.Exists(entry) {
                throw WalletException(
                    "Choose a new app-owned data directory. Existing unmanaged core data will not be modified"
                )
            }
        }
        using let stream = PrivateFiles.CreatePrivate(marker)
        let bytes = System.Text.Encoding.ASCII.GetBytes(identity)
        stream.Write(bytes, 0, bytes.Length)
        stream.Flush(true)
    }

    func ReportProgress(phase NodePhase, percent int32?) {
        Phase = phase
        DownloadPercent = percent
        Progress?.Invoke()
    }

    private async func SaveCheckpointsAsync(settings WalletSettings, ct CancellationToken) bool {
        if settings.Network != "mainnet" {
            return false
        }
        let path = Path.Combine(settings.DataDirectory, "checkpoints.dat")
        using let resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("Gyroid.Checkpoints.Mainnet") ??
            throw WalletException("Mainnet checkpoints are missing")
        let baseline = [int32(resource.Length)]uint8
        resource.ReadExactly(baseline, 0, baseline.Length)
        if File.Exists(path) && FileInfo(path).Length <= 1048576 {
            let existing = Checkpoints.Parse(System.Text.Encoding.UTF8.GetBytes(PrivateFiles.ReadText(path, 1048576)))
            let trusted = Checkpoints.Parse(baseline)
            if Checkpoints.Height(existing) >= Checkpoints.Height(trusted) && Checkpoints.Extends(trusted, existing) {
                CheckpointHeight = Checkpoints.Height(existing)
                return true
            }
        }
        ReportProgress(NodePhase.Checkpoints, 0)
        using let deadline = CancellationTokenSource.CreateLinkedTokenSource(ct)
        deadline.CancelAfter(TimeSpan.FromSeconds(5))
        let downloaded = await Checkpoints.FetchAsync(
            (count, length) -> ReportProgress(
                NodePhase.Checkpoints,
                if length > 0 {
                    int32(Math.Min(100L, count * 100 / length))
                } else {
                    nil
                }
            ),
            ct,
            deadline.Token
        )
        let selected = Checkpoints.Select(baseline, downloaded)
        await PrivateFiles.WriteAtomic(path, stream -> stream.WriteAsync(selected, 0, selected.Length, ct), true, false)
        CheckpointHeight = Checkpoints.Height(Checkpoints.Parse(selected))
        ReportProgress(NodePhase.Checkpoints, 100)
        return true
    }

    private async func SaveCoreSettingsAsync(settings WalletSettings, fullSync bool, ct CancellationToken) {
        let path = Path.Combine(settings.DataDirectory, "settings.json")
        if path == SettingsStore.ConfigurationPath() {
            throw WalletException("Application and core settings must use different files")
        }
        using let original = JsonDocument.Parse(
            if File.Exists(path) {
                PrivateFiles.ReadText(path, 65536)
            } else {
                "{}"
            }
        )
        if original.RootElement.ValueKind != JsonValueKind.Object {
            throw WalletException("Core settings must be a JSON object")
        }
        let syncEnabled = fullSync || original.RootElement.TryGetProperty("full_sync", out let configuredSync) &&
            configuredSync.ValueKind == JsonValueKind.True
        let installed = settings.DataDirectory == settings.DiscoveredDataDirectory
        var walletFile = Path.Combine(
            settings.WalletDirectory,
            if settings.ActiveWallet.Length > 0 {
                settings.ActiveWallet
            } else {
                "default.wallet.dat"
            }
        )
        let configuredWallet = NodeJson.Text(original.RootElement, "wallet_file")
        if settings.ActiveWallet.Length == 0 && Path.IsPathFullyQualified(configuredWallet) && File.Exists(
            configuredWallet
        ) &&
            Path.GetRelativePath(settings.WalletDirectory, configuredWallet) == Path.GetFileName(configuredWallet) {
            WalletValidation.ValidateFilename(Path.GetFileName(configuredWallet))
            walletFile = configuredWallet
        }
        if configuredWallet == walletFile && original.RootElement.TryGetProperty("full_sync", out let sync) &&
            (sync.ValueKind == JsonValueKind.True || sync.ValueKind == JsonValueKind.False) &&
            sync.GetBoolean() == syncEnabled &&
            (installed || NodeJson.Text(original.RootElement, "listen") == settings.ListenAddress) {
            return
        }
        try {
            await PrivateFiles.WriteAtomic(
                path,
                async (stream) -> {
                    using let writer = Utf8JsonWriter(stream)
                    writer.WriteStartObject()
                    for field in original.RootElement.EnumerateObject() {
                        if field.Name != "wallet_file" &&
                            field.Name != "full_sync" &&
                            (installed || field.Name != "listen") {
                            field.WriteTo(writer)
                        }
                    }
                    writer.WriteString("wallet_file", walletFile)
                    if !installed {
                        writer.WriteString("listen", settings.ListenAddress)
                    }
                    writer.WriteBoolean("full_sync", syncEnabled)
                    writer.WriteEndObject()
                    await writer.FlushAsync(ct)
                },
                true,
                false
            )
        } catch (error JsonException) {
            throw WalletException("Core settings could not be parsed")
        }
    }

    private async func ReachableAsync(endpoint string, ct CancellationToken) bool {
        using let stop = CancellationTokenSource.CreateLinkedTokenSource(ct)
        stop.CancelAfter(TimeSpan.FromSeconds(2))
        using let http = HttpClient(SocketsHttpHandler{AllowAutoRedirect: false, UseProxy: false})
        try {
            using let response = await http.GetAsync(
                Uri(Uri(endpoint), "api/health"),
                HttpCompletionOption.ResponseHeadersRead,
                stop.Token
            )
            return true
        } catch (error HttpRequestException) {
            return false
        } catch (error OperationCanceledException) {
            ct.ThrowIfCancellationRequested()
            return false
        }
    }

    func Stop() {
        var stopped Process? = nil
        lock ownership {
            stopped = process
            process = nil
        }
        if let owned = stopped {
            try {
                if !owned.HasExited {
                    if OperatingSystem.IsWindows() {
                        owned.StandardInput.Close()
                    } else {
                        SignalWalletDaemon(owned.Id, 15)
                    }
                    if !owned.WaitForExit(7000) {
                        owned.Kill(true)
                        owned.WaitForExit(2000)
                    }
                }
            } catch (error InvalidOperationException) { } finally {
                owned.Dispose()
            }
        }
        lease?.Dispose()
        lease = nil
    }

    func Dispose() {
        lock ownership {
            disposed = true
        }
        shutdown.Cancel()
        Stop()
    }
}
