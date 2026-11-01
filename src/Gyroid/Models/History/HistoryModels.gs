package Gyroid.Models

data class WalletOutput {
    var TxId string = ""
    var OutputIndex int32
    var Amount uint64
    var BlockHeight uint64
    var Spent bool
    var Coinbase bool
    var IsChange bool
    var Memo string = ""
    var OutputIndices[]int32 = System.Array.Empty[int32]()

    func Maturity(tip uint64) WalletMaturity -> WalletMaturity(
        BlockHeight > 0 && tip >= BlockHeight ? tip + 1 - BlockHeight: uint64(0),
        Coinbase ? uint64(60): uint64(10)
    )
}

data struct WalletMaturity(Confirmations uint64, Required uint64) {
    prop Count uint64 -> System.Math.Min(Confirmations > 0 ? Confirmations - 1: uint64(0), Required)
    prop Ready bool -> Confirmations > Required
    prop Remaining uint64 -> Required - Count
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

    func IsSelf(address string) bool {
        if address.Length == 0 || Recipients.Length == 0 {
            return false
        }
        for recipient in Recipients {
            if recipient.Address != address {
                return false
            }
        }
        return true
    }
}
