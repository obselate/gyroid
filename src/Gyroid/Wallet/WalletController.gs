package Gyroid.Wallet

import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Send
import Gyroid.Settings
import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class WalletController : IDisposable {
    var settings WalletSettings
    let Node NodeSession
    let gate SemaphoreSlim = SemaphoreSlim(1, 1)
    let autoLockChanged SemaphoreSlim = SemaphoreSlim(0, 1)
    var snapshot WalletSnapshot = WalletSnapshot()
    var pendingSeed[]?char = nil
    var confirmation SendEstimate? = nil
    var confirmationKey string = ""
    var pendingSend PendingSend? = nil
    var pendingSendError string = ""
    var sendOutcome string = ""
    var sendLease FileStream? = nil
    let History HistoryService
    var state string = "Unloaded"
    var page string = "Welcome"
    var connected bool
    var managed bool
    var isBusy bool
    var lockQueued bool
    var disposed bool
    var Changed Action? = nil
    let shutdown CancellationTokenSource = CancellationTokenSource()
    var events CancellationTokenSource? = nil
    var eventsEnabled bool
    var nextRestart DateTimeOffset
    var lastActivity int64 = Environment.TickCount64

    prop Settings WalletSettings -> settings.Copy()
    prop Snapshot WalletSnapshot -> snapshot
    prop Busy bool -> isBusy
    prop Pending PendingSend? -> pendingSend
    prop PendingSendError string -> pendingSendError
    prop SendOutcome string -> sendOutcome
    prop LockQueued bool -> lockQueued

    init() {
        settings = WalletSettings.Load()
        Node = NodeSession(settings)
        History = HistoryService(this)
        Node.Exited = () -> Task.Run(() -> RestartOwnedAsync())
        Node.Changed = () -> Changed?.Invoke()
        if settings.ActiveWallet.Length > 0 {
            page = "Unlock"
        }
        PublishEmpty()
        Node.Publish()
        Task.Run(() -> AutoLockAsync())
    }

    async func BeginAsync(ct CancellationToken) {
        if disposed {
            throw WalletException("Wallet controller is closed")
        }
        await gate.WaitAsync(ct)
        if disposed {
            gate.Release()
            throw WalletException("Wallet controller is closed")
        }
        isBusy = true
        Changed?.Invoke()
    }

    func End() {
        if disposed {
            ClearSeed()
            InvalidateConfirmation()
            managed = false
            connected = false
            state = "Unloaded"
            page = "Welcome"
            PublishEmpty()
        }
        sendLease?.Dispose()
        sendLease = nil
        isBusy = false
        UpdateEvents()
        if settings.AutoLockMinutes > 0 && autoLockChanged.CurrentCount == 0 {
            autoLockChanged.Release()
        }
        gate.Release()
        if !disposed {
            Changed?.Invoke()
        }
    }

    func Touch() {
        Interlocked.Exchange(ref lastActivity, Environment.TickCount64)
    }

    private func IdleExpired() bool -> settings.AutoLockMinutes > 0 && Environment.TickCount64 - Interlocked.Read(
        ref lastActivity
    ) >= int64(settings.AutoLockMinutes) * 60000

    private async func AutoLockAsync() {
        let ct = shutdown.Token
        try {
            while !ct.IsCancellationRequested {
                if settings.AutoLockMinutes == 0 || !managed || state != "Unlocked" {
                    await autoLockChanged.WaitAsync(ct)
                    continue
                }
                let remaining = int64(settings.AutoLockMinutes) * 60000
                - (Environment.TickCount64 - Interlocked.Read(ref lastActivity))
                if remaining > 0 {
                    await autoLockChanged.WaitAsync(int32(Math.Min(remaining, int32.MaxValue)), ct)
                    continue
                }
                await BeginAsync(ct)
                try {
                    if managed && state == "Unlocked" && IdleExpired() {
                        await LockCoreAsync(ct)
                    }
                } catch (error WalletException) {
                    PublishEmpty()
                } finally {
                    End()
                }
            }
        } catch (error OperationCanceledException) { }
    }

    func EnableEvents() {
        eventsEnabled = true
        UpdateEvents()
    }

    private func StopEvents() {
        events?.Cancel()
        events?.Dispose()
        events = nil
    }

    private func UpdateEvents() {
        if disposed || !connected || state == "Locked" || state == "Unknown" {
            StopEvents()
        } else if eventsEnabled && events == nil {
            let source = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token)
            events = source
            let ct = source.Token
            Task.Run(() -> ListenEventsAsync(ct))
        }
    }

    private async func ListenEventsAsync(ct CancellationToken) {
        while !ct.IsCancellationRequested {
            try {
                await Node.Api.EventsAsync(_ -> RefreshEventAsync(ct), ct)
            } catch (error Exception) {
                if ct.IsCancellationRequested {
                    return
                }
            }
            try {
                await Task.Delay(2000, ct)
            } catch (error OperationCanceledException) {
                return
            }
        }
    }

    private async func RefreshEventAsync(ct CancellationToken) {
        await gate.WaitAsync(ct)
        try {
            ct.ThrowIfCancellationRequested()
            await Node.RefreshStatusAsync(ct)
            if state == "Unlocked" {
                await RefreshCoreAsync(ct)
            }
        } finally {
            sendLease?.Dispose()
            sendLease = nil
            UpdateEvents()
            gate.Release()
            if !disposed {
                Changed?.Invoke()
            }
        }
    }

    private async func RestartOwnedAsync() {
        let ct = shutdown.Token
        try {
            await Task.Delay(2000, ct)
            await gate.WaitAsync(ct)
            try {
                if disposed || settings.NodeMode == "manual" || !Node.Supervisor.NeedsRestart {
                    return
                }
                StopEvents()
                connected = false
                managed = false
                ClearSeed()
                InvalidateConfirmation()
                state = "Unloaded"
                page = if settings.ActiveWallet.Length > 0 {
                    "Unlock"
                } else {
                    "Welcome"
                }
                PublishEmpty()
                Node.Publish()
                Changed?.Invoke()
                let delay = nextRestart - DateTimeOffset.UtcNow
                if delay > TimeSpan.Zero {
                    await Task.Delay(delay, ct)
                }
                nextRestart = DateTimeOffset.UtcNow.AddSeconds(10)
                Node.Reconnect()
                await ConnectCoreAsync(ct)
                UpdateEvents()
            } finally {
                gate.Release()
            }
        } catch (error Exception) {
            Node.Publish()
        }
        if !disposed {
            Changed?.Invoke()
        }
    }

    private async func ConnectCoreAsync(ct CancellationToken) {
        try {
            if !connected {
                Node.Supervisor.Progress?.Invoke("Detecting")
            }
            let walletFile = await Node.ConnectAsync(settings, ct)
            let comparison = if OperatingSystem.IsWindows() {
                StringComparison.OrdinalIgnoreCase
            } else {
                StringComparison.Ordinal
            }
            try {
                using let address = await Node.Api.JsonAsync("wallet/address", ct: ct)
                if state != "Unlocked" {
                    Touch()
                }
                state = "Unlocked"
            } catch (error WalletException) {
                if error.StatusCode == 403 {
                    state = "Locked"
                } else if error.StatusCode == 503 {
                    state = "Unloaded"
                } else {
                    throw error
                }
            }
            if state == "Unloaded" {
                managed = false
                page = if settings.ActiveWallet.Length == 0 {
                    "Welcome"
                } else {
                    "Unlock"
                }
            } else {
                let filename = Path.GetFileName(walletFile)
                if !managed && !string.Equals(settings.ActiveWallet, filename, comparison) {
                    WalletPath(filename)
                    settings.ActiveWallet = filename
                    await WalletSettings.SaveAsync(settings, ct)
                }
                managed = true
                page = if state == "Locked" {
                    "Unlock"
                } else {
                    "Wallet"
                }
            }
            connected = true
            if managed {
                await RecoverSendCoreAsync(ct)
            }
            PublishCurrent()
        } catch (error Exception) {
            Node.Publish()
            connected = false
            managed = false
            PublishEmpty()
            throw error
        }
    }

    async func ConnectAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            await ConnectCoreAsync(ct)
            if state == "Unlocked" {
                await RefreshCoreAsync(ct)
            }
        } finally {
            End()
        }
    }

    async func ApplySettingsAsync(value WalletSettings, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            let next = value.Copy()
            next.Privacy = settings.Privacy
            next.Language = settings.Language
            next.NodeMode = settings.NodeMode
            next.LoadError = ""
            if next.Network != settings.Network {
                if next.DataDirectory == settings.DataDirectory &&
                    (
                    next.DataDirectory == WalletSettings.DefaultData(settings.Network) ||
                        next.DataDirectory == settings.DiscoveredDataDirectory
                ) {
                    next.DataDirectory = ""
                    next.WalletDirectory = ""
                }
                if next.Endpoint == settings.Endpoint {
                    next.Endpoint = ""
                }
                if next.BinaryPath == settings.BinaryPath {
                    next.BinaryPath = ""
                }
                next.ActiveWallet = ""
                next.DiscoveredDataDirectory = ""
                next.DiscoveredEndpoint = ""
                next.DiscoveredBinaryPath = ""
                next.DiscoveredWalletFile = ""
                next.LauncherBinaryPath = ""
                WalletSettings.Discover(next)
            }
            next.Validate()
            if next.BinaryPath != settings.BinaryPath && next.BinaryPath.Length > 0 {
                let program = WalletSettings.ProgramError(next.BinaryPath)
                if program.Length > 0 {
                    throw WalletException(program)
                }
            }
            if next.Network != settings.Network && Path.GetFullPath(next.DataDirectory) == Path.GetFullPath(
                settings.DataDirectory
            ) {
                throw WalletException("Choose a separate data directory when changing network")
            }
            StopEvents()
            await UnloadCoreAsync(ct)
            await WalletSettings.SaveAsync(next, ct)
            if Node.Supervisor.Owned && next.StartupDiffers(settings) {
                Node.Supervisor.Stop()
                next.OwnedProcessId = 0
            } else {
                next.OwnedProcessId = settings.OwnedProcessId
            }
            settings = next
            Node.Settings = settings
            Node.Reconnect()
            connected = false
            page = if settings.ActiveWallet.Length == 0 {
                "Welcome"
            } else {
                "Unlock"
            }
            PublishEmpty()
            Node.Publish()
            await ConnectCoreAsync(ct)
        } finally {
            End()
        }
    }

    async func SaveAutoLockAsync(minutes int32, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            let next = settings.Copy()
            next.AutoLockMinutes = minutes
            next.Validate()
            await WalletSettings.SaveAsync(next, ct)
            settings.AutoLockMinutes = minutes
            Touch()
            if autoLockChanged.CurrentCount == 0 {
                autoLockChanged.Release()
            }
        } finally {
            End()
        }
    }

    async func SavePrivacyAsync(value bool, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            settings.Privacy = value
            await WalletSettings.SaveAsync(settings, ct)
        } finally {
            End()
        }
    }

    async func SaveLanguageAsync(value string, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            let next = settings.Copy()
            next.Language = value
            await WalletSettings.SaveAsync(next, ct)
            settings.Language = value
        } finally {
            End()
        }
    }

    async func SaveNodeModeAsync(value string, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            let next = settings.Copy()
            next.NodeMode = value
            await WalletSettings.SaveAsync(next, ct)
            settings.NodeMode = value
        } finally {
            End()
        }
    }

    async func StartNodeAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            await ConnectCoreAsync(ct)
        } finally {
            End()
        }
    }

    async func StopNodeAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            StopNode()
        } finally {
            End()
        }
    }

    async func RestartNodeAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            if settings.NodeMode == "manual" {
                throw WalletException("Manual mode does not restart nodes")
            }
            StopNode()
            await Task.Delay(2000, ct)
            await ConnectCoreAsync(ct)
        } finally {
            End()
        }
    }

    private func StopNode() {
        if !Node.Supervisor.Owned {
            throw WalletException("This process does not own the node. External nodes are never stopped")
        }
        if managed || state != "Unloaded" {
            throw WalletException("Unload the wallet before stopping or restarting the node")
        }
        Node.StopOwned()
        StopEvents()
        connected = false
        PublishEmpty()
        Node.Publish()
    }

    async func RefreshNodeAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            if !await Node.TryAttachAsync(ct) {
                return
            }
            await Node.RefreshStatusAsync(ct)
        } catch (error Exception) {
            Node.Publish()
            throw error
        } finally {
            End()
        }
    }

    async func RefreshStatusAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            await Node.RefreshStatusAsync(ct)
        } finally {
            End()
        }
    }

    func ListWallets()[]string {
        if !Directory.Exists(settings.WalletDirectory) {
            return []string{}
        }
        let files = List[string]()
        for path in Directory.EnumerateFiles(settings.WalletDirectory, "*.dat") {
            if FileInfo(path).LinkTarget != nil {
                continue
            }
            let filename = Path.GetFileName(path)
            try {
                WalletValidation.ValidateFilename(filename)
            } catch (error WalletException) {
                continue
            }
            files.Add(filename)
        }
        files.Sort(StringComparer.Ordinal)
        return files.ToArray()
    }

    async func ChooseWalletAsync(filename string, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            RequireUnloaded()
            let path = WalletPath(filename)
            if !File.Exists(path) {
                throw WalletException("Selected wallet file does not exist")
            }
            settings.ActiveWallet = filename
            await WalletSettings.SaveAsync(settings, ct)
            page = "Unlock"
            PublishEmpty()
        } finally {
            End()
        }
    }

    async func ImportFileAsync(absolutePath string, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            try {
                RequireUnloaded()
                if !Path.IsPathFullyQualified(absolutePath) || !File.Exists(absolutePath) {
                    throw WalletException("Choose an existing wallet file with an absolute path")
                }
                using let input = PrivateFiles.OpenRead(absolutePath)
                let filename = Path.GetFileName(absolutePath)
                let destination = WalletPath(filename)
                if Path.GetFullPath(absolutePath) != Path.GetFullPath(destination) {
                    Directory.CreateDirectory(settings.WalletDirectory)
                    let temporary = Path.Combine(settings.WalletDirectory, ".import-" + Guid.NewGuid().ToString("N"))
                    try {
                        using let output = PrivateFiles.CreatePrivate(temporary)
                        await input.CopyToAsync(output, ct)
                        await output.FlushAsync(ct)
                        output.Dispose()
                        File.Move(temporary, destination, false)
                    } finally {
                        if File.Exists(temporary) {
                            File.Delete(temporary)
                        }
                    }
                }
                settings.ActiveWallet = filename
                await WalletSettings.SaveAsync(settings, ct)
                page = "Unlock"
                PublishEmpty()
            } catch (error IOException) {
                throw WalletException("Wallet file could not be imported. Existing files are never replaced")
            } catch (error UnauthorizedAccessException) {
                throw WalletException("Access to the selected wallet file was denied")
            }
        } finally {
            End()
        }
    }

    async func CreateAsync(filename string, password[]char, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            RequireUnloaded()
            RequireNewWallet(filename, password)
            await ConnectCoreAsync(ct)
            using let result = await Node.Api.JsonAsync(
                "wallet/create",
                writer -> WriteCredentials(writer, password, "filename", filename),
                ct
            )
            managed = true
            state = "Unlocked"
            Touch()
            page = "Wallet"
            settings.ActiveWallet = filename
            PublishEmpty()
            await WalletSettings.SaveAsync(settings, ct)
            ClearSeed()
            pendingSeed = await Node.Api.SeedAsync(password, ct)
            page = "Seed"
            PublishEmpty()
        } finally {
            End()
        }
    }

    async func ImportPhraseAsync(
        filename string,
        phrase[]char,
        password[]char,
        ct CancellationToken = default(CancellationToken)
    ) {
        await BeginAsync(ct)
        var normalized[]?char = nil
        try {
            RequireUnloaded()
            RequireNewWallet(filename, password)
            let normalizedPhrase = WalletValidation.NormalizePhrase(phrase)
            normalized = normalizedPhrase
            await ConnectCoreAsync(ct)
            using let result = await Node.Api.JsonAsync(
                "wallet/import",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteString("filename", filename)
                    writer.WriteString("password", ReadOnlySpan[char](password))
                    writer.WriteString("mnemonic", ReadOnlySpan[char](normalizedPhrase))
                    writer.WriteEndObject()
                },
                ct
            )
            managed = true
            state = "Unlocked"
            Touch()
            page = "Wallet"
            settings.ActiveWallet = filename
            PublishEmpty()
            await WalletSettings.SaveAsync(settings, ct)
            await RefreshCoreAsync(ct)
        } finally {
            if let buffer = normalized {
                Array.Clear(buffer)
            }
            End()
        }
    }

    async func UnlockAsync(password[]char, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            if password.Length < 3 {
                throw WalletException("Password must contain at least 3 characters")
            }
            await ConnectCoreAsync(ct)
            if state == "Unloaded" {
                if settings.ActiveWallet.Length == 0 {
                    throw WalletException("Choose a wallet first")
                }
                WalletPath(settings.ActiveWallet)
                using let result = await Node.Api.JsonAsync(
                    "wallet/load",
                    writer -> WriteCredentials(writer, password, "filepath", settings.ActiveWallet),
                    ct
                )
                managed = true
            } else {
                RequireManaged()
                using let result = await Node.Api.JsonAsync(
                    "wallet/unlock",
                    writer -> WriteCredentials(writer, password),
                    ct
                )
            }
            state = "Unlocked"
            Touch()
            page = "Wallet"
            PublishEmpty()
            await RefreshCoreAsync(ct)
        } finally {
            End()
        }
    }

    async func LockAsync(ct CancellationToken = default(CancellationToken)) {
        if lockQueued {
            return
        }
        if isBusy {
            lockQueued = true
            Changed?.Invoke()
        }
        try {
            await BeginAsync(ct)
        } catch (error Exception) {
            lockQueued = false
            Changed?.Invoke()
            throw error
        }
        try {
            await LockCoreAsync(ct)
        } finally {
            lockQueued = false
            End()
        }
    }

    private async func LockCoreAsync(ct CancellationToken) {
        StopEvents()
        lockQueued = false
        RequireManaged()
        ClearSeed()
        InvalidateConfirmation()
        state = "Unknown"
        page = "Unlock"
        PublishEmpty()
        Changed?.Invoke()
        try {
            using let result = await Node.Api.JsonAsync("wallet/lock", WriteEmpty, ct)
            state = "Locked"
            PublishEmpty()
        } catch (error WalletException) {
            if error.StatusCode == 503 {
                state = "Unloaded"
                managed = false
                page = "Welcome"
            } else if error.StatusCode == 403 {
                state = "Locked"
            }
            PublishEmpty()
            throw error
        }
    }

    async func UnloadAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            await UnloadCoreAsync(ct)
            page = "Welcome"
            PublishEmpty()
        } finally {
            End()
        }
    }

    private async func UnloadCoreAsync(ct CancellationToken) {
        StopEvents()
        ClearSeed()
        InvalidateConfirmation()
        if managed {
            try {
                if state == "Unlocked" {
                    using let locked = await Node.Api.JsonAsync("wallet/lock", WriteEmpty, ct)
                }
                using let result = await Node.Api.JsonAsync("wallet/unload", WriteEmpty, ct)
            } catch (error WalletException) {
                if error.StatusCode != 503 {
                    throw error
                }
            }
        }
        managed = false
        state = "Unloaded"
        pendingSend = nil
        sendOutcome = ""
    }

    async func RevealSeedAsync(password[]char, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            if snapshot.ViewOnly {
                throw WalletException("View-only wallets do not have a spend recovery phrase")
            }
            ClearSeed()
            pendingSeed = await Node.Api.SeedAsync(password, ct)
            page = "Seed"
            PublishCurrent()
        } finally {
            End()
        }
    }

    func TakePendingSeed()[]?char {
        let seed = pendingSeed
        pendingSeed = nil
        return seed
    }

    func ContinueFromSeed() {
        ClearSeed()
        if state == "Unlocked" {
            page = "Wallet"
            PublishCurrent()
        }
        Changed?.Invoke()
    }

    async func ExportSeedAsync(path string, seed[]char, ct CancellationToken = default(CancellationToken)) {
        let bytes = [Encoding.UTF8.GetMaxByteCount(seed.Length)]uint8
        try {
            let count = Encoding.UTF8.GetBytes(seed, 0, seed.Length, bytes, 0)
            for index in 0 ... count {
                if bytes[index] == 32 {
                    bytes[index] = 10
                }
            }
            await PrivateFiles.WriteAtomic(
                path,
                destination -> destination.WriteAsync(bytes, 0, count, ct),
                true,
                false
            )
        } finally {
            Array.Clear(bytes)
        }
    }

    async func RescanAsync(ct CancellationToken = default(CancellationToken)) {
        using let source = CancellationTokenSource.CreateLinkedTokenSource(ct, shutdown.Token)
        let token = source.Token
        await BeginAsync(token)
        try {
            RequireUnlocked()
            Touch()
            using let response = await Node.Api.JsonAsync("wallet/sync", WriteEmpty, token)
        } finally {
            End()
        }
        try {
            while state == "Unlocked" && !disposed {
                using let balance = await Node.Api.JsonAsync("wallet/balance", ct: token)
                if state != "Unlocked" || disposed {
                    return
                }
                if NodeJson.Number(balance.RootElement, "synced_height") >=
                NodeJson.Number(balance.RootElement, "chain_height") {
                    await RefreshAsync(token)
                    return
                }
                await Task.Delay(500, token)
            }
        } catch (error OperationCanceledException) when shutdown.IsCancellationRequested { } catch (
            error WalletException
        ) when state != "Unlocked" ||
            disposed { } catch (error ObjectDisposedException) when state != "Unlocked" ||
            disposed { }
    }

    async func SignAsync(message string, ct CancellationToken = default(CancellationToken)) string {
        WalletValidation.ValidateMessage(message)
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            Touch()
            using let response = await Node.Api.JsonAsync(
                "wallet/sign",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteString("message", message)
                    writer.WriteEndObject()
                },
                ct
            )
            return NodeJson.Text(response.RootElement, "signature")
        } finally {
            End()
        }
    }

    async func VerifyAsync(
        address string,
        message string,
        signature string,
        ct CancellationToken = default(CancellationToken)
    ) bool {
        WalletValidation.ValidateMessage(message)
        await BeginAsync(ct)
        try {
            using let response = await Node.Api.JsonAsync(
                "verify",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteString("address", WalletValidation.ValidateAddress(address))
                    writer.WriteString("message", message)
                    writer.WriteString("signature", signature)
                    writer.WriteEndObject()
                },
                ct
            )
            return NodeJson.Flag(response.RootElement, "valid")
        } catch (error WalletException) {
            if error.StatusCode == 400 {
                return false
            }
            throw error
        } finally {
            End()
        }
    }

    async func ProveAsync(txid string, ct CancellationToken = default(CancellationToken)) string {
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            Touch()
            using let response = await Node.Api.JsonAsync(
                "wallet/prove",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteString("txid", txid)
                    writer.WriteEndObject()
                },
                ct
            )
            return NodeJson.Text(response.RootElement, "tx_key")
        } finally {
            End()
        }
    }

    async func VerifyProofAsync(
        txid string,
        txKey string,
        address string,
        amount string,
        ct CancellationToken = default(CancellationToken)
    ) bool {
        let expected = WalletAmount.Parse(amount)
        await BeginAsync(ct)
        try {
            using let response = await Node.Api.JsonAsync(
                "verify-proof",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteString("txid", txid)
                    writer.WriteString("tx_key", txKey)
                    writer.WriteString("address", WalletValidation.ValidateAddress(address))
                    writer.WriteEndObject()
                },
                ct
            )
            return NodeJson.Flag(response.RootElement, "valid") && NodeJson.Number(
                response.RootElement,
                "total_matched"
            ) == expected
        } catch (error WalletException) {
            if error.StatusCode == 400 {
                return false
            }
            throw error
        } finally {
            End()
        }
    }

    async func ExportViewKeysAsync(password[]char, ct CancellationToken = default(CancellationToken)) WalletViewKeys {
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            Touch()
            return await Node.Api.ViewKeysAsync(password, "", []char{}, ct)
        } finally {
            End()
        }
    }

    async func CreateViewOnlyAsync(
        filename string,
        password[]char,
        filePassword[]char,
        ct CancellationToken = default(CancellationToken)
    ) {
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            if !filename.EndsWith(".wallet.dat", StringComparison.Ordinal) {
                throw WalletException("View-only file name must end in .wallet.dat")
            }
            RequireNewWallet(filename, filePassword)
            if ReadOnlySpan[char](password).SequenceEqual(ReadOnlySpan[char](filePassword)) {
                throw WalletException("View-only file password must differ from the wallet password")
            }
            Touch()
            using let keys = await Node.Api.ViewKeysAsync(password, filename, filePassword, ct)
        } finally {
            End()
        }
    }

    async func ImportViewOnlyAsync(
        filename string,
        spendPublic[]char,
        viewPrivate[]char,
        password[]char,
        ct CancellationToken = default(CancellationToken)
    ) {
        await BeginAsync(ct)
        try {
            RequireUnloaded()
            RequireNewWallet(filename, password)
            await ConnectCoreAsync(ct)
            using let response = await Node.Api.JsonAsync(
                "wallet/import",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteString("filename", filename)
                    writer.WriteString("spend_pub", ReadOnlySpan[char](spendPublic))
                    writer.WriteString("view_priv", ReadOnlySpan[char](viewPrivate))
                    writer.WriteString("password", ReadOnlySpan[char](password))
                    writer.WriteEndObject()
                },
                ct
            )
            managed = true
            state = "Unlocked"
            page = "Wallet"
            Touch()
            settings.ActiveWallet = filename
            PublishEmpty()
            await WalletSettings.SaveAsync(settings, ct)
            await RefreshCoreAsync(ct)
        } finally {
            End()
        }
    }

    async func RefreshAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            if Node.Supervisor.NeedsRestart && settings.NodeMode != "manual" {
                Node.Reconnect()
                ClearSeed()
                InvalidateConfirmation()
                await ConnectCoreAsync(ct)
            } else {
                await Node.RefreshStatusAsync(ct)
                if state == "Unlocked" {
                    await RefreshCoreAsync(ct)
                }
            }
        } finally {
            End()
        }
    }

    private async func RefreshCoreAsync(ct CancellationToken) {
        RequireUnlocked()
        await RecoverSendCoreAsync(ct)
        try {
            using let balance = await Node.Api.JsonAsync("wallet/balance", ct: ct)
            using let address = await Node.Api.JsonAsync("wallet/address", ct: ct)
            let sends = await History.ReadSendsAsync(ct)
            let root = balance.RootElement
            let change = NodeJson.OptionalNumber(root, "pending_unconfirmed") ?? 0
            let amounts = WalletBalance{
                Scanning: NodeJson.Flag(root, "scanning"),
                ScanHeight: NodeJson.Number(root, "synced_height"),
                ChainHeight: NodeJson.Number(root, "chain_height"),
                Balance: NodeJson.OptionalNumber(root, "total") + change,
                Spendable: NodeJson.OptionalNumber(root, "spendable"),
                Pending: NodeJson.OptionalNumber(root, "pending") + change,
            }
            let outputs = await History.ReloadAsync(ct)
            snapshot = WalletSnapshot{
                Page: page,
                State: state,
                Connected: connected,
                Address: NodeJson.Text(address.RootElement, "address"),
                ViewOnly: NodeJson.Flag(address.RootElement, "view_only"),
                Balance: amounts,
                History: outputs,
                HistoryTotal: History.Total,
                HistoryMore: History.More,
                Sends: sends
            }
        } catch (error WalletException) {
            if error.StatusCode == 403 {
                state = "Locked"
                page = "Unlock"
                ClearSeed()
                InvalidateConfirmation()
                PublishEmpty()
            } else if error.StatusCode == 503 {
                state = "Unloaded"
                managed = false
                page = "Welcome"
                ClearSeed()
                InvalidateConfirmation()
                PublishEmpty()
            } else {
                PublishEmpty()
            }
            throw error
        } catch (error Exception) {
            PublishEmpty()
            if error is OperationCanceledException {
                throw error
            }
            throw WalletException("Daemon returned invalid wallet data")
        }
    }

    func PublishHistory(outputs[]WalletOutput) {
        snapshot = WalletSnapshot{
            ... snapshot,
            Page: page,
            State: state,
            Connected: connected,
            History: outputs,
            HistoryTotal: History.Total,
            HistoryMore: History.More
        }
    }

    async func EstimateAsync(
        address string,
        amount string,
        memo string,
        ct CancellationToken = default(CancellationToken)
    ) SendEstimate {
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            RequireNoPendingSend()
            InvalidateConfirmation()
            let request = WalletValidation.ValidateSend(
                address,
                amount,
                memo,
                snapshot.Balance?.Spendable ?? throw WalletException("Spendable balance is unavailable")
            )
            using let walletAddress = await Node.Api.JsonAsync("wallet/address", ct: ct)
            if NodeJson.Flag(walletAddress.RootElement, "view_only") {
                throw WalletException("View-only wallets cannot send")
            }
            var handle = ""
            var recipient = request.Address
            if recipient.StartsWith("$", StringComparison.Ordinal) {
                let resolved = await BlocknetId.ResolveAsync(recipient, ct)
                handle = resolved.Handle
                recipient = WalletValidation.ValidateAddress(resolved.Address)
            }
            await Task.Delay(2000, ct)
            using let result = await Node.Api.JsonAsync(
                "wallet/send",
                writer -> WriteSend(writer, recipient, request.Amount, request.Memo, true),
                ct
            )
            let root = result.RootElement
            if !NodeJson.Flag(root, "dry_run") {
                throw WalletException("Daemon did not return a dry-run estimate")
            }
            let fee = NodeJson.Number(root, "fee")
            let inputTotal = NodeJson.Number(root, "input_total")
            let change = NodeJson.Number(root, "change")
            if request.Amount > uint64.MaxValue - fee ||
                inputTotal < change ||
                inputTotal - change != request.Amount +
                fee {
                throw WalletException("Node returned an invalid send total")
            }
            if let available = snapshot.Balance?.Spendable {
                if request.Amount + fee > available {
                    throw WalletException("Amount and fee exceed spendable balance")
                }
            }
            let estimate = SendEstimate(
                recipient,
                request.Amount,
                request.Memo,
                fee,
                int32(NodeJson.Number(root, "input_count")),
                handle
            )
            confirmation = estimate
            confirmationKey = Guid.NewGuid().ToString("N")
            return estimate
        } finally {
            End()
        }
    }

    async func SubmitAsync(estimate SendEstimate, ct CancellationToken = default(CancellationToken)) SendResult {
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            RequireNoPendingSend()
            if !Object.ReferenceEquals(estimate, confirmation) {
                throw WalletException("Estimate is no longer valid. Request a new estimate")
            }
            let available = snapshot.Balance?.Spendable ?? throw WalletException("Spendable balance is unavailable")
            WalletValidation.ValidateSend(
                estimate.Address,
                WalletAmount.Format(estimate.Amount),
                estimate.Memo,
                available
            )
            if estimate.Total > available {
                throw WalletException("Amount and fee exceed spendable balance")
            }
            let key = confirmationKey
            InvalidateConfirmation()
            using let walletAddress = await Node.Api.JsonAsync("wallet/address", ct: ct)
            if NodeJson.Flag(walletAddress.RootElement, "view_only") {
                throw WalletException("View-only wallets cannot send")
            }
            using let body = MemoryStream()
            using let writer = Utf8JsonWriter(body)
            WriteSend(writer, estimate.Address, estimate.Amount, estimate.Memo, false)
            writer.Flush()
            let pending = PendingSend{
                Key: key,
                Body: Encoding.UTF8.GetString(body.GetBuffer(), 0, int32(body.Length)),
                Wallet: settings.ActiveWallet,
                Network: settings.Network,
                CoreStarted: Node.Api.ListenerStarted,
                Timestamp: DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            }
            SavePendingSend(pending)
            return await SubmitPendingCoreAsync(pending, ct)
        } finally {
            End()
        }
    }

    private func PendingSendPath() string -> Path.Combine(
        settings.DataDirectory,
        "gyroid-pending-send." + settings.ActiveWallet + ".json"
    )

    private func AcquireSendLease() {
        if sendLease != nil {
            return
        }
        let options = FileStreamOptions{
            Mode: FileMode.OpenOrCreate,
            Access: FileAccess.ReadWrite,
            Share: FileShare.None
        }
        if !OperatingSystem.IsWindows() {
            options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
        }
        try {
            sendLease = FileStream(PendingSendPath() + ".lock", options)
        } catch (error IOException) {
            throw WalletException("Another Gyroid process is handling this wallet's sends")
        }
    }

    private func LoadPendingSend() {
        let previous = pendingSend
        pendingSend = nil
        pendingSendError = ""
        if settings.ActiveWallet.Length == 0 {
            return
        }
        try {
            if (File.GetAttributes(PendingSendPath()) & FileAttributes.Directory) != 0 {
                throw WalletException("Pending send file is invalid")
            }
            using let json = JsonDocument.Parse(PrivateFiles.ReadText(PendingSendPath(), 16384, true))
            let root = json.RootElement
            var coreStarted int64 = 0
            if root.TryGetProperty("core_started", out let started) {
                coreStarted = started.GetInt64()
            }
            let pending = PendingSend{
                Key: NodeJson.Text(root, "idempotency_key"),
                Body: NodeJson.Text(root, "body"),
                Wallet: NodeJson.Text(root, "wallet"),
                Network: NodeJson.Text(root, "network"),
                CoreStarted: coreStarted,
                Timestamp: NodeJson.Signed(root, "timestamp")
            }
            if pending.Wallet != settings.ActiveWallet ||
                pending.Network != settings.Network ||
                pending
                .Key
                .Length == 0 ||
                pending
                .Body
                .Length == 0 ||
                pending.Timestamp <= 0 {
                throw WalletException("Pending send file is invalid")
            }
            using let body = JsonDocument.Parse(pending.Body)
            if let prior = previous {
                if prior.Key == pending.Key && prior.Body == pending.Body {
                    pending.State = prior.State
                    pending.CanRetry = prior.CanRetry
                }
            }
            pendingSend = pending
        } catch (error FileNotFoundException) { } catch (error DirectoryNotFoundException) { } catch (error Exception) {
            pendingSendError = "Pending send file is invalid or unreadable. Outcome unknown. Resolve the file before sending"
        }
    }

    private func SavePendingSend(pending PendingSend) {
        let path = PendingSendPath()
        PrivateFiles
            .WriteAtomic(
            path,
            stream -> {
                using let writer = Utf8JsonWriter(stream)
                writer.WriteStartObject()
                writer.WriteString("idempotency_key", pending.Key)
                writer.WriteString("body", pending.Body)
                writer.WriteString("wallet", pending.Wallet)
                writer.WriteString("network", pending.Network)
                writer.WriteNumber("timestamp", pending.Timestamp)
                writer.WriteNumber("core_started", pending.CoreStarted)
                writer.WriteEndObject()
                writer.Flush()
                return Task.CompletedTask
            },
            false,
            true
        )
            .GetAwaiter()
            .GetResult()
    }

    private func ClearPendingSend() {
        File.Delete(PendingSendPath())
        PrivateFiles.FlushDirectory(settings.DataDirectory)
        pendingSend = nil
    }

    private func RequireNoPendingSend() {
        AcquireSendLease()
        LoadPendingSend()
        if pendingSendError.Length > 0 {
            throw WalletException(pendingSendError)
        }
        if pendingSend != nil {
            throw WalletException("Resolve the pending send before starting another")
        }
    }

    private async func RecoverSendCoreAsync(ct CancellationToken) {
        try {
            AcquireSendLease()
            LoadPendingSend()
        } catch (error WalletException) {
            pendingSendError = error.Message
            return
        }
        guard let pending = pendingSend else {
            return
        }
        if pending.CanRetry {
            pendingSend = PendingSend{... pending, CanRetry: false}
        }
        try {
            using let response = await Node.Api.JsonAsync(
                "wallet/send/status?idempotency_key=" + Uri.EscapeDataString(pending.Key),
                ct: ct
            )
            let root = response.RootElement
            let status = NodeJson.Text(root, "state")
            if state == "Unlocked" {
                let sends = await History.ReadSendsAsync(ct)
                snapshot = WalletSnapshot{... snapshot, Sends: sends}
            }
            if status == "not_found" && state == "Unlocked" {
                using let body = JsonDocument.Parse(pending.Body)
                let recipients = body.RootElement.GetProperty("recipients")
                let recipient = recipients[0]
                for send in snapshot.Sends {
                    if send.Timestamp < pending.Timestamp || send.Recipients.Length != 1 {
                        continue
                    }
                    let recorded = send.Recipients[0]
                    if recorded.Address == NodeJson.Text(recipient, "address") && recorded.Amount == NodeJson.Number(
                        recipient,
                        "amount"
                    ) &&
                        recorded.Memo == NodeJson.Text(recipient, "memo_text") {
                        sendOutcome = "Submitted: " + send.TxId
                        ClearPendingSend()
                        return
                    }
                }
            }
            if status == "completed" && root.TryGetProperty("result", out let result) {
                let txid = NodeJson.Text(result, "txid")
                if txid.Length > 0 && !NodeJson.Flag(result, "dry_run") {
                    sendOutcome = "Submitted: " + txid
                    ClearPendingSend()
                }
            } else if status == "failed" {
                sendOutcome = "Send failed: " + NodeJson.Text(root, "error")
                ClearPendingSend()
            } else if status == "not_found" && state == "Unlocked" {
                pendingSend = PendingSend{
                    ... pending,
                    State: "No send record. Outcome unknown",
                    CanRetry: if pending.CoreStarted > 0 {
                        Math.Abs(pending.CoreStarted - Node.Api.ListenerStarted) < TimeSpan.TicksPerSecond
                    } else {
                        Node.Api.ListenerStarted < DateTimeOffset.FromUnixTimeSeconds(pending.Timestamp)
                            .UtcTicks +
                            TimeSpan.TicksPerSecond
                    }
                }
            }
        } catch (error WalletException) { }
    }

    private async func SubmitPendingCoreAsync(pending PendingSend, ct CancellationToken) SendResult {
        await Task.Delay(2000, ct)
        try {
            using let response = await Node.Api.JsonAsync(
                "wallet/send",
                writer -> writer.WriteRawValue(pending.Body, true),
                ct,
                pending.Key,
                true
            )
            let root = response.RootElement
            let txid = NodeJson.Text(root, "txid")
            if txid.Length == 0 || NodeJson.Flag(root, "dry_run") {
                throw WalletException("Invalid send response", 0, true)
            }
            var inputCount int32
            if let count = NodeJson.OptionalNumber(root, "input_count") {
                inputCount = int32(count)
            }
            let result = SendResult(txid, NodeJson.Number(root, "fee"), NodeJson.Number(root, "change"), inputCount)
            ClearPendingSend()
            if result.InputCount > 0 {
                return result
            }
            let inputs = await SubmittedInputCountAsync(txid)
            return SendResult(txid, result.Fee, result.Change, inputs)
        } catch (error WalletException) {
            await RecoverSendCoreAsync(CancellationToken.None)
            let outcome = sendOutcome
            sendOutcome = ""
            if pendingSend != nil {
                throw WalletException("Send outcome unknown. Resolve the pending send before starting another", 0, true)
            }
            if outcome.StartsWith("Submitted: ", StringComparison.Ordinal) {
                return SendResult(outcome.Substring(11), 0, 0, 0)
            }
            throw WalletException(outcome)
        }
    }

    private async func SubmittedInputCountAsync(txid string) int32 {
        using let deadline = CancellationTokenSource(TimeSpan.FromSeconds(5))
        try {
            using let response = await Node.Api.JsonAsync("tx/" + txid, ct: deadline.Token)
            if response.RootElement.TryGetProperty("tx", out let tx) && tx.TryGetProperty("inputs", out let inputs) &&
                inputs.ValueKind == JsonValueKind.Array {
                return inputs.GetArrayLength()
            }
        } catch (error WalletException) { }
        return 0
    }

    async func ResumeSendAsync(ct CancellationToken = default(CancellationToken)) SendResult {
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            await RecoverSendCoreAsync(ct)
            if pendingSendError.Length > 0 {
                throw WalletException(pendingSendError)
            }
            guard let pending = pendingSend else {
                if sendOutcome.StartsWith("Submitted: ", StringComparison.Ordinal) {
                    return SendResult(sendOutcome.Substring(11), 0, 0, 0)
                }
                throw WalletException(
                    if sendOutcome.Length > 0 {
                        sendOutcome
                    } else {
                        "No pending send"
                    }
                )
            }
            if !pending.Retryable {
                throw WalletException("Send outcome unknown. Resubmission is not available")
            }
            pendingSend = PendingSend{... pending, CanRetry: false}
            return await SubmitPendingCoreAsync(pending, ct)
        } finally {
            End()
        }
    }

    async func DismissSendAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            AcquireSendLease()
            LoadPendingSend()
            if pendingSendError.Length > 0 {
                throw WalletException(pendingSendError)
            }
            ClearPendingSend()
            sendOutcome = ""
        } finally {
            End()
        }
    }

    private func RequireUnloaded() {
        if managed || state != "Unloaded" {
            throw WalletException("Unload the current wallet explicitly before choosing or creating another")
        }
    }

    private func RequireManaged() {
        if !managed {
            throw WalletException("This application has not loaded a wallet. An external wallet will not be changed")
        }
    }

    func RequireUnlocked() {
        RequireManaged()
        if state != "Unlocked" {
            throw WalletException("Unlock the wallet first")
        }
    }

    private func WalletPath(filename string) string {
        WalletValidation.ValidateFilename(filename)
        let path = Path.Combine(settings.WalletDirectory, filename)
        if FileInfo(path).LinkTarget != nil {
            throw WalletException("Wallet files must not be symbolic links")
        }
        return path
    }

    private func RequireNewWallet(filename string, password[]char) {
        let error = WalletValidation.PasswordError(password, password)
        if error.Length > 0 {
            throw WalletException(error)
        }
        let path = WalletPath(filename)
        if File.Exists(path) || Directory.Exists(path) {
            throw WalletException("Wallet file already exists. Choose a different name")
        }
    }

    private func PublishEmpty() {
        History.Reset()
        snapshot = WalletSnapshot{Page: page, State: state, Connected: connected}
    }

    private func PublishCurrent() {
        snapshot = WalletSnapshot{
            Page: page,
            State: state,
            Connected: connected,
            Address: snapshot.Address,
            ViewOnly: snapshot.ViewOnly,
            Balance: snapshot.Balance,
            History: snapshot.History,
            HistoryTotal: History.Total,
            HistoryMore: History.More,
            Sends: snapshot.Sends
        }
    }

    private func ClearSeed() {
        if let seed = pendingSeed {
            Array.Clear(seed)
        }
        pendingSeed = nil
    }

    private func InvalidateConfirmation() {
        confirmation = nil
        confirmationKey = ""
    }

    func Dispose() {
        if disposed {
            return
        }
        disposed = true
        shutdown.Cancel()
        StopEvents()
        ClearSeed()
        InvalidateConfirmation()
        Node.Dispose()
        managed = false
        connected = false
        state = "Unloaded"
        page = "Welcome"
        PublishEmpty()
    }

    shared {
        private func WriteCredentials(
            writer Utf8JsonWriter,
            password[]char,
            filenameKey string = "",
            filename string = ""
        ) {
            writer.WriteStartObject()
            writer.WriteString("password", ReadOnlySpan[char](password))
            if filenameKey.Length > 0 {
                writer.WriteString(filenameKey, filename)
            }
            writer.WriteEndObject()
        }

        private func WriteEmpty(writer Utf8JsonWriter) {
            writer.WriteStartObject()
            writer.WriteEndObject()
        }

        private func WriteSend(writer Utf8JsonWriter, address string, amount uint64, memo string, dryRun bool) {
            writer.WriteStartObject()
            writer.WriteBoolean("dry_run", dryRun)
            writer.WriteStartArray("recipients")
            writer.WriteStartObject()
            writer.WriteString("address", address)
            writer.WriteNumber("amount", amount)
            if memo.Length > 0 {
                writer.WriteString("memo_text", memo)
            }
            writer.WriteEndObject()
            writer.WriteEndArray()
            writer.WriteEndObject()
        }
    }
}
