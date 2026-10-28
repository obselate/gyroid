package Gyroid.Node

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
    var LastBlockTime int64
    var SyncRate float64
    var Endpoint string = ""
    var DataDirectory string = ""
    var Executable string = ""
    var Progress string = ""
    var Phase string = ""
    var DownloadPercent int32?
    var UpgradeDate string = ""
    var UpgradeDeadline string = ""
    var UpgradeNotice string = ""
    var UpgradeBlocksLeft uint64
}
