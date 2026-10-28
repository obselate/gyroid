package Gyroid.History

class WalletOutput {
    var TxId string = ""
    var OutputIndex int32
    var Amount uint64
    var BlockHeight uint64
    var Coinbase bool
    var Spent bool
    var Coinbase bool
    var Memo string = ""
}

class WalletRecipient {
    var Address string = ""
    var Amount uint64
    var Memo string = ""
}

class WalletSend {
    var TxId string = ""
    var Timestamp int64
    var RecordedHeight uint64
    var Status string = ""
    var Confirmations uint64
    var Amount uint64
    var Fee uint64
    var Recipients[]WalletRecipient = []WalletRecipient{}
}

class TransactionDetails {
    var Height uint64
    var Confirmations uint64
    var InMempool bool
    var Timestamp int64? = nil
}
