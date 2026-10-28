package Gyroid.Send

import System

class SendEstimate(address string, amount uint64, memo string, fee uint64, inputCount int32, handle string = "") {
    let Address string = address
    let Handle string = handle
    let Amount uint64 = amount
    let Memo string = memo
    let Fee uint64 = fee
    let Total uint64 = amount + fee
    let InputCount int32 = inputCount
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
