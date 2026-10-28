package Gyroid.History

import Gyroid.Node
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Linq
import System.Threading

class HistoryService {
    let session WalletSession
    var historyOffset int32
    var historyTotal uint64

    prop Total uint64 -> historyTotal
    prop More bool -> uint64(historyOffset) < historyTotal

    init(session WalletSession) {
        this.session = session
    }

    func Reset() {
        historyOffset = 0
        historyTotal = 0
    }

    async func ReloadAsync(ct CancellationToken)[]WalletOutput {
        let outputs = List[WalletOutput]()
        let wanted = Math.Max(historyPage, historyOffset)
        historyOffset = 0
        var more = true
        while more && historyOffset < wanted {
            more = await ReadHistoryAsync(outputs, Math.Min(500, wanted - historyOffset), ct)
        }
        return outputs.ToArray()
    }

    private async func ReadHistoryAsync(outputs List[WalletOutput], limit int32, ct CancellationToken) bool {
        using let response = await session
            .Node
            .Api
            .JsonAsync(
            "wallet/history/page?limit=" + limit.ToString() + "&offset=" + historyOffset.ToString() + "&order=desc",
            ct: ct
        )
        let root = response.RootElement
        let rows = root.GetProperty("outputs")
        let keys = HashSet[string](
            outputs.Select((output WalletOutput) -> output.TxId + ":" + output.OutputIndex.ToString())
        )
        for row in rows.EnumerateArray() {
            let hex = NodeJson.Text(row, "memo_hex")
            let output = WalletOutput{
                TxId: NodeJson.Text(row, "txid"),
                OutputIndex: int32(NodeJson.Number(row, "output_index")),
                Amount: NodeJson.Number(row, "amount"),
                BlockHeight: NodeJson.Number(row, "block_height"),
                Spent: NodeJson.Flag(row, "spent"),
                Memo: NodeJson.Memo(hex)
            }
            if keys.Add(output.TxId + ":" + output.OutputIndex.ToString()) {
                outputs.Add(output)
            }
        }
        historyOffset += rows.GetArrayLength()
        historyTotal = NodeJson.Number(root, "total")
        return rows.GetArrayLength() > 0 && uint64(historyOffset) < historyTotal
    }

    async func LoadMoreAsync(ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            if uint64(historyOffset) < historyTotal {
                let outputs = List[WalletOutput](session.Snapshot.History)
                await ReadHistoryAsync(outputs, historyPage, ct)
                session.PublishHistory(outputs.ToArray())
            }
        } finally {
            session.End()
        }
    }

    async func TransactionAsync(txid string, ct CancellationToken = default(CancellationToken)) TransactionDetails {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            using let response = await session.Node.Api.JsonAsync("tx/" + Uri.EscapeDataString(txid), ct: ct)
            let root = response.RootElement
            let details = TransactionDetails{
                Height: NodeJson.OptionalNumber(root, "block_height") ?? uint64(0),
                Confirmations: NodeJson.Number(root, "confirmations"),
                InMempool: NodeJson.Flag(root, "in_mempool")
            }
            if details.Height > 0 {
                using let block = await session.Node.Api.JsonAsync("block/" + details.Height.ToString(), ct: ct)
                details.Timestamp = NodeJson.Signed(block.RootElement, "timestamp")
            }
            return details
        } finally {
            session.End()
        }
    }

    async func ReadSendsAsync(ct CancellationToken)[]WalletSend {
        let sends = List[WalletSend]()
        var offset int32 = 0
        while true {
            using let response = await session
                .Node
                .Api
                .JsonAsync("wallet/sends?limit=500&offset=" + offset.ToString() + "&order=desc", ct: ct)
            let root = response.RootElement
            let rows = root.GetProperty("sends")
            for row in rows.EnumerateArray() {
                let recipients = List[WalletRecipient]()
                for recipient in row.GetProperty("recipients").EnumerateArray() {
                    let hex = NodeJson.Text(recipient, "memo_hex")
                    recipients.Add(
                        WalletRecipient{
                            Address: NodeJson.Text(recipient, "address"),
                            Amount: NodeJson.Number(recipient, "amount"),
                            Memo: NodeJson.Memo(hex)
                        }
                    )
                }
                sends.Add(
                    WalletSend{
                        TxId: NodeJson.Text(row, "txid"),
                        Timestamp: NodeJson.Signed(row, "timestamp"),
                        RecordedHeight: NodeJson.Number(row, "recorded_height"),
                        Status: NodeJson.Text(row, "chain_state"),
                        Confirmations: NodeJson.Number(row, "confirmations"),
                        Fee: NodeJson.Number(row, "fee"),
                        Amount: NodeJson.Number(row, "total_amount"),
                        Recipients: recipients.ToArray()
                    }
                )
            }
            offset = offset + rows.GetArrayLength()
            if uint64(offset) >= NodeJson.Number(root, "total") {
                return sends.ToArray()
            }
            if rows.GetArrayLength() == 0 {
                throw WalletException("Daemon returned an incomplete outgoing history page")
            }
        }
    }

    shared {
        private let historyPage int32 = 50
    }
}
