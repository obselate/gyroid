package Gyroid.Models

data class WalletOutput {
    var TxId string = ""
    var OutputIndex int32
    var Amount uint64
    var BlockHeight uint64
    var Spent bool
    var Coinbase bool
    var Memo string = ""
}

data class WalletRecipient {
    var Address string = ""
    var Amount uint64
    var Memo string = ""
}

data class WalletSend {
    var TxId string = ""
    var Timestamp int64
    var RecordedHeight uint64
    var Status string = ""
    var Confirmations uint64
    var Amount uint64
    var Fee uint64
    var Recipients[]WalletRecipient = []WalletRecipient{}
}
