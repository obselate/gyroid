package Gyroid.Model

import System

class WalletException : Exception {
    let StatusCode int32
    let OutcomeUnknown bool

    init(message string, statusCode int32 = 0, outcomeUnknown bool = false) : base(message) {
        StatusCode = statusCode
        OutcomeUnknown = outcomeUnknown
    }
}

class WalletSnapshot {
    var Page string = "Welcome"
    var State string = "Unloaded"
    var Connected bool
    var OwnedDaemon bool
    var ViewOnly bool
    var Address string = ""
    var Balance WalletBalance? = nil
    var History[]WalletOutput = []WalletOutput{}
    var HistoryTotal uint64
    var HistoryMore bool
    var Sends[]WalletSend = []WalletSend{}
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
    var Endpoint string = ""
    var DataDirectory string = ""
    var Executable string = ""
    var Progress string = ""
    var Phase string = ""
    var DownloadPercent int32?
    var TrustedCheckpoints bool?
    var UpgradeDate string = ""
    var UpgradeDeadline string = ""
    var UpgradeNotice string = ""
    var UpgradeBlocksLeft uint64
}

class WalletBalance {
    var Scanning bool
    var ScanHeight uint64
    var ChainHeight uint64
    var Balance uint64? = nil
    var Spendable uint64? = nil
    var Pending uint64? = nil
    var OutputsTotal uint64? = nil
    var OutputsUnspent uint64? = nil
    var MemoDecryptFailures uint64? = nil
    var MemoDecryptLastHeight uint64? = nil
}

class WalletOutput {
    var TxId string = ""
    var OutputIndex int32
    var Amount uint64
    var BlockHeight uint64
    var IsCoinbase bool
    var Spent bool
    var SpentHeight uint64? = nil
    var MemoHex string = ""
    var Memo string = ""
}

class WalletRecipient {
    var Address string = ""
    var Amount uint64
    var MemoHex string = ""
    var Memo string = ""
}

class WalletSend {
    var TxId string = ""
    var Timestamp int64
    var RecordedHeight uint64
    var Status string = ""
    var Confirmations uint64
    var InMempool bool
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

class SendEstimate(
    address string,
    amount uint64,
    memo string,
    fee uint64,
    inputCount int32,
    change uint64,
    inputTotal uint64,
    handle string = ""
) {
    let Address string = address
    let Handle string = handle
    let Amount uint64 = amount
    let Memo string = memo
    let Fee uint64 = fee
    let Total uint64 = amount + fee
    let InputCount int32 = inputCount
    let Change uint64 = change
    let InputTotal uint64 = inputTotal
    let OutputCount int32 = if change > 0 {
        2
    } else {
        1
    }
}

class SendResult(txId string, fee uint64, change uint64) {
    let TxId string = txId
    let Fee uint64 = fee
    let Change uint64 = change
    let Status string = "submitted"
}

class PendingSend {
    var Key string = ""
    var Body string = ""
    var Wallet string = ""
    var Network string = ""
    var Timestamp int64
    var CoreStarted int64
    var CanRetry bool
    prop Retryable bool -> CanRetry && DateTimeOffset.UtcNow.ToUnixTimeSeconds() >= Timestamp &&
        DateTimeOffset
        .UtcNow
        .ToUnixTimeSeconds() - Timestamp < 2592000
    var State string = "Send outcome unknown"
}

class WalletViewKeys : IDisposable {
    var SpendPublic[]char = []char{}
    var ViewPrivate[]char = []char{}
    var ViewPublic[]char = []char{}

    func Dispose() {
        Array.Clear(SpendPublic)
        Array.Clear(ViewPrivate)
        Array.Clear(ViewPublic)
    }
}
