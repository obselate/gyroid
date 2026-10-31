package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Generic
import System.Linq
import System.Text.Json
import System.Threading

class HistoryService {
    let session WalletSession
    var RawReceived[]JsonElement = Array.Empty[JsonElement]()
    var RawSends[]JsonElement = Array.Empty[JsonElement]()
    private var baseOutputs[]WalletOutput = Array.Empty[WalletOutput]()
    private var baseSends[]WalletSend = Array.Empty[WalletSend]()
    private var received List[WalletOutput] = List[WalletOutput]()
    private var loaded int32

    prop Total uint64 -> uint64(received.Count)
    prop More bool -> loaded < received.Count

    init(session WalletSession) {
        this.session = session
    }

    func Reset() {
        RawReceived = Array.Empty[JsonElement]()
        RawSends = Array.Empty[JsonElement]()
        baseOutputs = Array.Empty[WalletOutput]()
        baseSends = Array.Empty[WalletSend]()
        received = List[WalletOutput]()
        loaded = 0
    }

    async func ReloadAsync(ct CancellationToken)[]WalletOutput {
        using let response = await session.Node.Api.JsonAsync("wallet/history", ct: ct)
        RawReceived = response.RootElement.GetProperty("outputs").Clone().EnumerateArray().ToArray()
        let firstMemos = Dictionary[string, JsonElement](StringComparer.Ordinal)
        for row in RawReceived {
            if NodeJson.Text(row, "memo_hex").Length == 0 {
                continue
            }
            let txid = NodeJson.Text(row, "txid")
            if !firstMemos.TryGetValue(txid, out let previous) || NodeJson.Number(
                row,
                "output_index"
            ) < NodeJson.Number(previous, "output_index") {
                firstMemos[txid] = row
            }
        }
        let binaryMemos = HashSet[string](
            firstMemos.Where(pair -> Wire.IsEnvelope(NodeJson.Text(pair.Value, "memo_hex"))).Select(pair -> pair.Key),
            StringComparer.Ordinal
        )
        let sentTransactions = Dictionary[string, int32](StringComparer.Ordinal)
        for sent in RawSends {
            sentTransactions[NodeJson.Text(sent, "txid")] = sent.GetProperty("recipients").GetArrayLength()
        }
        let outputs = List[WalletOutput]()
        for row in RawReceived {
            let txid = NodeJson.Text(row, "txid")
            let index = int32(NodeJson.Number(row, "output_index"))
            if sentTransactions.TryGetValue(txid, out let recipientCount) && index >= recipientCount {
                continue
            }
            let hex = NodeJson.Text(row, "memo_hex")
            outputs.Add(
                WalletOutput{
                    TxId: txid,
                    OutputIndex: index,
                    Amount: NodeJson.Number(row, "amount"),
                    BlockHeight: NodeJson.Number(row, "block_height"),
                    Spent: NodeJson.Flag(row, "spent"),
                    Coinbase: NodeJson.Flag(row, "is_coinbase"),
                    Memo: hex.Length > 0 && binaryMemos.Contains(txid) ? "[non-text memo]": NodeJson.Memo(hex)
                }
            )
        }
        baseOutputs = outputs.ToArray()
        RebuildOutputs()
        return received.Take(loaded).ToArray()
    }

    private func RebuildOutputs() {
        let outputs = List[WalletOutput]()
        let positions = Dictionary[string, int32](StringComparer.Ordinal)
        for output in baseOutputs {
            let message = session.Messages.HistoryMessage(output.TxId, "", false)
            if message == nil || !message.OutputIndices.Contains(output.OutputIndex) {
                outputs.Add(output)
                continue
            }
            if positions.TryGetValue(output.TxId, out let position) {
                outputs[position].Amount += output.Amount
                outputs[position].Spent = outputs[position].Spent && output.Spent
            } else {
                positions[output.TxId] = outputs.Count
                outputs.Add(
                    WalletOutput{
                        ... output,
                        OutputIndex: message.OutputIndices[0],
                        Memo: message.Text,
                        OutputIndices: message.OutputIndices
                    }
                )
            }
        }
        received = outputs
            .OrderByDescending((output WalletOutput) -> output.BlockHeight)
            .ThenBy((output WalletOutput) -> output.TxId, StringComparer.Ordinal)
            .ThenBy((output WalletOutput) -> output.OutputIndex)
            .ToList()
        loaded = Math.Min(Math.Max(50, loaded), received.Count)
    }

    private func BuildSends()[]WalletSend {
        let sends = List[WalletSend]()
        for sent in baseSends {
            let recipients = List[WalletRecipient]()
            let grouped = Dictionary[string, WalletRecipient](StringComparer.Ordinal)
            for recipient in sent.Recipients {
                let message = session.Messages.HistoryMessage(sent.TxId, recipient.Address, true)
                if message == nil {
                    recipients.Add(recipient)
                } else if grouped.TryGetValue(recipient.Address, out let combined) {
                    combined.Amount += recipient.Amount
                } else {
                    let merged = WalletRecipient{... recipient, Memo: message.Text}
                    grouped[recipient.Address] = merged
                    recipients.Add(merged)
                }
            }
            sends.Add(WalletSend{... sent, Recipients: recipients.ToArray()})
        }
        return sends.ToArray()
    }

    func ApplyMessages() {
        RebuildOutputs()
        session.PublishHistory(received.Take(loaded).ToArray())
        session.PublishSends(BuildSends())
    }

    async func LoadMoreAsync(ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            if More {
                loaded = Math.Min(loaded + 50, received.Count)
                session.PublishHistory(received.Take(loaded).ToArray())
            }
        } finally {
            session.End()
        }
    }

    async func BlockTimesAsync(heights[]uint64, ct CancellationToken = default(CancellationToken)) Dictionary[
        uint64,
        int64
    ] {
        await session.BeginAsync(ct, false)
        try {
            session.RequireUnlocked()
            let times = Dictionary[uint64, int64]()
            for height in heights {
                using let block = await session.Node.Api.JsonAsync("block/" + height.ToString(), ct: ct)
                times[height] = NodeJson.Signed(block.RootElement, "timestamp")
            }
            return times
        } finally {
            session.End(false)
        }
    }

    async func ReadSendsAsync(ct CancellationToken)[]WalletSend {
        let sends = List[WalletSend]()
        let raw = List[JsonElement]()
        var offset int32
        while true {
            using let response = await session
                .Node
                .Api
                .JsonAsync("wallet/sends?limit=500&offset=" + offset.ToString() + "&order=desc", ct: ct)
            let root = response.RootElement
            let rows = root.GetProperty("sends").Clone()
            for row in rows.EnumerateArray() {
                raw.Add(row)
                let binary = HashSet[string](StringComparer.Ordinal)
                let seen = HashSet[string](StringComparer.Ordinal)
                for recipient in row.GetProperty("recipients").EnumerateArray() {
                    let address = NodeJson.Text(recipient, "address")
                    let hex = NodeJson.Text(recipient, "memo_hex")
                    if hex.Length > 0 && seen.Add(address) && Wire.IsEnvelope(hex) {
                        binary.Add(address)
                    }
                }
                let recipients = List[WalletRecipient]()
                for recipient in row.GetProperty("recipients").EnumerateArray() {
                    let address = NodeJson.Text(recipient, "address")
                    let hex = NodeJson.Text(recipient, "memo_hex")
                    recipients.Add(
                        WalletRecipient{
                            Address: address,
                            Amount: NodeJson.Number(recipient, "amount"),
                            Memo: hex.Length > 0 && binary.Contains(address) ? "[non-text memo]": NodeJson.Memo(hex)
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
            offset += rows.GetArrayLength()
            if uint64(offset) >= NodeJson.Number(root, "total") {
                RawSends = raw.ToArray()
                baseSends = sends.ToArray()
                return BuildSends()
            }
            if rows.GetArrayLength() == 0 {
                throw WalletException("Daemon returned an incomplete outgoing history page")
            }
        }
    }
}
