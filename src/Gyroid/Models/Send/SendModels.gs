package Gyroid.Models

import System
import System.Collections.Generic
import System.Linq

class SendRow {
    let Id string = Guid.NewGuid().ToString("N")
    var Address string = ""
    var Amount string = ""
    var Memo string = ""
    var MemoOpen bool
    var Suggest bool
    var Atoms uint64?
    var AmountIssue string = ""
    var AddressIssue string = ""
    var MemoIssue string = ""
    var Kind string = ""
    var Destination string = ""
    var Matches[]SendSuggestion = []SendSuggestion{}
}

data struct SendSuggestion {
    var Name string
    var Destination string
    var PrefixLength int32
}

data struct SendReviewRow {
    var Id string
    var Address string
    var Amount uint64
    var Memo string
    var Kind string
    var Destination string
    var Handle string
}

class SendForm {
    var Total uint64
    var Over bool
    var CanSubmit bool
    var Rows[]SendReviewRow = []SendReviewRow{}

    func Refresh(drafts List[SendRow], spendable uint64, blocked bool) {
        var total uint64 = 0
        var ready = !blocked && drafts.Count > 0
        let rows = [drafts.Count]SendReviewRow
        for index in 0 ... drafts.Count {
            let row = drafts[index]
            total = Add(total, row.Atoms ?? uint64(0))
            ready = ready && row.Atoms != nil && row.Kind.Length > 0 && row.MemoIssue.Length == 0
            rows[index] = SendReviewRow{
                Id: row.Id,
                Address: row.Address,
                Amount: row.Atoms ?? uint64(0),
                Memo: row.Memo,
                Kind: row.Kind,
                Destination: row.Destination
            }
        }
        Total = total
        Over = total > spendable
        CanSubmit = ready && !Over && total > 0
        if !Rows.SequenceEqual(rows) {
            Rows = rows
        }
    }

    shared {
        func Add(left uint64, right uint64) uint64 -> if left > uint64.MaxValue - right {
            uint64.MaxValue
        } else {
            left + right
        }
    }
}

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
}

class BlocknetId(handle string, address string) {
    let Handle string = handle
    let Address string = address
}
