package Gyroid.Models

enum WalletState {
    Unloaded,
    Locked,
    Unlocked,
    Unknown
}

class WalletSnapshot {
    var State WalletState = WalletState.Unloaded
    var Connected bool
    var ViewOnly bool
    var Address string = ""
    var Balance WalletBalance? = nil
    var History[]WalletOutput = []WalletOutput{}
    var HistoryTotal uint64
    var HistoryMore bool
    var Sends[]WalletSend = []WalletSend{}

    func Matches(other WalletSnapshot) bool {
        if State != other.State ||
            Connected != other.Connected ||
            ViewOnly != other.ViewOnly ||
            Address != other.Address ||
            HistoryTotal != other.HistoryTotal ||
            HistoryMore != other.HistoryMore ||
            History.Length != other
            .History
            .Length ||
            Sends.Length != other
            .Sends
            .Length {
            return false
        }
        if let balance = Balance {
            guard let previous = other.Balance else {
                return false
            }
            if balance.Scanning != previous.Scanning ||
                balance.ScanHeight != previous.ScanHeight ||
                balance.ChainHeight != previous.ChainHeight ||
                balance.Balance != previous.Balance ||
                balance.Spendable != previous.Spendable ||
                balance.Pending != previous.Pending ||
                balance.Unconfirmed != previous.Unconfirmed ||
                balance.Outputs != previous.Outputs ||
                balance.MemoErrors != previous.MemoErrors {
                return false
            }
        } else if other.Balance != nil {
            return false
        }
        for index in 0 ... History.Length {
            let output = History[index]
            let previous = other.History[index]
            if output.TxId != previous.TxId ||
                output.OutputIndex != previous.OutputIndex ||
                output.Amount != previous.Amount ||
                output.BlockHeight != previous.BlockHeight ||
                output.Spent != previous.Spent ||
                output.Coinbase != previous.Coinbase ||
                output.Memo != previous.Memo {
                return false
            }
        }
        for index in 0 ... Sends.Length {
            let send = Sends[index]
            let previous = other.Sends[index]
            if send.TxId != previous.TxId ||
                send.Timestamp != previous.Timestamp ||
                send.RecordedHeight != previous.RecordedHeight ||
                send.Status != previous.Status ||
                send.Confirmations != previous.Confirmations ||
                send.Amount != previous.Amount ||
                send.Fee != previous.Fee ||
                send
                .Recipients
                .Length != previous
                .Recipients
                .Length {
                return false
            }
            for recipientIndex in 0 ... send.Recipients.Length {
                let recipient = send.Recipients[recipientIndex]
                let prior = previous.Recipients[recipientIndex]
                if recipient.Address != prior.Address ||
                    recipient.Amount != prior.Amount ||
                    recipient.Memo != prior.Memo {
                    return false
                }
            }
        }
        return true
    }
}

class WalletBalance {
    var Scanning bool
    var ScanHeight uint64
    var ChainHeight uint64
    var Balance uint64? = nil
    var Spendable uint64? = nil
    var Pending uint64? = nil
    var Unconfirmed uint64
    var Outputs uint64
    var MemoErrors uint64
}
