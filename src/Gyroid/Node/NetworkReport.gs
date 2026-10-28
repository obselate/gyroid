package Gyroid.Node

class NetworkBlock {
    var Height uint64
    var Hash string = ""
    var PreviousHash string = ""
    var Timestamp int64
    var Transactions uint64
    var Difficulty uint64
}

class NetworkPeer {
    var Id string = ""
    var Address string = ""
    var Transport string = ""
    var Family string = ""
}

class BannedPeer {
    var Id string = ""
    var Reason string = ""
    var Count uint64
    var Permanent bool
    var Expires int64
}

class NetworkReport {
    var Hashrate float64
    var Difficulty uint64
    var Emitted float64
    var Peers[]NetworkPeer = []NetworkPeer{}
    var Banned[]BannedPeer = []BannedPeer{}
    var Blocks[]NetworkBlock = []NetworkBlock{}
}
