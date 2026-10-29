package Gyroid.Node

import System

enum NodePhase {
    None,
    Detecting,
    Core,
    Checkpoints,
    Starting,
    Connecting,
    ChainSync
}

class NodeStatus {
    var Source string = "Gyroid"
    var Owned bool
    var Running bool
    var Version string = ""
    var Network string = ""
    var Height uint64
    var ChainHeight uint64
    var Syncing bool
    var SyncProgress uint64?
    var Peers uint64
    var Mempool uint64
    var MempoolBytes uint64
    var PeerId string = ""
    var IdentityAge string = ""
    var BestHash string = ""
    var Listen string = ""
    var MaxOutbound uint64
    var CheckpointHeight uint64
    var LastBlockTime int64
    var SyncRate float64
    var Endpoint string = ""
    var DataDirectory string = ""
    var Executable string = ""
    var Progress string = ""
    var Phase NodePhase = NodePhase.None
    var DownloadPercent int32?
    var UpgradeDate string = ""
    var UpgradeDeadline string = ""
    var UpgradeNotice string = ""
    var UpgradeBlocksLeft uint64

    func Matches(other NodeStatus) bool ->
    Source == other.Source &&
        Owned == other.Owned &&
        Running == other.Running &&
        Version == other.Version &&
        Network == other.Network &&
        Height == other.Height &&
        ChainHeight == other.ChainHeight &&
        Syncing == other.Syncing &&
        SyncProgress == other.SyncProgress &&
        Peers == other.Peers &&
        Mempool == other.Mempool &&
        MempoolBytes == other.MempoolBytes &&
        PeerId == other.PeerId &&
        BestHash == other.BestHash &&
        Listen == other.Listen &&
        MaxOutbound == other.MaxOutbound &&
        CheckpointHeight == other.CheckpointHeight &&
        LastBlockTime == other.LastBlockTime &&
        SyncRate == other.SyncRate &&
        Endpoint == other.Endpoint &&
        DataDirectory == other.DataDirectory &&
        Executable == other.Executable &&
        Progress == other.Progress &&
        Phase == other.Phase &&
        DownloadPercent == other.DownloadPercent &&
        UpgradeDate == other.UpgradeDate &&
        UpgradeDeadline == other.UpgradeDeadline &&
        UpgradeNotice == other.UpgradeNotice &&
        UpgradeBlocksLeft == other.UpgradeBlocksLeft
}

class ChainCertificate {
    var Height uint64
    var Violations[]uint64 = []uint64{}
    var Time DateTimeOffset
}
