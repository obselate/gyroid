package Gyroid.Node

import Gyroid.Platform
import Gyroid.Settings
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
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
    private var listen string = ""
    private var maxOutbound uint64

    init(settings WalletSettings) {
        Settings = settings
        Api = NodeApi(settings)
        Supervisor.Exited = () -> Exited?.Invoke()
        Supervisor.Progress = value -> {
            let current = NodeStatus{
                ... Status,
                Progress: value,
                Phase: Supervisor.Phase,
                DownloadPercent: Supervisor.DownloadPercent
            }
            if !Status.Matches(current) {
                Status = current
                Changed?.Invoke()
            }
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
        let core = configuration.RootElement.GetProperty("settings")
        listen = NodeJson.Text(core, "listen")
        maxOutbound = NodeJson.OptionalNumber(core, "p2p_max_outbound") ?? uint64(0)
        let walletFile = NodeJson.Text(core, "wallet_file")
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
                Version: NodeJson.Text(root, "version"),
                Network: Settings.Network,
                Height: NodeJson.Number(root, "chain_height"),
                ChainHeight: NodeJson.OptionalNumber(root, "sync_target") ?? NodeJson.Number(root, "chain_height"),
                Syncing: NodeJson.Flag(root, "syncing"),
                SyncProgress: NodeJson.OptionalNumber(root, "sync_progress"),
                Peers: NodeJson.Number(root, "peers"),
                Mempool: NodeJson.Number(root, "mempool_size"),
                MempoolBytes: NodeJson.OptionalNumber(root, "mempool_bytes") ?? uint64(0),
                PeerId: NodeJson.Text(root, "peer_id"),
                IdentityAge: NodeJson.Text(root, "identity_age"),
                BestHash: NodeJson.Text(root, "best_hash"),
                Listen: listen,
                MaxOutbound: maxOutbound > 0 ? maxOutbound: 16,
                CheckpointHeight: Supervisor.CheckpointHeight,
                Endpoint: Settings.Endpoint,
                DataDirectory: Settings.DataDirectory,
                Executable: Supervisor.Executable,
                Progress: Status.Progress,
                Phase: if Supervisor.Phase != NodePhase.None {
                    Supervisor.Phase
                } else if NodeJson.Flag(root, "syncing") {
                    NodePhase.ChainSync
                } else {
                    NodePhase.None
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
            let progress = current.SyncProgress ?? current.Height
            let previous = Status.SyncProgress ?? Status.Height
            if progress != previous {
                if current.Syncing && previous > 0 && progress > previous {
                    current.SyncRate = float64(progress - previous) /
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
            CheckpointHeight: Supervisor.CheckpointHeight,
        }
    }

    async func ReadNetworkAsync(previous NetworkReport?, ct CancellationToken) NetworkReport {
        let status = Status
        using let stats = await Api.JsonAsync("stats", ct: ct)
        using let peers = await Api.JsonAsync("peers", ct: ct)
        using let bans = await Api.JsonAsync("peers/banned", ct: ct)
        let connected = List[NetworkPeer]()
        for peer in peers.RootElement.GetProperty("peers").EnumerateArray() {
            let addresses = peer.GetProperty("addrs")
            let parts = if addresses.GetArrayLength() > 0 {
                (addresses[0].GetString() ?? "").Split('/')
            } else {
                []string{}
            }
            connected.Add(
                NetworkPeer{
                    Id: NodeJson.Text(peer, "peer_id"),
                    Address: if parts.Length < 5 {
                        ""
                    } else if parts[1] == "ip6" {
                        "[" + parts[2] + "]:" + parts[4]
                    } else {
                        parts[2] + ":" + parts[4]
                    },
                    Transport: if Array.IndexOf(parts, "quic-v1") >= 0 {
                        "quic"
                    } else if parts.Length > 3 {
                        parts[3]
                    } else {
                        ""
                    },
                    Family: parts.Length > 1 ? parts[1]: ""
                }
            )
        }
        let banned = List[BannedPeer]()
        for ban in bans.RootElement.GetProperty("banned").EnumerateArray() {
            let expires = NodeJson.Text(ban, "expires_at")
            banned.Add(
                BannedPeer{
                    Id: NodeJson.Text(ban, "peer_id"),
                    Reason: NodeJson.Text(ban, "reason"),
                    Count: NodeJson.OptionalNumber(ban, "ban_count") ?? uint64(0),
                    Permanent: NodeJson.Flag(ban, "permanent"),
                    Expires: if expires.Length > 0 {
                        DateTimeOffset.Parse(expires, CultureInfo.InvariantCulture).ToUnixTimeSeconds()
                    } else {
                        0
                    }
                }
            )
        }
        let cached = Dictionary[uint64, NetworkBlock]()
        for block in previous?.Blocks ?? []NetworkBlock{} {
            cached[block.Height] = block
        }
        let blocks = List[NetworkBlock]()
        var hash = status.BestHash
        var height = status.Height
        while blocks.Count < 61 {
            let block = await ReadBlockAsync(height, hash, cached, ct)
            blocks.Add(block)
            if height == 0 {
                break
            }
            hash = block.PreviousHash
            height--
        }
        blocks.Reverse()
        return NetworkReport{
            Hashrate: stats.RootElement.GetProperty("network_hashrate").GetDouble(),
            Difficulty: NodeJson.Number(stats.RootElement, "difficulty"),
            Emitted: stats.RootElement.GetProperty("pct_emitted").GetDouble(),
            Peers: connected.ToArray(),
            Banned: banned.ToArray(),
            Blocks: blocks.ToArray()
        }
    }

    private async func ReadBlockAsync(
        height uint64,
        hash string,
        cached Dictionary[uint64, NetworkBlock],
        ct CancellationToken
    ) NetworkBlock {
        if cached.TryGetValue(height, out let known) && known.Hash == hash {
            return known
        }
        using let response = await Api.JsonAsync("block/" + height.ToString(), ct: ct)
        let root = response.RootElement
        return NetworkBlock{
            Height: height,
            Hash: NodeJson.Text(root, "hash"),
            PreviousHash: NodeJson.Text(root, "prev_hash"),
            Timestamp: NodeJson.Signed(root, "timestamp"),
            Transactions: NodeJson.Number(root, "tx_count"),
            Difficulty: NodeJson.Number(root, "difficulty")
        }
    }

    func Dispose() {
        Api.Dispose()
        Supervisor.Dispose()
    }
}
