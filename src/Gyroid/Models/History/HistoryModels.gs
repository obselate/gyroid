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
    var InvitationName string = ""
    var OutputIndices[]int32 = System.Array.Empty[int32]()

    func Maturity(tip uint64) WalletMaturity -> WalletMaturity(
        BlockHeight > 0 && tip >= BlockHeight ? tip + 1 - BlockHeight: uint64(0),
        Coinbase ? uint64(60): uint64(10)
    )
}

data struct WalletMaturity(Confirmations uint64, Required uint64) {
    prop Depth uint64 -> Confirmations > 0 ? Confirmations - 1: uint64(0)
    prop Count uint64 -> System.Math.Min(Depth, Required)
    prop Ready bool -> Confirmations > Required
    prop Remaining uint64 -> Required - Count
}

data class WalletRecipient {
    var Address string = ""
    var Amount uint64
    var Memo string = ""
    var InvitationName string = ""
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

data struct HistoryRecipient {
    var Index int32
    var Address string
    var Amount uint64
    var Memo string
    var InvitationName string = ""
    var Privacy bool
    var Language string
}

enum HistoryRowKind {
    Received,
    Mined,
    Sent,
    Pending
}

data struct HistoryRow {
    var Key string
    var Kind HistoryRowKind
    var TxId string
    var Index int32
    var Amount uint64
    var SentAmount uint64
    var Fee uint64
    var Self bool
    var Memo string
    var InvitationName string = ""
    var Indices[]int32
    var Height uint64
    var Maturity WalletMaturity
    var Time int64
    var State string
    var Recipients[]HistoryRecipient
    var Open bool
    var Revision int32
    var Privacy bool
    var Language string
    var Width float64
}

data struct HistoryPreparation {
    var Snapshot WalletSnapshot
    var ExportOutputs System.Collections.Generic.IReadOnlyList[WalletOutput]
    var Previous HistoryPrepared
    var PlotWidth float64
    var Cutoff uint64
    var From uint64
    var To uint64
    var Tip uint64
    var Times System.Collections.Generic.Dictionary[uint64, int64]
    var Complete bool
    var ReuseRows bool
    var ReuseExport bool
    var SelectionTx string
}

data struct HistorySummary {
    var Received uint64
    var Sent uint64
    var Fees uint64
    var Mined uint64
}

data struct HistoryRibbonBin {
    var Received uint64
    var Mined uint64
    var Sent uint64
    var ReceivedCount int32
    var MinedCount int32
    var SentCount int32
    var Time int64
}

data struct HistoryPrepared {
    var Rows[]HistoryRow
    var Shown[]HistoryRow
    var Export[]HistoryRow
    var Summary HistorySummary
    var Low uint64
    var ExportCount int32
    var SelectionKey string
    var Span uint64
    var Ribbon HistoryRibbonData
}

data struct HistoryRibbonData {
    var Bins[]HistoryRibbonBin
    var Received[]float64
    var Mined[]float64
    var Sent[]float64
    var Top float64
}

data struct HistoryArrival {
    var Kind string
    var Amount uint64
    var Source string
    var InvitationName string = ""
    var Confirmations uint64
    var Required uint64
    var Blocks uint64
    var TxId string
    var OutputIndex int32
    var Height uint64
    var Self bool
}

data struct HistoryActivity {
    var Kind string
    var Amount uint64
    var Label string
    var InvitationName string = ""
    var Status string
    var Ready bool
    var Order uint64
    var Timestamp int64
    var TxId string
    var OutputIndex int32
    var Height uint64
    var Confirmations uint64
    var Required uint64
}

data struct HistoryOverview {
    var Arrivals[]HistoryArrival
    var Activity[]HistoryActivity
}
