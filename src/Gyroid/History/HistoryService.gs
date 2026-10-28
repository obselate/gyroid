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
    var received List[WalletOutput] = List[WalletOutput]()
    var loaded int32
    var receivedPositions Dictionary[string, int32] = Dictionary[string, int32](StringComparer.Ordinal)
    var cachedTotal uint64
    var knownSendCount int32 = -1

    prop Total uint64 -> uint64(received.Count)
    prop More bool -> loaded < received.Count

    init(session WalletSession) {
        this.session = session
    }

    func Reset() {
        historyOffset = 0
        historyTotal = 0
        received.Clear()
        loaded = 0
        receivedPositions.Clear()
        cachedTotal = 0
        knownSendCount = -1
    }

    async func ReloadAsync(sends[]WalletSend, ct CancellationToken)[]WalletOutput {
        let outputs = List[WalletOutput]()
        let sentTransactions = HashSet[string](StringComparer.Ordinal)
        let keys = Dictionary[string, int32](StringComparer.Ordinal)
        for send in sends {
            sentTransactions.Add(send.TxId)
        }
        historyOffset = 0
        var more = await ReadHistoryAsync(outputs, keys, sentTransactions, ct)
        if historyTotal == cachedTotal && sends.Length == knownSendCount {
            for output in outputs {
                let key = output.TxId + ":" + output.OutputIndex.ToString()
                if receivedPositions.TryGetValue(key, out let index) {
                    received[index] = output
                } else {
                    receivedPositions.Add(key, received.Count)
                    received.Add(output)
                }
            }
        } else {
            while more {
                more = await ReadHistoryAsync(outputs, keys, sentTransactions, ct)
            }
            received = outputs
            receivedPositions = keys
            cachedTotal = historyTotal
            knownSendCount = sends.Length
        }
        loaded = Math.Min(Math.Max(historyPage, loaded), received.Count)
        return received.Take(loaded).ToArray()
    }

    private async func ReadHistoryAsync(
        outputs List[WalletOutput],
        keys Dictionary[string, int32],
        sentTransactions HashSet[string],
        ct CancellationToken
    ) bool {
        using let response = await session
            .Node
            .Api
            .JsonAsync("wallet/history/page?limit=500&offset=" + historyOffset.ToString() + "&order=desc", ct: ct)
        let root = response.RootElement
        let rows = root.GetProperty("outputs")
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
            if !sentTransactions.Contains(output.TxId) && keys.TryAdd(
                output.TxId + ":" + output.OutputIndex.ToString(),
                outputs.Count
            ) {
                outputs.Add(output)
            }
        }
        historyOffset += rows.GetArrayLength()
        historyTotal = NodeJson.Number(root, "total")
        if rows.GetArrayLength() == 0 && uint64(historyOffset) < historyTotal {
            throw WalletException("Daemon returned an incomplete received history page")
        }
        return uint64(historyOffset) < historyTotal
    }

    async func LoadMoreAsync(ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            if More {
                loaded = Math.Min(loaded + historyPage, received.Count)
                session.PublishHistory(received.Take(loaded).ToArray())
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
