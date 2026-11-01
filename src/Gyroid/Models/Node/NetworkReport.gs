package Gyroid.Models

data class NetworkBlock {
    var Height uint64
    var Hash string = ""
    var PreviousHash string = ""
    var Timestamp int64
    var Transactions uint64
    var Difficulty uint64
    var Own int32
}

data class NetworkPeer {
    var Id string = ""
    var Address string = ""
    var Transport string = ""
    var Family string = ""
}

data class BannedPeer {
    var Id string = ""
    var Reason string = ""
    var Count uint64
    var Permanent bool
    var Expires int64
}

data class NetworkReport {
    var Status NodeStatus = NodeStatus()
    var Hashrate float64
    var Difficulty uint64
    var Emitted float64
    var MaximumTransactions float64
    var Tcp int32
    var Peers[]NetworkPeer = []NetworkPeer{}
    var Banned[]BannedPeer = []BannedPeer{}
    var Blocks[]NetworkBlock = []NetworkBlock{}
}

data struct NetworkRow {
    var Key string
    var Peer NetworkPeer?
    var Ban BannedPeer?
    var Language string
    var Wide bool
    var Hovered bool
}
