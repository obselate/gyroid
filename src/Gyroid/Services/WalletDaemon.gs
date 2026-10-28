package Gyroid.Services

import Gyroid.Model
import Microsoft.Win32.SafeHandles
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.IO
import System.IO.Compression
import System.Net.Http
import System.Reflection
import System.Runtime.InteropServices
import System.Security.Cryptography
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

@DllImport("libc", EntryPoint: "kill")
func SignalWalletDaemon(processId int32, signal int32) int32;

@DllImport("libc", EntryPoint: "open", SetLastError: true)
func OpenWalletFile(path string, flags int32) int32;

@DllImport("libc", EntryPoint: "fsync", SetLastError: true)
func FlushWalletDirectory(fd int32) int32;

@DllImport("libc", EntryPoint: "fstat", SetLastError: true)
func StatWalletFile(fd int32, buffer IntPtr) int32;

@DllImport("libc", EntryPoint: "fstat$$INODE64", SetLastError: true)
func StatWalletFileInode64(fd int32, buffer IntPtr) int32;

@DllImport("libc", EntryPoint: "geteuid")
func WalletUserId() uint32;

@DllImport("kernel32.dll", EntryPoint: "CreateFileW", CharSet: CharSet.Unicode, SetLastError: true)
func OpenWindowsWalletFile(
    path string,
    access uint32,
    share uint32,
    security IntPtr,
    disposition uint32,
    flags uint32,
    template IntPtr
) SafeFileHandle;

@DllImport("iphlpapi.dll", EntryPoint: "GetExtendedTcpTable")
func WalletTcpTable(table IntPtr, ref size int32, order bool, family int32, kind int32, reserved uint32) uint32;

@DllImport("kernel32.dll", EntryPoint: "OpenProcess", SetLastError: true)
func OpenWalletProcess(access uint32, inherit bool, pid int32) IntPtr;

@DllImport("kernel32.dll", EntryPoint: "QueryFullProcessImageNameW", CharSet: CharSet.Unicode, SetLastError: true)
func WalletProcessPath(process IntPtr, flags uint32, path IntPtr, ref size int32) bool;

@DllImport("kernel32.dll", EntryPoint: "CloseHandle")
func CloseWalletHandle(handle IntPtr) bool;

@DllImport("libproc", EntryPoint: "proc_pidpath")
func WalletMacProcessPath(pid int32, path[]uint8, size uint32) int32;

class WalletDaemon : IDisposable {
    var process Process? = nil
    let ownership Object = Object()
    let shutdown CancellationTokenSource = CancellationTokenSource()
    var disposed bool
    var lease FileStream? = nil
    var nextStart DateTimeOffset
    var termination PosixSignalRegistration? = nil
    var Progress Action[string]? = nil
    var Exited Action? = nil
    var Source string = "External"
    var Executable string = ""
    var Phase string = ""
    var DownloadPercent int32?
    var TrustedCheckpoints bool?

    init() {
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit
        if !OperatingSystem.IsWindows() {
            termination = PosixSignalRegistration.Create(PosixSignal.SIGTERM, _ -> Dispose())
        }
    }

    private func OnProcessExit(sender Object?, args EventArgs) -> Dispose()

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
            ReportProgress("", nil)
        }
    }

    private async func ConnectCoreAsync(settings WalletSettings, cancellation CancellationToken) {
        using let stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation, shutdown.Token)
        let ct = stop.Token
        ct.ThrowIfCancellationRequested()
        settings.Validate()
        if await TryAttachAsync(settings, ct) {
            return
        }
        if Owned {
            throw WalletException("Owned daemon is running but its API is not ready")
        }
        if settings.NodeMode == "manual" {
            throw WalletException("Node is not running. Manual mode never starts or downloads a core")
        }
        if settings.BinaryPath.Length == 0 || settings.BinaryPath == WalletCore.InstallationPath() && !File.Exists(
            settings.BinaryPath
        ) {
            settings.BinaryPath = await WalletCore.DownloadAsync(
                value -> {
                    int32.TryParse(value.TrimEnd('%'), out let percent)
                    ReportProgress("Core", percent)
                },
                ct
            )
        }
        let program = WalletSettings.ProgramError(settings.BinaryPath)
        if program.Length > 0 {
            throw WalletException(program)
        }
        Directory.CreateDirectory(settings.DataDirectory)
        let installed = settings.DataDirectory == settings.DiscoveredDataDirectory
        if !installed {
            EnsureOwnedData(settings)
        }
        let walletsExist = Directory.Exists(settings.WalletDirectory)
        Directory.CreateDirectory(settings.WalletDirectory)
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
        ReportProgress("Starting", nil)
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
        TrustedCheckpoints = trusted
        await SaveCoreSettingsAsync(settings, !trusted, ct)
        ReportProgress("Starting", nil)
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
        start.Environment["BLOCKNET_P2P_KEY"] = Path.Combine(settings.DataDirectory, "identity.key")
        start.Environment.Remove("BLOCKNET_VIEW_PRIV")
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
            settings.OwnedProcessId = owned.Id
            Executable = settings.BinaryPath
            Source = if Executable == settings.LauncherBinaryPath {
                "Launcher"
            } else {
                "Gyroid"
            }
            owned.StandardInput.Close()
            owned.StandardOutput.BaseStream.CopyToAsync(Stream.Null)
            owned.StandardError.BaseStream.CopyToAsync(Stream.Null)
            owned.Exited += (_, _) -> {
                if Object.ReferenceEquals(process, owned) && !disposed {
                    Exited?.Invoke()
                }
            }
            owned.EnableRaisingEvents = true
            while !owned.HasExited {
                if await ReachableAsync(settings.Endpoint, ct) {
                    Attach(settings)
                    return
                }
                await Task.Delay(250, ct)
            }
            throw WalletException("Configured core exited before its API became ready")
        } catch (error Exception) {
            Stop()
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
        settings.Validate()
    }

    private func Attach(settings WalletSettings) {
        let pid = WalletCore.Listener(Uri(settings.Endpoint))
        let executable = WalletCore.ProcessExecutable(pid)
        WalletCore.VerifyExecutable(executable)
        Executable = if OperatingSystem.IsLinux() {
            File.ResolveLinkTarget(executable, true)?.FullName ?? executable
        } else {
            executable
        }
        WalletCore.VerifyNetwork(pid, settings.Network)
        if !Owned {
            TrustedCheckpoints = nil
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
        if OperatingSystem.IsLinux() {
            for candidate in Process.GetProcesses() {
                using let current = candidate
                try {
                    if !current.ProcessName.StartsWith("blocknet", StringComparison.Ordinal) {
                        continue
                    }
                    let executable = WalletCore.ProcessExecutable(current.Id)
                    WalletCore.VerifyExecutable(executable)
                    let arguments = File.ReadAllText("/proc/" + current.Id.ToString() + "/cmdline").Split('\0')
                    var endpoint = ""
                    var data = ""
                    var testnet = false
                    for index in 0 ... (arguments.Length - 1) {
                        if arguments[index] == "--testnet" ||
                            arguments[index] == "-testnet" ||
                            arguments[index] == "--testnet=true" ||
                            arguments[index] == "-testnet=true" {
                            testnet = true
                        }
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
                    if testnet != (settings.Network == "testnet") || endpoint.Length == 0 || !Path.IsPathFullyQualified(
                        data
                    ) {
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
                    discovered.Validate()
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
            if WalletFiles.ReadText(marker, 1024) != identity {
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
        using let stream = WalletFiles.CreatePrivate(marker)
        let bytes = System.Text.Encoding.ASCII.GetBytes(identity)
        stream.Write(bytes, 0, bytes.Length)
        stream.Flush(true)
    }

    private func ReportProgress(phase string, percent int32?) {
        Phase = phase
        DownloadPercent = percent
        Progress?.Invoke(
            if percent != nil {
                phase + " " + percent.ToString() + "%"
            } else {
                phase
            }
        )
    }

    private async func SaveCheckpointsAsync(settings WalletSettings, ct CancellationToken) bool {
        if settings.Network != "mainnet" {
            return false
        }
        ReportProgress("Checkpoints", 0)
        using let deadline = CancellationTokenSource.CreateLinkedTokenSource(ct)
        deadline.CancelAfter(TimeSpan.FromSeconds(5))
        let downloaded = await WalletCheckpoints.FetchAsync(
            (count, length) -> ReportProgress(
                "Checkpoints",
                if length > 0 {
                    int32(Math.Min(100L, count * 100 / length))
                } else {
                    nil
                }
            ),
            ct,
            deadline.Token
        )
        using let resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("Gyroid.Checkpoints.Mainnet") ??
            throw WalletException("Mainnet checkpoints are missing")
        let baseline = [int32(resource.Length)]uint8
        resource.ReadExactly(baseline, 0, baseline.Length)
        let selected = WalletCheckpoints.Select(baseline, downloaded)
        let path = Path.Combine(settings.DataDirectory, "checkpoints.dat")
        let temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp"
        try {
            using let stream = WalletFiles.CreatePrivate(temporary)
            await stream.WriteAsync(selected, 0, selected.Length, ct)
            stream.Flush(true)
            stream.Dispose()
            File.Move(temporary, path, true)
        } finally {
            if File.Exists(temporary) {
                File.Delete(temporary)
            }
        }
        ReportProgress("Checkpoints", 100)
        return true
    }

    private async func SaveCoreSettingsAsync(settings WalletSettings, fullSync bool, ct CancellationToken) {
        let path = Path.Combine(settings.DataDirectory, "settings.json")
        if path == WalletSettings.ConfigurationPath() {
            throw WalletException("Application and core settings must use different files")
        }
        using let original = JsonDocument.Parse(
            if File.Exists(path) {
                WalletFiles.ReadText(path, 65536)
            } else {
                "{}"
            }
        )
        if original.RootElement.ValueKind != JsonValueKind.Object {
            throw WalletException("Core settings must be a JSON object")
        }
        let installed = settings.DataDirectory == settings.DiscoveredDataDirectory
        let walletFile = Path.Combine(
            settings.WalletDirectory,
            if settings.ActiveWallet.Length > 0 {
                settings.ActiveWallet
            } else {
                "default.wallet.dat"
            }
        )
        if WalletJson.Text(original.RootElement, "wallet_file") == walletFile && original.RootElement.TryGetProperty(
            "full_sync",
            out let sync
        ) &&
            (sync.ValueKind == JsonValueKind.True || sync.ValueKind == JsonValueKind.False) &&
            sync.GetBoolean() == fullSync &&
            (installed || WalletJson.Text(original.RootElement, "listen") == settings.ListenAddress) {
            return
        }
        let temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp"
        try {
            try {
                using let stream = WalletFiles.CreatePrivate(temporary)
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
                writer.WriteBoolean("full_sync", fullSync)
                writer.WriteEndObject()
                await writer.FlushAsync(ct)
                writer.Dispose()
                stream.Flush(true)
                stream.Dispose()
                File.Move(temporary, path, true)
            } catch (error JsonException) {
                throw WalletException("Core settings could not be parsed")
            }
        } finally {
            if File.Exists(temporary) {
                File.Delete(temporary)
            }
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
            TrustedCheckpoints = nil
        }
        if let owned = stopped {
            try {
                if !owned.HasExited {
                    if OperatingSystem.IsWindows() {
                        owned.Kill()
                    } else {
                        SignalWalletDaemon(owned.Id, 15)
                    }
                    if !owned.WaitForExit(5000) {
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
        termination?.Dispose()
        termination = nil
        AppDomain.CurrentDomain.ProcessExit -= OnProcessExit
        Stop()
    }
}

class WalletFiles {
    shared {
        func FlushDirectory(path string) {
            if OperatingSystem.IsWindows() {
                return
            }
            let fd = OpenWalletFile(path, 0)
            using let handle = SafeFileHandle(IntPtr(fd), true)
            if fd < 0 || FlushWalletDirectory(fd) != 0 {
                throw WalletException("Pending send file could not be saved durably")
            }
        }

        func OpenRead(path string, privateFile bool = false) FileStream {
            var handle SafeFileHandle
            if OperatingSystem.IsWindows() {
                handle = OpenWindowsWalletFile(path, 2147483648, 1, IntPtr.Zero, 3, 35651584, IntPtr.Zero)
                if handle.IsInvalid {
                    handle.Dispose()
                    throw WalletException("File must be a regular no-follow file")
                }
                let attributes = File.GetAttributes(handle)
                if (
                    attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory | FileAttributes.Device)
                ) != 0 {
                    handle.Dispose()
                    throw WalletException("File must be a regular no-follow file")
                }
            } else {
                let flags = if OperatingSystem.IsMacOS() {
                    260
                } else {
                    133120
                }
                let fd = OpenWalletFile(path, flags)
                if fd < 0 {
                    throw WalletException("File must be a regular no-follow file")
                }
                handle = SafeFileHandle(IntPtr(fd), true)
                let status = Marshal.AllocHGlobal(256)
                try {
                    let mac = OperatingSystem.IsMacOS()
                    let arm = RuntimeInformation.ProcessArchitecture == Architecture.Arm64
                    let result = if mac && !arm {
                        StatWalletFileInode64(fd, status)
                    } else {
                        StatWalletFile(fd, status)
                    }
                    if result != 0 {
                        throw WalletException("File must be a regular no-follow file")
                    }
                    let mode = if mac {
                        int32(Marshal.ReadInt16(status, 4))
                    } else {
                        Marshal.ReadInt32(
                            status,
                            if arm {
                                16
                            } else {
                                24
                            }
                        )
                    }
                    let uid = uint32(
                        Marshal.ReadInt32(
                            status,
                            if mac {
                                16
                            } else if arm {
                                24
                            } else {
                                28
                            }
                        )
                    )
                    if (mode & 61440) != 32768 || uid != WalletUserId() || (privateFile && (mode & 63) != 0) {
                        throw WalletException("File ownership or permissions are not private")
                    }
                } catch (error Exception) {
                    handle.Dispose()
                    throw error
                } finally {
                    Marshal.FreeHGlobal(status)
                }
            }
            return FileStream(handle, FileAccess.Read)
        }

        func ReadText(path string, maximum int32, privateFile bool = false) string {
            using let stream = OpenRead(path, privateFile)
            if stream.Length > maximum {
                throw WalletException("File exceeds the supported size")
            }
            let buffer = [maximum + 1]uint8
            try {
                var count int32 = 0
                while count < buffer.Length {
                    let read = stream.Read(buffer, count, buffer.Length - count)
                    if read == 0 {
                        break
                    }
                    count = count + read
                }
                if count > maximum {
                    throw WalletException("File exceeds the supported size")
                }
                return UTF8Encoding(false, true).GetString(buffer, 0, count)
            } finally {
                Array.Clear(buffer)
            }
        }

        func CreatePrivate(path string) FileStream {
            let options = FileStreamOptions{Mode: FileMode.CreateNew, Access: FileAccess.Write, Share: FileShare.None}
            if !OperatingSystem.IsWindows() {
                options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
            }
            return FileStream(path, options)
        }

        func Cookie(path string) string {
            let token = ReadText(path, 1024, true).Trim()
            if token.Length != 64 {
                throw WalletException("API cookie must contain exactly 64 hexadecimal characters")
            }
            for character in token {
                if !char.IsAsciiHexDigit(character) {
                    throw WalletException("API cookie must contain exactly 64 hexadecimal characters")
                }
            }
            return token
        }
    }
}

class WalletCheckpoints {
    shared {
        async func FetchAsync(
            progress Action[int64, int64],
            cancellation CancellationToken,
            ct CancellationToken
        )[]?uint8 {
            try {
                using let http = HttpClient(SocketsHttpHandler{AllowAutoRedirect: false, UseProxy: false})
                using let response = await http.GetAsync(
                    "https://longhornpool.net/checkpoints.dat",
                    HttpCompletionOption.ResponseHeadersRead,
                    ct
                )
                if int32(response.StatusCode) != 200 {
                    return nil
                }
                let length = response.Content.Headers.ContentLength ?? 0
                if length > 1048576 {
                    return nil
                }
                progress.Invoke(0, length)
                using let input = await response.Content.ReadAsStreamAsync(ct)
                using let output = MemoryStream()
                let buffer = [8192]uint8
                while true {
                    let count = await input.ReadAsync(buffer, 0, buffer.Length, ct)
                    if count == 0 {
                        break
                    }
                    if output.Length + count > 1048576 {
                        return nil
                    }
                    output.Write(buffer, 0, count)
                    progress.Invoke(output.Length, length)
                }
                return output.ToArray()
            } catch (error OperationCanceledException) {
                cancellation.ThrowIfCancellationRequested()
                return nil
            } catch (error HttpRequestException) {
                return nil
            } catch (error IOException) {
                return nil
            }
        }

        func Parse(contents[]?uint8) Dictionary[uint64, string] {
            let entries = Dictionary[uint64, string]()
            if contents == nil {
                return entries
            }
            let text = Encoding.UTF8.GetString(contents)
            var offset = 0
            while offset < text.Length {
                let end = text.IndexOf('\n', offset)
                let count = if end < 0 {
                    text.Length - offset
                } else {
                    end - offset
                }
                let line = text.Substring(offset, count).Trim()
                offset = offset + count + 1
                if line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal) {
                    continue
                }
                let separator = line.IndexOf(':')
                if separator < 0 || !uint64.TryParse(
                    line.Substring(0, separator).Trim(),
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out let height
                ) ||
                    height == 0 {
                    continue
                }
                var hash = line.Substring(separator + 1).Trim()
                if hash.StartsWith("0x", StringComparison.Ordinal) {
                    hash = hash.Substring(2)
                }
                if hash.Length != 64 {
                    continue
                }
                var valid = true
                for character in hash {
                    if !char.IsAsciiHexDigit(character) {
                        valid = false
                        break
                    }
                }
                if valid {
                    entries[height] = hash
                }
            }
            return entries
        }

        func Extends(baseline Dictionary[uint64, string], candidate Dictionary[uint64, string]) bool {
            for entry in baseline {
                if !candidate.TryGetValue(entry.Key, out let hash) || !string.Equals(
                    entry.Value,
                    hash,
                    StringComparison.OrdinalIgnoreCase
                ) {
                    return false
                }
            }
            return true
        }

        func Height(entries Dictionary[uint64, string]) uint64 {
            var height uint64 = 0
            for entry in entries {
                height = Math.Max(height, entry.Key)
            }
            return height
        }

        func Select(baseline[]uint8, downloaded[]?uint8)[]uint8 {
            let trusted = Parse(baseline)
            let fetched = Parse(downloaded)
            if Height(fetched) >= Height(trusted) && Extends(trusted, fetched) {
                return downloaded ?? baseline
            }
            return baseline
        }
    }
}

class WalletCore {
    shared {
        func VerifyNetwork(pid int32, network string) {
            if OperatingSystem.IsLinux() {
                let arguments = File.ReadAllText("/proc/" + pid.ToString() + "/cmdline").Split('\0')
                var testnet = false
                for argument in arguments {
                    if argument == "--testnet" ||
                        argument == "-testnet" ||
                        argument == "--testnet=true" ||
                        argument == "-testnet=true" {
                        testnet = true
                    }
                }
                if testnet != (network == "testnet") {
                    throw WalletException("Running core network does not match the configured network")
                }
            }
        }

        func ExecutableName() string -> "blocknet-core-" + Platform() + if OperatingSystem.IsWindows() {
            ".exe"
        } else {
            ""
        }

        func InstallationPath() string -> Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData,
                Environment.SpecialFolderOption.DoNotVerify
            ),
            "Gyroid",
            "core",
            "v0.22.0",
            ExecutableName()
        )

        async func DownloadAsync(progress Action[string]?, cancellation CancellationToken) string {
            let path = InstallationPath()
            let directory = Path.GetDirectoryName(path) ??
                throw WalletException("Core installation directory is unavailable")
            Directory.CreateDirectory(directory)
            if !OperatingSystem.IsWindows() {
                File.SetUnixFileMode(
                    directory,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                )
            }
            let archivePath = path + "." + Guid.NewGuid().ToString("N") + ".zip"
            let temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp"
            using let deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)
            deadline.CancelAfter(TimeSpan.FromMinutes(3))
            let ct = deadline.Token
            using let http = HttpClient(SocketsHttpHandler{AllowAutoRedirect: false, UseProxy: false})
            var address = Uri(
                "https://github.com/blocknetprivacy/core/releases/download/v0.22.0/blocknet-core-" +
                    Platform() +
                    "-0.22.0.zip"
            )
            progress?.Invoke("0%")
            try {
                for redirect in 0 ... 3 {
                    using let response = await http.GetAsync(address, HttpCompletionOption.ResponseHeadersRead, ct)
                    let code = int32(response.StatusCode)
                    if code == 301 || code == 302 || code == 303 || code == 307 || code == 308 {
                        let location = response
                            .Headers
                            .Location ??
                            throw WalletException("Core download redirect is missing")
                        let next = Uri(address, location)
                        if next.Scheme != "https" ||
                            next.Host != "release-assets.githubusercontent.com" ||
                            !next.IsDefaultPort ||
                            next
                            .UserInfo
                            .Length != 0 {
                            throw WalletException("Core download redirect is not an official release asset")
                        }
                        address = next
                        continue
                    }
                    if !response.IsSuccessStatusCode {
                        throw WalletException("Core download failed")
                    }
                    let length = response.Content.Headers.ContentLength ?? 0
                    if length > 33554432 {
                        throw WalletException("Core download exceeds the size limit")
                    }
                    using let input = await response.Content.ReadAsStreamAsync(ct)
                    using let output = WalletFiles.CreatePrivate(archivePath)
                    let buffer = [65536]uint8
                    var percent int32 = -1
                    while true {
                        let count = await input.ReadAsync(buffer, 0, buffer.Length, ct)
                        if count == 0 {
                            break
                        }
                        if output.Length + count > 33554432 {
                            throw WalletException("Core download exceeds the size limit")
                        }
                        await output.WriteAsync(buffer, 0, count, ct)
                        let current = if length > 0 {
                            int32(Math.Min(100L, output.Length * 100 / length))
                        } else {
                            0
                        }
                        if current != percent {
                            percent = current
                            progress?.Invoke(current.ToString() + "%")
                        }
                    }
                    output.Flush(true)
                    output.Dispose()
                    await InstallAsync(archivePath, temporary, path, ct)
                    return path
                }
                throw WalletException("Core download has too many redirects")
            } catch (error OperationCanceledException) {
                cancellation.ThrowIfCancellationRequested()
                throw WalletException("Core download timed out")
            } catch (error HttpRequestException) {
                throw WalletException("Core download failed")
            } finally {
                if File.Exists(archivePath) {
                    File.Delete(archivePath)
                }
                if File.Exists(temporary) {
                    File.Delete(temporary)
                }
            }
        }

        async func InstallAsync(archivePath string, temporary string, path string, ct CancellationToken) {
            try {
                using let archive = ZipFile.OpenRead(archivePath)
                let entry = archive.GetEntry(ExecutableName()) ??
                    throw WalletException("Core download does not contain the release executable")
                if entry.Length <= 0 || entry.Length > 67108864 {
                    throw WalletException("Core executable exceeds the size limit")
                }
                using let input = entry.Open()
                using let output = WalletFiles.CreatePrivate(temporary)
                let buffer = [65536]uint8
                while true {
                    let count = await input.ReadAsync(buffer, 0, buffer.Length, ct)
                    if count == 0 {
                        break
                    }
                    if output.Length + count > 67108864 {
                        throw WalletException("Core executable exceeds the size limit")
                    }
                    await output.WriteAsync(buffer, 0, count, ct)
                }
                output.Flush(true)
                output.Dispose()
                VerifyExecutable(temporary)
                if !OperatingSystem.IsWindows() {
                    File.SetUnixFileMode(
                        temporary,
                        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                    )
                }
                File.Move(temporary, path, true)
            } finally {
                if File.Exists(temporary) {
                    File.Delete(temporary)
                }
            }
        }

        func Platform() string {
            let arch = if RuntimeInformation.ProcessArchitecture == Architecture.Arm64 {
                "arm64"
            } else if
            RuntimeInformation.ProcessArchitecture == Architecture.X64 {
                "amd64"
            } else {
                throw WalletException("No pinned core is available for this platform")
            }
            return arch + "-" + if OperatingSystem.IsLinux() {
                "linux"
            } else if OperatingSystem.IsMacOS() {
                "macos"
            } else if OperatingSystem.IsWindows() {
                "windows"
            } else {
                throw WalletException("No pinned core is available for this platform")
            }
        }

        func VerifyExecutable(path string) {
            using let stream = FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)
            let digest = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant()
            let expected = switch Platform() {
                case "amd64-linux": "d64a062646792c60c11ddbc232044943557a6a1deadbcc8cd6dc66c788b89342"
                case "arm64-linux": "106ac50e65c1a741fa949c84e96d057240e3df3d9ace2383128fc4506904e88c"
                case "amd64-macos": "47778cf2ee19035ac1dcddf839d8123faade0fac4926d07124e54cb52e845f62"
                case "arm64-macos": "1a17f97de27339d00a4d8923d644b6aff0055762a3975fd73788f354f613fe7d"
                case "amd64-windows": "79e27d922e442d8152eb89e04b9db4f555e3a326a06f5334a30e86b2adbdb260"
                default: throw WalletException("No pinned core is available for this platform")
            }
            if digest != expected {
                throw WalletException("Core executable does not match the pinned Blocknet 0.22.0 release")
            }
        }

        func Listener(endpoint Uri) int32 {
            try {
                let pids = HashSet[int32]()
                if OperatingSystem.IsLinux() {
                    let inodes = HashSet[string]()
                    for table in[]string{"/proc/net/tcp", "/proc/net/tcp6"} {
                        if !File.Exists(table) {
                            continue
                        }
                        for line in File.ReadLines(table) {
                            let fields = line.Split(default([]char), StringSplitOptions.RemoveEmptyEntries)
                            if fields.Length < 10 || fields[3] != "0A" {
                                continue
                            }
                            let local = fields[1].Split(':')
                            if Convert.ToInt32(local[1], 16) != endpoint.Port {
                                continue
                            }
                            let address = local[0]
                            let expected = if endpoint.Host.Contains(':') {
                                "00000000000000000000000001000000"
                            } else {
                                "0100007F"
                            }
                            if address == expected ||
                                address == "00000000" ||
                                address == "00000000000000000000000000000000" {
                                inodes.Add(fields[9])
                            }
                        }
                    }
                    for directory in Directory.EnumerateDirectories("/proc") {
                        if !int32.TryParse(Path.GetFileName(directory), out let pid) {
                            continue
                        }
                        try {
                            for descriptor in Directory.EnumerateFiles(Path.Combine(directory, "fd")) {
                                let target = FileInfo(descriptor).LinkTarget ?? ""
                                if target.StartsWith("socket:[", StringComparison.Ordinal) && target.EndsWith(
                                    "]",
                                    StringComparison.Ordinal
                                ) &&
                                    inodes.Contains(target.Substring(8, target.Length - 9)) {
                                    pids.Add(pid)
                                }
                            }
                        } catch (error IOException) { } catch (error UnauthorizedAccessException) { }
                    }
                } else if OperatingSystem.IsWindows() {
                    for family in[]int32{2, 23} {
                        var size int32 = 0
                        WalletTcpTable(IntPtr.Zero, ref size, false, family, 3, 0)
                        if size <= 0 || size > 16777216 {
                            continue
                        }
                        let table = Marshal.AllocHGlobal(size)
                        try {
                            if WalletTcpTable(table, ref size, false, family, 3, 0) != 0 {
                                continue
                            }
                            let stride = if family == 2 {
                                24
                            } else {
                                56
                            }
                            let count = Marshal.ReadInt32(table)
                            if count < 0 || int64(count) * int64(stride) + 4 > int64(size) {
                                continue
                            }
                            for index in 0 ... count {
                                let row = IntPtr.Add(table, 4 + index * stride)
                                let offset = if family == 2 {
                                    8
                                } else {
                                    20
                                }
                                let port = int32(Marshal.ReadByte(row, offset)) * 256 +
                                    int32(Marshal.ReadByte(row, offset + 1))
                                if port == endpoint.Port {
                                    pids.Add(Marshal.ReadInt32(row, stride - 4))
                                }
                            }
                        } finally {
                            Marshal.FreeHGlobal(table)
                        }
                    }
                } else if OperatingSystem.IsMacOS() {
                    let start = ProcessStartInfo{
                        FileName: "/usr/sbin/lsof",
                        UseShellExecute: false,
                        CreateNoWindow: true,
                        RedirectStandardOutput: true,
                        RedirectStandardError: true
                    }
                    for argument in[]string{"-nP", "-iTCP:" + endpoint.Port.ToString(), "-sTCP:LISTEN", "-Fp"} {
                        start.ArgumentList.Add(argument)
                    }
                    using let process = Process.Start(start) ??
                        throw WalletException("API listener identity could not be verified")
                    if !process.WaitForExit(2000) {
                        process.Kill()
                        throw WalletException("API listener identity could not be verified")
                    }
                    let text = process.StandardOutput.ReadToEnd()
                    if text.Length > 65536 {
                        throw WalletException("API listener identity could not be verified")
                    }
                    for line in text.Split('\n') {
                        if line.StartsWith("p", StringComparison.Ordinal) && int32.TryParse(
                            line.Substring(1),
                            out let pid
                        ) {
                            pids.Add(pid)
                        }
                    }
                }
                if pids.Count == 1 {
                    for pid in pids {
                        return pid
                    }
                }
            } catch (error Exception) {
                if error is WalletException {
                    throw error
                }
            }
            throw WalletException("API listener identity could not be verified")
        }

        func ProcessExecutable(pid int32) string {
            if OperatingSystem.IsLinux() {
                return "/proc/" + pid.ToString() + "/exe"
            }
            if OperatingSystem.IsWindows() {
                let process = OpenWalletProcess(4096, false, pid)
                if process == IntPtr.Zero {
                    throw WalletException("API listener identity could not be verified")
                }
                let path = Marshal.AllocHGlobal(65536)
                try {
                    var size int32 = 32768
                    if !WalletProcessPath(process, 0, path, ref size) {
                        throw WalletException("API listener identity could not be verified")
                    }
                    return Marshal.PtrToStringUni(path, size) ??
                        throw WalletException("API listener identity could not be verified")
                } finally {
                    Marshal.FreeHGlobal(path)
                    CloseWalletHandle(process)
                }
            }
            let buffer = [4096]uint8
            let length = WalletMacProcessPath(pid, buffer, uint32(buffer.Length))
            if length <= 0 {
                throw WalletException("API listener identity could not be verified")
            }
            return Encoding.UTF8.GetString(buffer, 0, length).TrimEnd('\0')
        }
    }
}
