package Gyroid.Node

import Gyroid.Platform
import Gyroid.Settings
import System
import System.Diagnostics
import System.IO
import System.Text.Json
import System.Threading

class NodeSession : IDisposable {
    var Settings WalletSettings
    var Api NodeApi
    let Supervisor NodeSupervisor = NodeSupervisor()
    var Status NodeStatus = NodeStatus()
    var Changed Action? = nil
    var Exited Action? = nil
    private var heightChanged int64

    init(settings WalletSettings) {
        Settings = settings
        Api = NodeApi(settings)
        Supervisor.Exited = () -> Exited?.Invoke()
        Supervisor.Progress = value -> {
            Status = NodeStatus{
                ... Status,
                Progress: value,
                Phase: if value == "Detecting" {
                    "Detecting"
                } else {
                    Supervisor.Phase
                },
                DownloadPercent: Supervisor.DownloadPercent
            }
            Changed?.Invoke()
        }
        Publish()
    }

    func Reconnect() {
        Api.Dispose()
        Api = NodeApi(Settings)
    }

    async func ConnectAsync(settings WalletSettings, ct CancellationToken) string {
        Settings = settings
        let endpoint = Settings.Endpoint
        await Supervisor.ConnectAsync(Settings, ct)
        if endpoint != Settings.Endpoint {
            Reconnect()
        }
        using let health = await Api.JsonAsync("health", ct: ct)
        using let configuration = await Api.JsonAsync("settings", ct: ct)
        let walletFile = NodeJson.Text(configuration.RootElement.GetProperty("settings"), "wallet_file")
        if !Path.IsPathFullyQualified(walletFile) {
            throw WalletException("Core wallet_file must be an absolute path. Configure the external daemon explicitly")
        }
        let parent = Path.GetDirectoryName(walletFile) ??
            throw WalletException("Core wallet_file must have a parent directory")
        let directory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(parent))
        Settings.WalletDirectory = directory
        await RefreshStatusAsync(ct)
        return walletFile
    }

    async func TryAttachAsync(ct CancellationToken) bool {
        let endpoint = Settings.Endpoint
        if !await Supervisor.TryAttachAsync(Settings, ct) {
            Publish()
            ThrowIfCoreExited()
            return false
        }
        if endpoint != Settings.Endpoint {
            Reconnect()
        }
        return true
    }

    func StopOwned() {
        Supervisor.Stop()
        Settings.OwnedProcessId = 0
        Reconnect()
    }

    async func RefreshStatusAsync(ct CancellationToken) {
        try {
            using let status = await Api.JsonAsync("status", ct: ct)
            let root = status.RootElement
            let current = NodeStatus{
                Source: Supervisor.Source,
                Owned: Supervisor.Owned,
                Running: true,
                Version: if Supervisor.Owned {
                    CoreRelease.Version
                } else {
                    ""
                },
                Network: Settings.Network,
                Height: NodeJson.Number(root, "chain_height"),
                ChainHeight: NodeJson.OptionalNumber(root, "sync_target") ?? NodeJson.Number(root, "chain_height"),
                Syncing: NodeJson.Flag(root, "syncing"),
                SyncProgress: NodeJson.OptionalNumber(root, "sync_progress"),
                Peers: NodeJson.Number(root, "peers"),
                Mempool: NodeJson.Number(root, "mempool_size"),
                Endpoint: Settings.Endpoint,
                DataDirectory: Settings.DataDirectory,
                Executable: Supervisor.Executable,
                Progress: Status.Progress,
                Phase: if Supervisor.Phase.Length > 0 {
                    Supervisor.Phase
                } else if NodeJson.Flag(root, "syncing") {
                    "ChainSync"
                } else {
                    ""
                },
                DownloadPercent: Supervisor.DownloadPercent,
            }
            if Settings.Network == "mainnet" && root.TryGetProperty("network_upgrade", out let upgrade) &&
                upgrade.ValueKind == JsonValueKind
                .Object {
                current.UpgradeDate = NodeJson.Text(upgrade, "date")
                current.UpgradeDeadline = NodeJson.Text(upgrade, "migration_deadline")
                current.UpgradeNotice = NodeJson.Text(upgrade, "notice")
                current.UpgradeBlocksLeft = if current.Height < CoreRelease.UpgradeHeight {
                    CoreRelease.UpgradeHeight - current.Height
                } else {
                    0
                }
            }
            current.LastBlockTime = Status.LastBlockTime
            current.SyncRate = Status.SyncRate
            if current.Height != Status.Height {
                if current.Syncing && Status.Height > 0 && current.Height > Status.Height {
                    current.SyncRate = float64(current.Height - Status.Height) /
                    Stopwatch.GetElapsedTime(heightChanged).TotalSeconds
                }
                heightChanged = Stopwatch.GetTimestamp()
            }
            if !current.Syncing && (current.Height != Status.Height || current.LastBlockTime == 0) {
                using let block = await Api.JsonAsync("block/" + current.Height.ToString(), ct: ct)
                current.LastBlockTime = int64(NodeJson.Number(block.RootElement, "timestamp"))
            }
            Status = current
        } catch (error Exception) {
            Publish()
            ThrowIfCoreExited()
            throw error
        }
    }

    private func ThrowIfCoreExited() {
        if Supervisor.NeedsRestart {
            throw WalletException("Configured core exited before its API became ready")
        }
    }

    func Publish() {
        Status = NodeStatus{
            Source: if Supervisor.Executable.Length > 0 {
                Supervisor.Source
            } else if Settings.BinaryPath == Settings.LauncherBinaryPath && Settings.BinaryPath.Length > 0 {
                "Launcher"
            } else {
                "Gyroid"
            },
            Owned: Supervisor.Owned,
            Network: Settings.Network,
            Endpoint: Settings.Endpoint,
            DataDirectory: Settings.DataDirectory,
            Executable: if Supervisor.Executable.Length > 0 {
                Supervisor.Executable
            } else {
                Settings.BinaryPath
            },
            Progress: Status.Progress,
            Phase: Supervisor.Phase,
            DownloadPercent: Supervisor.DownloadPercent,
        }
    }

    func Dispose() {
        Api.Dispose()
        Supervisor.Dispose()
    }
}
