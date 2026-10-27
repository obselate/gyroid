package Gyroid.Services

import Gyroid.Model
import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class WalletController : IDisposable {
    var settings WalletSettings
    var rpc WalletRpc
    let daemon WalletDaemon = WalletDaemon()
    let gate SemaphoreSlim = SemaphoreSlim(1, 1)
    var snapshot WalletSnapshot = WalletSnapshot()
    var nodeStatus NodeStatus = NodeStatus()
    var pendingSeed[]?char = nil
    var confirmation SendEstimate? = nil
    var confirmationKey string = ""
    var state string = "Unloaded"
    var page string = "Welcome"
    var connected bool
    var managed bool
    var isBusy bool
    var lockQueued bool
    var disposed bool
    var Changed Action? = nil

    prop Settings WalletSettings -> settings.Copy()
    prop Snapshot WalletSnapshot -> snapshot
    prop NodeStatus NodeStatus -> nodeStatus
    prop Busy bool -> isBusy
    prop LockQueued bool -> lockQueued
    prop NodeProgress string -> nodeProgress
    var nodeProgress string = ""

    init() {
        settings = WalletSettings.Load()
        rpc = WalletRpc(settings)
        daemon.Progress = value -> {
            nodeProgress = value
            nodeStatus.Progress = value
            Changed?.Invoke()
        }
        if settings.ActiveWallet.Length > 0 {
            page = "Unlock"
        }
        PublishEmpty()
        PublishNode()
    }

    private async func BeginAsync(ct CancellationToken) {
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

    private func End() {
        if disposed {
            ClearSeed()
            InvalidateConfirmation()
            managed = false
            connected = false
            state = "Unloaded"
            page = "Welcome"
            PublishEmpty()
        }
        isBusy = false
        gate.Release()
        if !disposed {
            Changed?.Invoke()
        }
    }

    private async func ConnectCoreAsync(ct CancellationToken) {
        try {
            if !connected {
                daemon.Progress?.Invoke("Detecting")
            }
            let endpoint = settings.Endpoint
            await daemon.ConnectAsync(settings, ct)
            if endpoint != settings.Endpoint {
                rpc.Dispose()
                rpc = WalletRpc(settings)
            }
            using let health = await rpc.JsonAsync("health", ct: ct)
            using let configuration = await rpc.JsonAsync("settings", ct: ct)
            let walletFile = WalletJson.Text(configuration.RootElement.GetProperty("settings"), "wallet_file")
            if !Path.IsPathFullyQualified(walletFile) {
                throw WalletException(
                    "Core wallet_file must be an absolute path. Configure the external daemon explicitly"
                )
            }
            let parent = Path.GetDirectoryName(walletFile) ??
                throw WalletException("Core wallet_file must have a parent directory")
            let directory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(parent))
            settings.WalletDirectory = directory
            let comparison = if OperatingSystem.IsWindows() {
                StringComparison.OrdinalIgnoreCase
            } else {
                StringComparison.Ordinal
            }
            await RefreshNodeCoreAsync(ct)
            try {
                using let address = await rpc.JsonAsync("wallet/address", ct: ct)
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
            PublishCurrent()
        } catch (error Exception) {
            PublishNode()
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
            await UnloadCoreAsync(ct)
            await WalletSettings.SaveAsync(next, ct)
            if daemon.Owned && next.StartupDiffers(settings) {
                daemon.Stop()
                next.OwnedProcessId = 0
            } else {
                next.OwnedProcessId = settings.OwnedProcessId
            }
            rpc.Dispose()
            settings = next
            rpc = WalletRpc(settings)
            connected = false
            page = if settings.ActiveWallet.Length == 0 {
                "Welcome"
            } else {
                "Unlock"
            }
            PublishEmpty()
            PublishNode()
            await ConnectCoreAsync(ct)
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
        if !daemon.Owned {
            throw WalletException("This process does not own the node. External nodes are never stopped")
        }
        if managed || state != "Unloaded" {
            throw WalletException("Unload the wallet before stopping or restarting the node")
        }
        daemon.Stop()
        settings.OwnedProcessId = 0
        rpc.Dispose()
        rpc = WalletRpc(settings)
        connected = false
        PublishEmpty()
        PublishNode()
    }

    async func RefreshNodeAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            let endpoint = settings.Endpoint
            if !await daemon.TryAttachAsync(settings, ct) {
                PublishNode()
                return
            }
            if endpoint != settings.Endpoint {
                rpc.Dispose()
                rpc = WalletRpc(settings)
            }
            await RefreshNodeCoreAsync(ct)
        } catch (error Exception) {
            PublishNode()
            throw error
        } finally {
            End()
        }
    }

    private async func RefreshNodeCoreAsync(ct CancellationToken) {
        try {
            using let status = await rpc.JsonAsync("status", ct: ct)
            let root = status.RootElement
            nodeStatus = NodeStatus{
                Source: daemon.Source,
                Owned: daemon.Owned,
                Running: true,
                Version: "0.22.0",
                Network: settings.Network,
                Height: WalletJson.Number(root, "chain_height"),
                ChainHeight: WalletJson.OptionalNumber(root, "sync_target") ?? WalletJson.Number(root, "chain_height"),
                Syncing: WalletJson.Flag(root, "syncing"),
                SyncProgress: WalletJson.OptionalNumber(root, "sync_progress"),
                Peers: WalletJson.Number(root, "peers"),
                Endpoint: settings.Endpoint,
                DataDirectory: settings.DataDirectory,
                Executable: daemon.Executable,
                Progress: nodeProgress
            }
        } catch (error Exception) {
            PublishNode()
            throw error
        }
    }

    private func PublishNode() {
        nodeStatus = NodeStatus{
            Source: if daemon.Executable.Length > 0 {
                daemon.Source
            } else if settings.BinaryPath == settings.LauncherBinaryPath && settings.BinaryPath.Length > 0 {
                "Launcher"
            } else {
                "Gyroid"
            },
            Owned: daemon.Owned,
            Network: settings.Network,
            Endpoint: settings.Endpoint,
            DataDirectory: settings.DataDirectory,
            Executable: if daemon.Executable.Length > 0 {
                daemon.Executable
            } else {
                settings.BinaryPath
            },
            Progress: nodeProgress
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
                using let input = WalletFiles.OpenRead(absolutePath)
                let filename = Path.GetFileName(absolutePath)
                let destination = WalletPath(filename)
                if Path.GetFullPath(absolutePath) != Path.GetFullPath(destination) {
                    Directory.CreateDirectory(settings.WalletDirectory)
                    let temporary = Path.Combine(settings.WalletDirectory, ".import-" + Guid.NewGuid().ToString("N"))
                    try {
                        using let output = WalletFiles.CreatePrivate(temporary)
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
            using let result = await rpc.JsonAsync(
                "wallet/create",
                writer -> WriteCredentials(writer, password, "filename", filename),
                ct
            )
            managed = true
            state = "Unlocked"
            page = "Wallet"
            settings.ActiveWallet = filename
            PublishEmpty()
            await WalletSettings.SaveAsync(settings, ct)
            ClearSeed()
            pendingSeed = await rpc.SeedAsync(password, ct)
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
            using let result = await rpc.JsonAsync(
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
                using let result = await rpc.JsonAsync(
                    "wallet/load",
                    writer -> WriteCredentials(writer, password, "filepath", settings.ActiveWallet),
                    ct
                )
                managed = true
            } else {
                RequireManaged()
                using let result = await rpc.JsonAsync(
                    "wallet/unlock",
                    writer -> WriteCredentials(writer, password),
                    ct
                )
            }
            state = "Unlocked"
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
            lockQueued = false
            RequireManaged()
            ClearSeed()
            InvalidateConfirmation()
            state = "Unknown"
            page = "Unlock"
            PublishEmpty()
            Changed?.Invoke()
            try {
                using let result = await rpc.JsonAsync("wallet/lock", WriteEmpty, ct)
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
        } finally {
            lockQueued = false
            End()
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
        ClearSeed()
        InvalidateConfirmation()
        if managed {
            try {
                if state == "Unlocked" {
                    using let locked = await rpc.JsonAsync("wallet/lock", WriteEmpty, ct)
                }
                using let result = await rpc.JsonAsync("wallet/unload", WriteEmpty, ct)
            } catch (error WalletException) {
                if error.StatusCode != 503 {
                    throw error
                }
            }
        }
        managed = false
        state = "Unloaded"
    }

    async func RevealSeedAsync(password[]char, ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            RequireUnlocked()
            if snapshot.ViewOnly {
                throw WalletException("View-only wallets do not have a spend recovery phrase")
            }
            ClearSeed()
            pendingSeed = await rpc.SeedAsync(password, ct)
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

    async func ExportSeedAsync(destination Stream, seed[]char, ct CancellationToken = default(CancellationToken)) {
        let bytes = [Encoding.UTF8.GetMaxByteCount(seed.Length)]uint8
        try {
            let count = Encoding.UTF8.GetBytes(seed, 0, seed.Length, bytes, 0)
            for index in 0 ... count {
                if bytes[index] == 32 {
                    bytes[index] = 10
                }
            }
            await destination.WriteAsync(bytes, 0, count, ct)
            await destination.FlushAsync(ct)
        } finally {
            Array.Clear(bytes)
        }
    }

    async func RefreshAsync(ct CancellationToken = default(CancellationToken)) {
        await BeginAsync(ct)
        try {
            if daemon.NeedsRestart {
                rpc.Dispose()
                rpc = WalletRpc(settings)
                ClearSeed()
                InvalidateConfirmation()
                await ConnectCoreAsync(ct)
            } else {
                await RefreshNodeCoreAsync(ct)
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
        try {
            using let balance = await rpc.JsonAsync("wallet/balance", ct: ct)
            using let address = await rpc.JsonAsync("wallet/address", ct: ct)
            using let history = await rpc.JsonAsync("wallet/history", ct: ct)
            let sends = await ReadSendsAsync(ct)
            let root = balance.RootElement
            let amounts = WalletBalance{
                Scanning: WalletJson.Flag(root, "scanning"),
                ScanHeight: WalletJson.Number(root, "synced_height"),
                ChainHeight: WalletJson.Number(root, "chain_height"),
                Balance: WalletJson.OptionalNumber(root, "total"),
                Spendable: WalletJson.OptionalNumber(root, "spendable"),
                Pending: WalletJson.OptionalNumber(root, "pending"),
                PendingUnconfirmed: WalletJson.OptionalNumber(root, "pending_unconfirmed"),
                OutputsTotal: WalletJson.OptionalNumber(root, "outputs_total"),
                OutputsUnspent: WalletJson.OptionalNumber(root, "outputs_unspent"),
                MemoDecryptFailures: WalletJson.OptionalNumber(root, "memo_decrypt_failures"),
                MemoDecryptLastHeight: WalletJson.OptionalNumber(root, "memo_decrypt_last_height")
            }
            if root.TryGetProperty("pending_unconfirmed_eta", out let eta) {
                amounts.PendingUnconfirmedEta = eta.GetInt64()
            }
            let outputs = List[WalletOutput]()
            for row in history.RootElement.GetProperty("outputs").EnumerateArray() {
                let hex = WalletJson.Text(row, "memo_hex")
                outputs.Add(
                    WalletOutput{
                        TxId: WalletJson.Text(row, "txid"),
                        OutputIndex: int32(WalletJson.Number(row, "output_index")),
                        Amount: WalletJson.Number(row, "amount"),
                        BlockHeight: WalletJson.Number(row, "block_height"),
                        IsCoinbase: WalletJson.Flag(row, "is_coinbase"),
                        Spent: WalletJson.Flag(row, "spent"),
                        SpentHeight: WalletJson.OptionalNumber(row, "spent_height"),
                        MemoHex: hex,
                        Memo: WalletJson.Memo(hex)
                    }
                )
            }
            snapshot = WalletSnapshot{
                Page: page,
                State: state,
                Connected: connected,
                OwnedDaemon: daemon.Owned,
                Address: WalletJson.Text(address.RootElement, "address"),
                ViewOnly: WalletJson.Flag(address.RootElement, "view_only"),
                Balance: amounts,
                History: outputs.ToArray(),
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

    private async func ReadSendsAsync(ct CancellationToken)[]WalletSend {
        let sends = List[WalletSend]()
        var offset int32 = 0
        while true {
            using let response = await rpc.JsonAsync(
                "wallet/sends?limit=500&offset=" + offset.ToString() + "&order=desc",
                ct: ct
            )
            let root = response.RootElement
            let rows = root.GetProperty("sends")
            for row in rows.EnumerateArray() {
                let recipients = List[WalletRecipient]()
                for recipient in row.GetProperty("recipients").EnumerateArray() {
                    let hex = WalletJson.Text(recipient, "memo_hex")
                    recipients.Add(
                        WalletRecipient{
                            Address: WalletJson.Text(recipient, "address"),
                            Amount: WalletJson.Number(recipient, "amount"),
                            MemoHex: hex,
                            Memo: WalletJson.Memo(hex)
                        }
                    )
                }
                sends.Add(
                    WalletSend{
                        TxId: WalletJson.Text(row, "txid"),
                        Timestamp: WalletJson.Signed(row, "timestamp"),
                        RecordedHeight: WalletJson.Number(row, "recorded_height"),
                        Status: WalletJson.Text(row, "chain_state"),
                        Confirmations: WalletJson.Number(row, "confirmations"),
                        InMempool: WalletJson.Flag(row, "in_mempool"),
                        Fee: WalletJson.Number(row, "fee"),
                        Amount: WalletJson.Number(row, "total_amount"),
                        Recipients: recipients.ToArray()
                    }
                )
            }
            offset = offset + rows.GetArrayLength()
            if uint64(offset) >= WalletJson.Number(root, "total") {
                return sends.ToArray()
            }
            if rows.GetArrayLength() == 0 {
                throw WalletException("Daemon returned an incomplete outgoing history page")
            }
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
            InvalidateConfirmation()
            let request = ValidateSend(
                address,
                amount,
                memo,
                snapshot.Balance?.Spendable ?? throw WalletException("Spendable balance is unavailable")
            )
            using let walletAddress = await rpc.JsonAsync("wallet/address", ct: ct)
            if WalletJson.Flag(walletAddress.RootElement, "view_only") {
                throw WalletException("View-only wallets cannot send")
            }
            var handle = ""
            var recipient = request.Address
            if recipient.StartsWith("$", StringComparison.Ordinal) {
                let resolved = await BlocknetId.ResolveAsync(recipient, ct)
                handle = resolved.Handle
                recipient = ValidateAddress(resolved.Address)
            }
            using let result = await rpc.JsonAsync(
                "wallet/send",
                writer -> WriteSend(writer, recipient, request.Amount, request.Memo, true),
                ct
            )
            let root = result.RootElement
            if !WalletJson.Flag(root, "dry_run") {
                throw WalletException("Daemon did not return a dry-run estimate")
            }
            let fee = WalletJson.Number(root, "fee")
            let inputTotal = WalletJson.Number(root, "input_total")
            let change = WalletJson.Number(root, "change")
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
                int32(WalletJson.Number(root, "input_count")),
                change,
                inputTotal,
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
            if !Object.ReferenceEquals(estimate, confirmation) {
                throw WalletException("Estimate is no longer valid. Request a new estimate")
            }
            let available = snapshot.Balance?.Spendable ?? throw WalletException("Spendable balance is unavailable")
            ValidateSend(estimate.Address, WalletAmount.Format(estimate.Amount), estimate.Memo, available)
            if estimate.Total > available {
                throw WalletException("Amount and fee exceed spendable balance")
            }
            let key = confirmationKey
            InvalidateConfirmation()
            using let walletAddress = await rpc.JsonAsync("wallet/address", ct: ct)
            if WalletJson.Flag(walletAddress.RootElement, "view_only") {
                throw WalletException("View-only wallets cannot send")
            }
            using let result = await rpc.JsonAsync(
                "wallet/send",
                writer -> WriteSend(writer, estimate.Address, estimate.Amount, estimate.Memo, false),
                ct,
                key,
                true
            )
            try {
                let root = result.RootElement
                let txId = WalletJson.Text(root, "txid")
                if txId.Length == 0 || WalletJson.Flag(root, "dry_run") {
                    throw WalletException("Invalid send response")
                }
                return SendResult(txId, WalletJson.Number(root, "fee"), WalletJson.Number(root, "change"))
            } catch (error Exception) {
                throw WalletException("Send outcome is unknown. Refresh outgoing sends before any new attempt", 0, true)
            }
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

    private func RequireUnlocked() {
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
        snapshot = WalletSnapshot{Page: page, State: state, Connected: connected, OwnedDaemon: daemon.Owned}
    }

    private func PublishCurrent() {
        snapshot = WalletSnapshot{
            Page: page,
            State: state,
            Connected: connected,
            OwnedDaemon: daemon.Owned,
            Address: snapshot.Address,
            ViewOnly: snapshot.ViewOnly,
            Balance: snapshot.Balance,
            History: snapshot.History,
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
        ClearSeed()
        InvalidateConfirmation()
        rpc.Dispose()
        daemon.Dispose()
        managed = false
        connected = false
        state = "Unloaded"
        page = "Welcome"
        PublishEmpty()
    }

    shared {
        let MemoLimit int32 = 124
        private let memoEncoding UTF8Encoding = UTF8Encoding(false, true)

        func ValidateAddress(address string) string {
            let recipient = address.Trim()
            if recipient.Length < 64 || recipient.Length > 93 {
                throw WalletException("Address must contain 64 to 93 Base58 characters")
            }
            for character in recipient {
                if !"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".Contains(character) {
                    throw WalletException("Address contains an invalid character")
                }
            }
            return recipient
        }

        func MemoBytes(memo string) int32 {
            for character in memo {
                if char.IsControl(character) {
                    throw WalletException("Memo cannot contain control characters")
                }
            }
            try {
                let count = memoEncoding.GetByteCount(memo)
                if count > MemoLimit {
                    throw WalletException("Memo must not exceed 124 UTF-8 bytes")
                }
                return count
            } catch (error EncoderFallbackException) {
                throw WalletException("Memo must contain valid Unicode text")
            }
        }

        func ValidateSend(address string, amount string, memo string, spendable uint64? = nil) WalletRecipient {
            let recipient = address.Trim()
            let destination = if recipient.StartsWith("$", StringComparison.Ordinal) {
                "$" + BlocknetId.Normalize(recipient)
            } else {
                ValidateAddress(recipient)
            }
            let atoms = WalletAmount.Parse(amount)
            MemoBytes(memo)
            if let available = spendable {
                if atoms > available {
                    throw WalletException("Amount exceeds spendable balance")
                }
            }
            return WalletRecipient{Address: destination, Amount: atoms, Memo: memo}
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

    async func OpenCliAsync(ct CancellationToken = default(CancellationToken)) JsonDocument {
        await BeginAsync(ct)
        try {
            await ConnectCoreAsync(ct)
            return await rpc.JsonAsync("status", ct: ct)
        } finally {
            End()
        }
    }
}
