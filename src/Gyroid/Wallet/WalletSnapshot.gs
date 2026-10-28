package Gyroid.Wallet

import Gyroid.History

class WalletSnapshot {
    var Page string = "Welcome"
    var State string = "Unloaded"
    var Connected bool
    var ViewOnly bool
    var Address string = ""
    var Balance WalletBalance? = nil
    var History[]WalletOutput = []WalletOutput{}
    var HistoryTotal uint64
    var HistoryMore bool
    var Sends[]WalletSend = []WalletSend{}
}

class WalletBalance {
    var Scanning bool
    var ScanHeight uint64
    var ChainHeight uint64
    var Balance uint64? = nil
    var Spendable uint64? = nil
    var Pending uint64? = nil
    var Unconfirmed uint64
}
