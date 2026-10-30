package Gyroid.Send

import Gyroid.History
import System
import System.Linq

class SendEstimate {
    let Recipients[]WalletRecipient
    let Handles[]string
    let Amount uint64
    let Fee uint64
    let Change uint64
    let Total uint64
    let InputCount int32

    init(recipients[]WalletRecipient, handles[]string, fee uint64, change uint64, inputCount int32) {
        Recipients = recipients
        Handles = handles
        Amount = recipients.Aggregate(uint64(0), (sum uint64, recipient WalletRecipient) -> sum + recipient.Amount)
        Fee = fee
        Change = change
        Total = Amount + fee
        InputCount = inputCount
    }
}

class SendResult(txId string, fee uint64, change uint64, inputCount int32) {
    let TxId string = txId
    let Fee uint64 = fee
    let Change uint64 = change
    let InputCount int32 = inputCount
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

class SendOutcome(txId string = "", error string? = nil) {
    let TxId string = txId
    let Error string? = error
    let Text string = if txId.Length > 0 {
        "Submitted: " + txId
    } else if let message = error {
        "Send failed: " + message
    } else {
        ""
    }
}

class BlocknetId(handle string, address string) {
    let Handle string = handle
    let Address string = address
}
