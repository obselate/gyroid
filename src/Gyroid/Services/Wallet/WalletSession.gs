package Gyroid.Services

import Goo
import Gyroid.Models
import Net.Codecrete.QrCodeGenerator
import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Net.Http
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class ReceivePrepared {
    var Request ReceiveRequest
    var Draft ReceiveDraft
    var Link string = ""
    var Payload string = ""
    var Shown string = ""
    var Code QrCode?
    var Path VectorPath = VectorPath.Empty
    var Paid WalletOutput?
    var Possible WalletOutput?
}

class WalletSession : IDisposable {
    var settings WalletSettings
    let Node NodeSession
    let Library WalletLibrary
    let Keys WalletKeys
    let Proofs MessageProofs
    let Mining MiningService
    let Checks PrivacyChecks
    let gate SemaphoreSlim = SemaphoreSlim(1, 1)
    let autoLockChanged chan[bool] = chan[bool](1)
    let restartRequested chan[bool] = chan[bool](1)
    let eventsChanged chan[bool] = chan[bool](1)
    let background Task
    var BackgroundError string = ""
    var snapshot WalletSnapshot = WalletSnapshot()
    let Send SendService
    let History HistoryService
    let Messages MessagingService
    var state WalletState = WalletState.Unloaded
    var connected bool
    var managed bool
    var isBusy bool
    var lockQueued bool
    var disposed bool
    var Changed Action? = nil
    let shutdown CancellationTokenSource = CancellationTokenSource()
    var events Context? = nil
    var eventsEnabled bool
    var eventsHealthy bool
    var nextRestart DateTimeOffset
    var restartAttempts int32
    var NodeError string = ""
    prop NodeRestartStopped bool -> restartAttempts >= 3 && NodeError.Length > 0
    var lastActivity int64 = WalletLockScheduler.Now()
    var scanUnchangedSince DateTimeOffset
    var scanRestarted bool

    prop Settings WalletSettings -> settings.Copy()
    prop Snapshot WalletSnapshot -> snapshot
    prop Busy bool -> isBusy
    prop State WalletState -> state
    prop LockQueued bool -> lockQueued

    init() {
        settings = NodeLocation.Load()
        Node = NodeSession(settings)
        History = HistoryService(this)
        Send = SendService(this)
        Messages = MessagingService(this)
        Library = WalletLibrary(this)
        Keys = WalletKeys(this)
        Proofs = MessageProofs(this)
        Mining = MiningService(this)
        Checks = PrivacyChecks(this)
        Node.Exited = () -> restartRequested.Writer.TryWrite(true)
        Node.Changed = () -> Changed?.Invoke()
        PublishEmpty()
        Node.Publish()
        background = RunBackgroundAsync(Context.FromToken(shutdown.Token))
    }

    async func BeginAsync(ct CancellationToken, notify bool = true) {
        if disposed {
            throw WalletException("Wallet controller is closed")
        }
        await gate.WaitAsync(ct)
        if disposed {
            gate.Release()
            throw WalletException("Wallet controller is closed")
        }
        isBusy = true
        if notify {
            Changed?.Invoke()
        }
    }

    func End(notify bool = true) {
        if disposed {
            Send.InvalidateConfirmation()
            managed = false
            connected = false
            state = WalletState.Unloaded
            PublishEmpty()
        }
        isBusy = false
        UpdateEvents()
        autoLockChanged.Writer.TryWrite(true)
        gate.Release()
        if !disposed && notify {
            Changed?.Invoke()
        }
    }

    func Touch() {
        Interlocked.Exchange(ref lastActivity, WalletLockScheduler.Now())
    }

    private func IdleExpired() bool -> settings.AutoLockMinutes > 0 && WalletLockScheduler.Now() - Interlocked.Read(
        ref lastActivity
    ) >= int64(settings.AutoLockMinutes) * 60000

    private async func RunBackgroundAsync(parentContext Context) {
        try {
            scope {
                go AutoLock(ctx)
                go RestartOwned(ctx)
                go ManageEvents(ctx)
                go Messages.Sync(ctx)
            }
        } catch (error OperationCanceledException) when shutdown.IsCancellationRequested { } catch (error Exception) {
            ReportBackgroundFailure(error)
        }
    }

    private func ReportBackgroundFailure(error Exception) {
        BackgroundError = "Wallet background task failed"
        Console.Error.WriteLine(BackgroundError + ": " + error.GetType().Name)
        Changed?.Invoke()
    }

    private func AutoLock(sessionContext Context) {
        let ct = sessionContext.Token
        while !sessionContext.IsCancelled {
            if settings.AutoLockMinutes == 0 || !managed || state != WalletState.Unlocked {
                let changed = <-autoLockChanged
                continue
            }
            let remaining = int64(settings.AutoLockMinutes) * 60000
            - (WalletLockScheduler.Now() - Interlocked.Read(ref lastActivity))
            if remaining > 0 {
                select {
                    case <- autoLockChanged { }
                    case <- after(TimeSpan.FromMilliseconds(remaining)) { }
                }
                continue
            }
            await BeginAsync(ct)
            try {
                if managed && state == WalletState.Unlocked && IdleExpired() {
                    await LockCoreAsync(ct)
                }
            } catch (error WalletException) {
                PublishEmpty()
            } finally {
                End()
            }
        }
    }

    func EnableEvents() {
        eventsEnabled = true
        UpdateEvents()
    }

    private func StopEvents() {
        eventsHealthy = false
        events?.TryCancel()
        eventsChanged.Writer.TryWrite(true)
    }

    private func UpdateEvents() {
        if disposed || !connected || state == WalletState.Locked || state == WalletState.Unknown {
            StopEvents()
        } else if eventsEnabled {
            eventsChanged.Writer.TryWrite(true)
        }
    }

    private func ManageEvents(sessionContext Context) {
        while !sessionContext.IsCancelled {
            let changed = <-eventsChanged
            scope {
                let listenerContext = ctx
                await gate.WaitAsync(listenerContext.Token)
                try {
                    if !disposed &&
                        connected &&
                        eventsEnabled &&
                        state != WalletState.Locked &&
                        state != WalletState.Unknown {
                        events = listenerContext
                        go ListenEvents(listenerContext)
                    }
                } finally {
                    gate.Release()
                }
            }
            events = nil
        }
    }

    private func ListenEvents(listenerContext Context) {
        let ct = listenerContext.Token
        try {
            while !listenerContext.IsCancelled {
                try {
                    await Node.Api.EventsAsync(_ -> RefreshEventAsync(ct), ct)
                } catch (error HttpRequestException) { } catch (error IOException) { } catch (error WalletException) { }
                await gate.WaitAsync(ct)
                try {
                    eventsHealthy = false
                    if Node.Status.Running || snapshot.Connected {
                        Node.Status = NodeStatus{... Node.Status, Running: false}
                        snapshot = WalletSnapshot{... snapshot, Connected: false}
                        Changed?.Invoke()
                    }
                } finally {
                    gate.Release()
                }
                await Task.Delay(2000, ct)
            }
        } catch (error OperationCanceledException) when listenerContext.IsCancelled { }
    }

    private async func RefreshEventAsync(ct CancellationToken) {
        await gate.WaitAsync(ct)
        let previous = snapshot
        let node = Node.Status
        let pending = Send.Pending
        let outcome = Send.Outcome
        let sendError = Send.Error
        try {
            ct.ThrowIfCancellationRequested()
            eventsHealthy = true
            await Node.RefreshStatusAsync(ct)
            if state == WalletState.Unlocked {
                await RefreshCoreAsync(ct)
            }
        } finally {
            UpdateEvents()
            gate.Release()
            if !disposed &&
                (
                !snapshot.Matches(previous) || !Node.Status.Matches(node) ||
                    Send
                    .Pending
                    ?.State != pending?.State ||
                    Send
                    .Pending
                    ?.Retryable != pending?.Retryable ||
                    Send.Outcome != outcome ||
                    Send.Error != sendError
            ) {
                Changed?.Invoke()
            }
        }
    }

    private func RestartOwned(sessionContext Context) {
        let ct = sessionContext.Token
        while !sessionContext.IsCancelled {
            let requested = <-restartRequested
            try {
                await Task.Delay(2000, ct)
                await gate.WaitAsync(ct)
                try {
                    if disposed ||
                        settings.NodeMode == "manual" ||
                        (!Node.Supervisor.NeedsRestart && NodeError.Length == 0) {
                        continue
                    }
                    if NodeError.Length == 0 && DateTimeOffset.UtcNow > nextRestart.AddMinutes(1) {
                        restartAttempts = 0
                    }
                    if Node.Supervisor.NeedsRestart {
                        NodeError = Node.Supervisor.ExitError
                    }
                    StopEvents()
                    connected = false
                    managed = false
                    Send.InvalidateConfirmation()
                    state = WalletState.Unloaded
                    PublishEmpty()
                    Node.Publish()
                    Changed?.Invoke()
                    if restartAttempts >= 3 {
                        continue
                    }
                    let delay = nextRestart - DateTimeOffset.UtcNow
                    if delay > TimeSpan.Zero {
                        await Task.Delay(delay, ct)
                    }
                    nextRestart = DateTimeOffset.UtcNow.AddSeconds(10)
                    restartAttempts++
                    Node.Reconnect()
                    await ConnectCoreAsync(ct)
                    UpdateEvents()
                } finally {
                    gate.Release()
                }
            } catch (error Exception) {
                Node.Publish()
                if restartAttempts < 3 {
                    restartRequested.Writer.TryWrite(true)
                }
            }
            if !disposed {
                Changed?.Invoke()
            }
        }
    }

    private async func ConnectCoreAsync(ct CancellationToken) {
        try {
            if !connected {
                Node.Supervisor.ReportProgress(NodePhase.Detecting, nil)
            }
            let walletFile = await Node.ConnectAsync(settings, ct)
            try {
                using let address = await Node.Api.JsonAsync("wallet/address", ct: ct)
                if state != WalletState.Unlocked {
                    Touch()
                }
                state = WalletState.Unlocked
            } catch (error WalletException) {
                if error.StatusCode == 403 {
                    state = WalletState.Locked
                } else if error.StatusCode == 503 {
                    state = WalletState.Unloaded
                } else {
                    throw error
                }
            }
            if state == WalletState.Unloaded {
                managed = false
            } else {
                let filename = Path.GetFileName(walletFile)
                Library.WalletPath(filename)
                if settings.ActiveWallet != filename {
                    settings.ActiveWallet = filename
                    await SettingsStore.SaveAsync(settings, ct)
                }
                managed = true
                Keys.BackupPending = File.Exists(Library.WalletPath(filename) + ".backup-pending")
            }
            connected = true
            NodeError = ""
            if managed {
                await Send.RecoverAsync(ct)
            }
            PublishCurrent()
        } catch (error Exception) {
            NodeError = if error is WalletException {
                error.Message
            } else {
                "Could not start the configured core executable"
            }
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
            restartAttempts = 0
            await ConnectCoreAsync(ct)
            if state == WalletState.Unlocked {
                await RefreshCoreAsync(ct)
            }
        } finally {
            End()
        }
    }

    func SettingsDirectoryExists(path string) bool -> Directory.Exists(path)

    func OpenSettingsDirectoryAsync(path string, ct CancellationToken) Task {
        let start = System.Diagnostics.ProcessStartInfo(
            OperatingSystem.IsWindows() ? "explorer.exe": OperatingSystem.IsMacOS() ? "open": "xdg-open"
        )
        start.ArgumentList.Add(path)
        System.Diagnostics.Process.Start(start)?.Dispose()
        return Task.CompletedTask
    }

    async func ReadSettingsChainAsync(value WalletSettings, ct CancellationToken) SettingsChainResult {
        let data = DirectoryInfo(value.DataDirectory)
        var size int64
        var wallets int32
        var local uint64
        if data.Exists {
            for file in data.EnumerateFiles(
                "*",
                EnumerationOptions{
                    RecurseSubdirectories: true,
                    IgnoreInaccessible: true,
                    AttributesToSkip: FileAttributes.ReparsePoint
                }
            ) {
                ct.ThrowIfCancellationRequested()
                size += file.Length
            }
            try {
                wallets = Library.DataWallets().Count
            } catch (failure Exception) {
                wallets = -1
            }
            let saved = FileInfo(Path.Combine(data.FullName, "checkpoints.dat"))
            if saved.Exists && saved.Length <= 1048576 {
                local = Checkpoints.Height(Checkpoints.Parse(File.ReadAllBytes(saved.FullName)))
            }
        }
        let free = DriveInfo(
            OperatingSystem.IsWindows() ? Path.GetPathRoot(data.FullName) ?? data.FullName:
            data.Exists ? data.FullName: data.Parent?.FullName ?? "/"
        ).AvailableFreeSpace
        let trusted = value.Network == "mainnet" ?
        Checkpoints.Height(Checkpoints.Parse(Resources.Resource("Gyroid.Checkpoints.Mainnet"))): uint64(0)
        var autoSave bool?
        try {
            autoSave = await CheckpointAutoSaveAsync(nil, ct)
        } catch (failure Exception) { }
        return SettingsChainResult{
            Size: size,
            Wallets: wallets,
            Free: free,
            Trusted: trusted,
            Local: local,
            AutoSave: autoSave
        }
    }

    async func ApplySettingsAsync(value WalletSettings, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            let next = SettingsValidation.Prepare(value, settings)
            StopEvents()
            await UnloadCoreAsync(ct)
            await SettingsStore.SaveAsync(next, ct, settings)
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
            PublishEmpty()
            Node.Publish()
            restartAttempts = 0
            await ConnectCoreAsync(ct)
        } finally {
            End()
        }
    }

    async func SaveAutoLockAsync(
        minutes int32,
        ct CancellationToken = default(CancellationToken),
        scheduleLock bool = false
    ) {
        await BeginAsync(ct)
        try {
            let next = settings.Copy()
            next.AutoLockMinutes = minutes
            SettingsValidation.Validate(next)
            await SettingsStore.SaveAsync(next, ct, settings)
            settings.AutoLockMinutes = minutes
            if minutes == 0 || scheduleLock {
                WalletLockScheduler.Cancel(settings)
            }
            if scheduleLock && minutes > 0 {
                try {
                    using let address = await Node.Api.JsonAsync("wallet/address", ct: ct)
                } catch (error WalletException) {
                    if error.StatusCode == 0 || error.StatusCode == 403 || error.StatusCode == 503 {
                        return
                    }
                    throw error
                }
                await WalletLockScheduler.ScheduleAsync(Node, minutes)
            }
            Touch()
            autoLockChanged.Writer.TryWrite(true)
        } finally {
            End()
        }
    }

    async func SavePrivacyAsync(value bool, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            let next = settings.Copy()
            next.Privacy = value
            await SettingsStore.SaveAsync(next, ct, settings)
            settings.Privacy = value
        } finally {
            End()
        }
    }

    async func SaveLanguageAsync(value string, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            let next = settings.Copy()
            next.Language = value
            await SettingsStore.SaveAsync(next, ct, settings)
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
            await SettingsStore.SaveAsync(next, ct, settings)
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

    async func PurgeDataAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            if Directory.Exists(settings.DataDirectory) && Directory.EnumerateFileSystemEntries(
                settings.DataDirectory,
                "gyroid-pending-send.*.json"
            )
                .Any() {
                throw WalletException("Resolve or dismiss all pending sends before purging blockchain data")
            }
            await ConnectCoreAsync(ct)
            if !Node.Supervisor.Owned {
                throw WalletException("This process does not own the node. External nodes are never stopped")
            }
            await UnloadCoreAsync(ct)
            await Library.PreserveBeforePurgeAsync(ct)
            using let result = await Node.Api.JsonAsync(
                "purge",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteBoolean("confirm", true)
                    writer.WriteEndObject()
                },
                ct
            )
            Node.StopOwned()
            Directory.CreateDirectory(settings.DataDirectory)
            using let marker = PrivateFiles.CreatePrivate(Path.Combine(settings.DataDirectory, "gyroid.owner"))
            let identity = Encoding.ASCII.GetBytes("Gyroid:" + settings.Network)
            marker.Write(identity, 0, identity.Length)
            marker.Flush(true)
            connected = false
            PublishEmpty()
            Node.Publish()
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

    func ApplyPreference(change Action[WalletSettings]) -> change(settings)

    async func SavePreferencesAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            await SettingsStore.SaveAsync(settings.Copy(), ct, settings)
        } finally {
            End()
        }
    }

    async func CertifyAsync(ct CancellationToken = default(CancellationToken)) ChainCertificate {
        await BeginAsync(ct)
        try {
            await ConnectCoreAsync(ct)
            using let result = await Node.Api.JsonAsync("certify", ct: ct)
            let violations = List[uint64]()
            if result.RootElement.TryGetProperty("violations", out let list) && list.ValueKind == JsonValueKind.Array {
                for item in list.EnumerateArray() {
                    violations.Add(NodeJson.Number(item, "height"))
                }
            }
            return ChainCertificate{
                Height: NodeJson.Number(result.RootElement, "height"),
                Violations: violations.ToArray(),
                Time: DateTimeOffset.Now
            }
        } finally {
            End()
        }
    }

    async func CheckpointsAsync(action string, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            await ConnectCoreAsync(ct)
            using let result = await Node.Api.JsonAsync("checkpoints/" + action, WriteEmpty, ct)
        } finally {
            End()
        }
    }

    async func CheckpointAutoSaveAsync(enabled bool?, ct CancellationToken = default(CancellationToken)) bool {
        await BeginAsync(ct)
        try {
            await ConnectCoreAsync(ct)
            let body Action[Utf8JsonWriter]? = if let value = enabled {
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteBoolean("save_checkpoints", value)
                    writer.WriteEndObject()
                }
            } else {
                nil
            }
            using let result = await Node.Api.JsonAsync(
                "settings",
                body,
                ct,
                method: enabled != nil ? HttpMethod.Patch: nil
            )
            return result.RootElement.TryGetProperty("settings", out let current) && NodeJson.Flag(
                current,
                "save_checkpoints"
            )
        } finally {
            End()
        }
    }

    private func StopNode() {
        if !Node.Supervisor.Owned {
            throw WalletException("This process does not own the node. External nodes are never stopped")
        }
        if managed || state != WalletState.Unloaded {
            throw WalletException("Unload the wallet before stopping or restarting the node")
        }
        Node.StopOwned()
        StopEvents()
        connected = false
        PublishEmpty()
        Node.Publish()
    }

    async func RefreshNodeAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct, false)
        let node = Node.Status
        try {
            try {
                if !await Node.TryAttachAsync(ct) {
                    return
                }
                await Node.RefreshStatusAsync(ct)
            } catch (error Exception) {
                Node.Publish()
                throw error
            }
        } finally {
            End(!Node.Status.Matches(node))
        }
    }

    async func RefreshStatusAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct, false)
        let previous = snapshot
        let node = Node.Status
        try {
            await Node.RefreshStatusAsync(ct)
            let current = Node.Status
            if state == WalletState.Unlocked &&
                (
                !eventsHealthy || snapshot.ScanBehind(current.Height) ||
                    current.Mempool != node.Mempool ||
                    current.MempoolBytes != node.MempoolBytes ||
                    current.BestHash != node.BestHash
            ) {
                await RefreshCoreAsync(ct)
            }
        } finally {
            End(!snapshot.Matches(previous) || !Node.Status.Matches(node))
        }
    }

    async func CreateAsync(filename string, password[]char, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            Library.RequireNewWallet(filename, password)
            await PrepareWalletAsync(ct)
            await ConnectCoreAsync(ct)
            await Keys.RequireBackupAsync(filename, ct)
            using let result = await Node.Api.JsonAsync(
                "wallet/create",
                writer -> WriteCredentials(writer, password, "filename", filename),
                ct
            )
            managed = true
            state = WalletState.Unlocked
            Touch()
            settings.ActiveWallet = filename
            PublishEmpty()
            await SettingsStore.SaveAsync(settings, ct)
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
            Library.RequireNewWallet(filename, password)
            let normalizedPhrase = WalletValidation.NormalizePhrase(phrase)
            normalized = normalizedPhrase
            await PrepareWalletAsync(ct)
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
            await ActivateCoreAsync(filename, ct)
        } finally {
            if let buffer = normalized {
                Array.Clear(buffer)
            }
            End()
        }
    }

    async func UnlockAsync(
        password[]char,
        ct CancellationToken = default(CancellationToken),
        scheduleLock bool = false
    ) {
        await BeginAsync(ct)
        try {
            if Encoding.UTF8.GetByteCount(password) < 3 {
                throw WalletException("Password must contain at least 3 UTF-8 bytes")
            }
            await ConnectCoreAsync(ct)
            if state == WalletState.Unloaded {
                if settings.ActiveWallet.Length == 0 {
                    throw WalletException("Choose a wallet first")
                }
                await LoadWalletCoreAsync(Library.WalletPath(settings.ActiveWallet), password, ct)
                managed = true
            } else {
                RequireManaged()
                using let result = await Node.Api.JsonAsync(
                    "wallet/unlock",
                    writer -> WriteCredentials(writer, password),
                    ct
                )
            }
            state = WalletState.Unlocked
            Keys.BackupPending = File.Exists(Library.WalletPath(settings.ActiveWallet) + ".backup-pending")
            Touch()
            try {
                WalletLockScheduler.Cancel(settings)
                if scheduleLock && settings.AutoLockMinutes > 0 {
                    await WalletLockScheduler.ScheduleAsync(Node, settings.AutoLockMinutes)
                }
            } catch (error Exception) {
                await LockCoreAsync(default(CancellationToken))
                throw WalletException("Could not schedule wallet auto-lock")
            }
            PublishEmpty()
            await RefreshCoreAsync(ct)
        } finally {
            End()
        }
    }

    async func LoadWalletCoreAsync(path string, password[]char, ct CancellationToken) {
        using let result = await Node.Api.JsonAsync(
            "wallet/load",
            writer -> WriteCredentials(writer, password, "filepath", path),
            ct
        )
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
        Send.InvalidateConfirmation()
        Messages.Reset()
        state = WalletState.Unknown
        PublishEmpty()
        Changed?.Invoke()
        try {
            using let result = await Node.Api.JsonAsync("wallet/lock", WriteEmpty, ct)
            state = WalletState.Locked
            WalletLockScheduler.Cancel(settings)
            PublishEmpty()
        } catch (error WalletException) {
            if error.StatusCode == 503 {
                state = WalletState.Unloaded
                managed = false
            } else if error.StatusCode == 403 {
                state = WalletState.Locked
            }
            PublishEmpty()
            throw error
        }
    }

    async func UnloadAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            await UnloadCoreAsync(ct)
            PublishEmpty()
        } finally {
            End()
        }
    }

    private async func UnloadCoreAsync(ct CancellationToken) {
        StopEvents()
        Send.InvalidateConfirmation()
        if managed {
            try {
                if state == WalletState.Unlocked {
                    using let locked = await Node.Api.JsonAsync("wallet/lock", WriteEmpty, ct)
                }
                using let result = await Node.Api.JsonAsync("wallet/unload", WriteEmpty, ct)
            } catch (error WalletException) {
                if error.StatusCode != 503 {
                    throw error
                }
            }
            WalletLockScheduler.Cancel(settings)
        }
        managed = false
        state = WalletState.Unloaded
        Send.Reset()
    }

    async func SyncAsync(ct CancellationToken = default(CancellationToken)) {
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
            while state == WalletState.Unlocked && !disposed {
                using let balance = await Node.Api.JsonAsync("wallet/balance", ct: token)
                if state != WalletState.Unlocked || disposed {
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
        ) when state != WalletState.Unlocked ||
            disposed { } catch (error ObjectDisposedException) when state != WalletState.Unlocked ||
            disposed { }
    }

    async func ActivateCoreAsync(filename string, ct CancellationToken) {
        managed = true
        connected = true
        state = WalletState.Unlocked
        settings.ActiveWallet = filename
        Keys.BackupPending = File.Exists(Library.WalletPath(filename) + ".backup-pending")
        Touch()
        PublishEmpty()
        await SettingsStore.SaveAsync(settings, ct)
        await RefreshCoreAsync(ct)
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
            Library.RequireNewWallet(filename, password)
            await PrepareWalletAsync(ct)
            await ConnectCoreAsync(ct)
            try {
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
            } catch (error WalletException) when error.StatusCode == 400 {
                throw WalletException("Check the spend public key and view private key")
            }
            await ActivateCoreAsync(filename, ct)
        } finally {
            End()
        }
    }

    async func RefreshAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct, false)
        let previous = snapshot
        let node = Node.Status
        let pending = Send.Pending
        let outcome = Send.Outcome
        let sendError = Send.Error
        try {
            if Node.Supervisor.NeedsRestart && settings.NodeMode != "manual" {
                restartRequested.Writer.TryWrite(true)
            }
            await Node.RefreshStatusAsync(ct)
            if state == WalletState.Unlocked {
                await RefreshCoreAsync(ct)
            }
        } finally {
            End(
                !snapshot.Matches(previous) || !Node.Status.Matches(node) ||
                    Send
                    .Pending
                    ?.State != pending?.State ||
                    Send
                    .Pending
                    ?.Retryable != pending?.Retryable ||
                    Send.Outcome != outcome ||
                    Send.Error != sendError
            )
        }
    }

    private async func RefreshCoreAsync(ct CancellationToken) {
        RequireUnlocked()
        let previousHeight = snapshot.Balance?.ScanHeight
        await Send.RecoverAsync(ct, false)
        try {
            using let balance = await Node.Api.JsonAsync("wallet/balance", ct: ct)
            if snapshot.Address.Length == 0 {
                using let address = await Node.Api.JsonAsync("wallet/address", ct: ct)
                snapshot = WalletSnapshot{
                    ... snapshot,
                    Address: NodeJson.Text(address.RootElement, "address"),
                    ViewOnly: NodeJson.Flag(address.RootElement, "view_only")
                }
                try {
                    Messages.UpdateWallet(address.RootElement)
                } catch (error Exception) {
                    Messages.Error = error.Message
                }
            }
            let sends = await History.ReadSendsAsync(ct)
            let root = balance.RootElement
            let change = NodeJson.OptionalNumber(root, "pending_unconfirmed") ??
                snapshot
                .Balance
                ?.Unconfirmed ??
                uint64(0)
            let amounts = WalletBalance{
                Scanning: NodeJson.Flag(root, "scanning"),
                ScanHeight: NodeJson.Number(root, "synced_height"),
                ChainHeight: NodeJson.Number(root, "chain_height"),
                Balance: (NodeJson.OptionalNumber(root, "total") + change) ?? snapshot.Balance?.Balance,
                Spendable: NodeJson.OptionalNumber(root, "spendable") ?? snapshot.Balance?.Spendable,
                Pending: (NodeJson.OptionalNumber(root, "pending") + change) ?? snapshot.Balance?.Pending,
                Unconfirmed: change,
                Outputs: NodeJson.OptionalNumber(root, "outputs_total") ?? uint64(0),
                MemoErrors: NodeJson.OptionalNumber(root, "memo_decrypt_failures") ?? uint64(0)
            }
            let outputs = await History.ReloadAsync(ct)
            snapshot = WalletSnapshot{
                State: state,
                Connected: connected,
                Address: snapshot.Address,
                ViewOnly: snapshot.ViewOnly,
                Balance: amounts,
                History: outputs,
                HistoryTotal: History.Total,
                HistoryMore: History.More,
                Sends: sends
            }
            Messages.QueueRefresh(History.DecodedReceived, History.RawSends, History.DecodedSends)
        } catch (error WalletException) {
            if error.StatusCode == 403 {
                state = WalletState.Locked
                Send.InvalidateConfirmation()
                PublishEmpty()
            } else if error.StatusCode == 503 {
                state = WalletState.Unloaded
                managed = false
                Send.InvalidateConfirmation()
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
        if let balance = snapshot.Balance {
            if Node
                .Status
                .Syncing ||
                balance.ScanHeight >= balance.ChainHeight ||
                balance.ScanHeight != previousHeight {
                scanUnchangedSince = default(DateTimeOffset)
                scanRestarted = false
            } else if scanUnchangedSince == default(DateTimeOffset) {
                scanUnchangedSince = DateTimeOffset.UtcNow
            } else if !scanRestarted && (DateTimeOffset.UtcNow - scanUnchangedSince).TotalSeconds >= 60 {
                scanRestarted = true
                using let response = await Node.Api.JsonAsync("wallet/sync", WriteEmpty, ct)
            }
        }
    }

    func PublishHistory(outputs[]WalletOutput) {
        snapshot = WalletSnapshot{
            ... snapshot,
            State: state,
            Connected: connected,
            History: outputs,
            HistoryTotal: History.Total,
            HistoryMore: History.More
        }
    }

    func PublishSends(sends[]WalletSend) {
        snapshot = WalletSnapshot{... snapshot, Sends: sends}
    }

    async func PrepareWalletAsync(ct CancellationToken) {
        if !managed && state != WalletState.Unloaded {
            throw WalletException("Unload the current wallet explicitly before choosing or creating another")
        }
        await UnloadCoreAsync(ct)
        PublishEmpty()
        Changed?.Invoke()
    }

    func RequireManaged() {
        if !managed {
            throw WalletException("This application has not loaded a wallet. An external wallet will not be changed")
        }
    }

    func RequireUnlocked() {
        RequireManaged()
        if state != WalletState.Unlocked {
            throw WalletException("Unlock the wallet first")
        }
    }

    func PublishEmpty() {
        scanUnchangedSince = default(DateTimeOffset)
        scanRestarted = false
        History.Reset()
        if state == WalletState.Locked || state == WalletState.Unloaded {
            Messages.Reset()
        }
        snapshot = WalletSnapshot{State: state, Connected: connected}
    }

    func PublishCurrent() {
        snapshot = WalletSnapshot{
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

    func Dispose() {
        if disposed {
            return
        }
        disposed = true
        Node.Exited = nil
        shutdown.Cancel()
        background.GetAwaiter().GetResult()
        autoLockChanged.Writer.TryComplete()
        restartRequested.Writer.TryComplete()
        eventsChanged.Writer.TryComplete()
        shutdown.Dispose()
        Send.InvalidateConfirmation()
        Node.Dispose()
        managed = false
        connected = false
        state = WalletState.Unloaded
        PublishEmpty()
    }

    shared {
        func PrepareReceive(
            request ReceiveRequest,
            address string,
            history[]WalletOutput,
            height uint64,
            previous ReceivePrepared?,
            ct CancellationToken
        ) ReceivePrepared {
            ct.ThrowIfCancellationRequested()
            request.Amount = request.Amount.Trim()
            request.Memo = request.Memo.Trim()
            let empty = request.Amount.Length == 0 && request.Memo.Length == 0
            if empty {
                request.Reference = ""
            } else if request.Reference.Length == 0 {
                request.Reference = "#" + Random.Shared.Next(0x1000000).ToString("x6")
                request.Since = height
                request.ExistingOutputs = HashSet[string](StringComparer.Ordinal)
                for output in history {
                    request.ExistingOutputs.Add(output.TxId + ":" + output.OutputIndex.ToString())
                }
            }
            let full = request.Memo.Length > 0 ? request.Memo + " " + request.Reference: request.Reference
            let draft = ReceiveDraft{
                Amount: request.Amount,
                Memo: request.Memo,
                Reference: request.Reference,
                FullMemo: full,
                AmountIssue: WalletValidation.AmountIssue(request.Amount),
                MemoIssue: WalletValidation.MemoIssue(full)
            }
            let query = List[string]()
            if draft.Amount.Length > 0 && draft.AmountIssue.Length == 0 {
                query.Add("amount=" + draft.Amount)
            }
            if full.Length > 0 && draft.MemoIssue.Length == 0 {
                query.Add("memo=" + Uri.EscapeDataString(full))
            }
            let link = "blocknet://" + address + (query.Count > 0 ? "?" + String.Join("&", query): "")
            let shown = empty && request.Format == "link" ? "address": request.Format
            let payload = shown == "address" ? address: link
            let result = ReceivePrepared{Request: request, Draft: draft, Link: link, Shown: shown, Payload: payload}
            let atoms = draft.Amount.Length > 0 && draft.AmountIssue.Length == 0 ? WalletAmount.Parse(
                draft.Amount
            ): uint64(0)
            if request.Reference.Length > 0 && (draft.Amount.Length == 0 || atoms > 0) {
                for output in history {
                    ct.ThrowIfCancellationRequested()
                    if output.Coinbase ||
                        output.BlockHeight != 0 &&
                        output.BlockHeight < request.Since ||
                        request
                        .ExistingOutputs
                        .Contains(output.TxId + ":" + output.OutputIndex.ToString()) {
                        continue
                    }
                    if atoms == 0 || output.Amount == atoms {
                        if output.Memo.Contains(request.Reference, StringComparison.Ordinal) {
                            result.Paid = output
                            break
                        }
                        if draft.Amount.Length > 0 && result.Possible == nil && output.Memo == request.Memo {
                            result.Possible = output
                        }
                    }
                }
            }
            if result.Paid != nil {
                result.Possible = nil
            }
            if previous != nil && previous.Payload == payload {
                result.Code = previous.Code
                result.Path = previous.Path
                return result
            }
            let code = QrCode.EncodeText(payload, QrCode.Ecc.Medium)
            result.Code = code
            let path = PathBuilder(0, 0, code.Size + 8, code.Size + 8)
            for y in 0 ... code.Size {
                ct.ThrowIfCancellationRequested()
                var x = 0
                while x < code.Size {
                    if !code.GetModule(x, y) {
                        x++
                        continue
                    }
                    let start = x
                    while x < code.Size && code.GetModule(x, y) {
                        x++
                    }
                    path.MoveTo(start + 4, y + 4)
                    path.LineTo(x + 4, y + 4)
                    path.LineTo(x + 4, y + 5)
                    path.LineTo(start + 4, y + 5)
                    path.Close()
                }
            }
            result.Path = path.Build()
            return result
        }

        async func ExportReceiveAsync(path string, code QrCode, ct CancellationToken) {
            ct.ThrowIfCancellationRequested()
            await File.WriteAllBytesAsync(path, code.ToPngBitmap(4, 8), ct)
        }

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

        func WriteEmpty(writer Utf8JsonWriter) {
            writer.WriteStartObject()
            writer.WriteEndObject()
        }
    }
}
