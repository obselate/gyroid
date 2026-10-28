package Gyroid.Wallet

import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Send
import Gyroid.Settings
import Gyroid.Tools
import System
import System.IO
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class WalletSession : IDisposable {
    var settings WalletSettings
    let Node NodeSession
    let Library WalletLibrary
    let Keys WalletKeys
    let Proofs MessageProofs
    let gate SemaphoreSlim = SemaphoreSlim(1, 1)
    let autoLockChanged SemaphoreSlim = SemaphoreSlim(0, 1)
    var snapshot WalletSnapshot = WalletSnapshot()
    let Send SendService
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
    prop State string -> state
    prop LockQueued bool -> lockQueued

    init() {
        settings = WalletSettings.Load()
        Node = NodeSession(settings)
        History = HistoryService(this)
        Send = SendService(this)
        Library = WalletLibrary(this)
        Keys = WalletKeys(this)
        Proofs = MessageProofs(this)
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
            Keys.ClearSeed()
            Send.InvalidateConfirmation()
            managed = false
            connected = false
            state = "Unloaded"
            page = "Welcome"
            PublishEmpty()
        }
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
                Keys.ClearSeed()
                Send.InvalidateConfirmation()
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
                    Library.WalletPath(filename)
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
                await Send.RecoverAsync(ct)
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
                NodeDiscovery.Discover(next)
            }
            next.Validate()
            if next.BinaryPath != settings.BinaryPath && next.BinaryPath.Length > 0 {
                let program = NodeDiscovery.ProgramError(next.BinaryPath)
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

    async func CreateAsync(filename string, password[]char, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            RequireUnloaded()
            Library.RequireNewWallet(filename, password)
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
            await Keys.ReadSeedAsync(password, ct)
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
            Library.RequireNewWallet(filename, password)
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
            if Encoding.UTF8.GetByteCount(password) < 3 {
                throw WalletException("Password must contain at least 3 UTF-8 bytes")
            }
            await ConnectCoreAsync(ct)
            if state == "Unloaded" {
                if settings.ActiveWallet.Length == 0 {
                    throw WalletException("Choose a wallet first")
                }
                Library.WalletPath(settings.ActiveWallet)
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
        Keys.ClearSeed()
        Send.InvalidateConfirmation()
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
        Keys.ClearSeed()
        Send.InvalidateConfirmation()
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
            Library.RequireNewWallet(filename, password)
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
                Keys.ClearSeed()
                Send.InvalidateConfirmation()
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
        await Send.RecoverAsync(ct)
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
            let outputs = await History.ReloadAsync(sends, ct)
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
                Keys.ClearSeed()
                Send.InvalidateConfirmation()
                PublishEmpty()
            } else if error.StatusCode == 503 {
                state = "Unloaded"
                managed = false
                page = "Welcome"
                Keys.ClearSeed()
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

    func PublishSends(sends[]WalletSend) {
        snapshot = WalletSnapshot{... snapshot, Sends: sends}
    }

    func RequireUnloaded() {
        if managed || state != "Unloaded" {
            throw WalletException("Unload the current wallet explicitly before choosing or creating another")
        }
    }

    func RequireManaged() {
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

    func PublishEmpty() {
        History.Reset()
        snapshot = WalletSnapshot{Page: page, State: state, Connected: connected}
    }

    func PublishCurrent() {
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

    func Dispose() {
        if disposed {
            return
        }
        disposed = true
        shutdown.Cancel()
        StopEvents()
        Keys.ClearSeed()
        Send.InvalidateConfirmation()
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
    }
}
