package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Generic
import System.Linq
import System.Text
import System.Text.Json
import System.Threading

class HistoryService {
    let session WalletSession
    var RawReceived[]JsonElement = Array.Empty[JsonElement]()
    var RawSends[]JsonElement = Array.Empty[JsonElement]()
    var DecodedReceived Dictionary[string, DecodedMemo] = Dictionary[string, DecodedMemo](StringComparer.Ordinal)
    var DecodedSends Dictionary[string, Dictionary[string, DecodedMemo]] =
    Dictionary[string, Dictionary[string, DecodedMemo]](StringComparer.Ordinal)
    private var baseOutputs[]WalletOutput = Array.Empty[WalletOutput]()
    private var baseSends[]WalletSend = Array.Empty[WalletSend]()
    private var received List[WalletOutput] = List[WalletOutput]()
    private var loaded int32

    prop Total uint64 -> uint64(received.Count)
    prop More bool -> loaded < received.Count
    prop Outputs IReadOnlyList[WalletOutput] -> received

    init(session WalletSession) {
        this.session = session
    }

    func Reset() {
        RawReceived = Array.Empty[JsonElement]()
        RawSends = Array.Empty[JsonElement]()
        DecodedReceived = Dictionary[string, DecodedMemo](StringComparer.Ordinal)
        DecodedSends = Dictionary[string, Dictionary[string, DecodedMemo]](StringComparer.Ordinal)
        baseOutputs = Array.Empty[WalletOutput]()
        baseSends = Array.Empty[WalletSend]()
        received = List[WalletOutput]()
        loaded = 0
    }

    async func ReloadAsync(ct CancellationToken)[]WalletOutput {
        using let response = await session.Node.Api.JsonAsync("wallet/history", ct: ct)
        RawReceived = response.RootElement.GetProperty("outputs").Clone().EnumerateArray().ToArray()
        let network = session.settings.Network
        let binaryMemos = HashSet[string](StringComparer.Ordinal)
        DecodedReceived = Dictionary[string, DecodedMemo](StringComparer.Ordinal)
        for group in RawReceived.Where(row -> NodeJson.Text(row, "memo_hex").Length > 0).GroupBy(
            row -> NodeJson.Text(row, "txid")
        ) {
            let rows = group.OrderBy(row -> NodeJson.Number(row, "output_index")).ToArray()
            if !Wire.IsEnvelope(NodeJson.Text(rows[0], "memo_hex")) {
                continue
            }
            binaryMemos.Add(group.Key)
            let hex = StringBuilder()
            for row in rows {
                hex.Append(NodeJson.Text(row, "memo_hex"))
            }
            if let envelope = Wire.DecodeMemo(hex.ToString(), network) {
                DecodedReceived[group.Key] = DecodedMemo(
                    envelope,
                    rows.Select(row -> int32(NodeJson.Number(row, "output_index"))).ToArray(),
                    int64(NodeJson.Number(rows[0], "block_height"))
                )
            }
        }
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
                    OutputIndices: DecodedReceived.TryGetValue(txid, out let decoded) && decoded.OutputIndices.Contains(
                        index
                    ) ?
                    decoded.OutputIndices: Array.Empty[int32](),
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
            if output.OutputIndices.Length == 0 || !output.OutputIndices.Contains(output.OutputIndex) {
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
                        OutputIndex: output.OutputIndices[0],
                        Memo: session.Messages.HistoryMessage(output.TxId, "", false)?.Text ?? output.Memo
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
                if !DecodedSends.TryGetValue(sent.TxId, out let decoded) || !decoded.ContainsKey(recipient.Address) {
                    recipients.Add(recipient)
                } else if grouped.TryGetValue(recipient.Address, out let combined) {
                    combined.Amount += recipient.Amount
                } else {
                    let merged = WalletRecipient{
                        ... recipient,
                        Memo: session
                            .Messages
                            .HistoryMessage(sent.TxId, recipient.Address, true)
                            ?.Text ??
                            recipient.Memo
                    }
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

    async func PeriodStartAsync(period string, tip uint64, ct CancellationToken) uint64 {
        if period == "all" {
            return 0
        }
        let cutoff = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - switch period {
            case "1d": 86400L
            case "7d": 604800L
            default: 2592000L
        }
        var first = 1UL
        var last = tip + 1
        while first < last {
            let height = first + (last - first) / 2
            let times = await BlockTimesAsync([]uint64{height}, ct)
            if times[height] < cutoff {
                first = height + 1
            } else {
                last = height
            }
        }
        return first
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
        let network = session.settings.Network
        DecodedSends = Dictionary[string, Dictionary[string, DecodedMemo]](StringComparer.Ordinal)
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
                let decoded = Dictionary[string, DecodedMemo](StringComparer.Ordinal)
                for group in row
                    .GetProperty("recipients")
                    .EnumerateArray()
                    .Where(recipient -> NodeJson.Text(recipient, "memo_hex").Length > 0)
                    .GroupBy(recipient -> NodeJson.Text(recipient, "address")) {
                    if !Wire.IsEnvelope(NodeJson.Text(group.First(), "memo_hex")) {
                        continue
                    }
                    binary.Add(group.Key)
                    let hex = StringBuilder()
                    for recipient in group {
                        hex.Append(NodeJson.Text(recipient, "memo_hex"))
                    }
                    if let envelope = Wire.DecodeMemo(hex.ToString(), network) {
                        decoded[group.Key] = DecodedMemo(envelope, Array.Empty[int32](), 0)
                    }
                }
                if decoded.Count > 0 {
                    DecodedSends[NodeJson.Text(row, "txid")] = decoded
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
