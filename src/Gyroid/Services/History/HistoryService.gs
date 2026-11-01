package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Generic
import System.Globalization
import System.IO
import System.Linq
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class HistoryService {
    let session WalletSession
    var RawReceived[]JsonElement = Array.Empty[JsonElement]()
    var RawSends[]JsonElement = Array.Empty[JsonElement]()
    var DecodedReceived Dictionary[string, DecodedMemo] = Dictionary[string, DecodedMemo](StringComparer.Ordinal)
    var DecodedSends Dictionary[string, Dictionary[string, DecodedMemo]] =
    Dictionary[string, Dictionary[string, DecodedMemo]](StringComparer.Ordinal)
    private var baseOutputs[]WalletOutput = Array.Empty[WalletOutput]()
    private var changeOutputs[]WalletOutput = Array.Empty[WalletOutput]()
    private var baseSends[]WalletSend = Array.Empty[WalletSend]()
    private var received List[WalletOutput] = List[WalletOutput]()
    private var loaded int32
    private let blockTimes Dictionary[uint64, int64] = Dictionary[uint64, int64]()
    private var blockHash string = ""
    private var blockHeight uint64

    prop Total uint64 -> uint64(received.Count)
    prop More bool -> loaded < received.Count
    prop Outputs IReadOnlyList[WalletOutput] -> received
    prop ChangeOutputs IReadOnlyList[WalletOutput] -> changeOutputs

    init(session WalletSession) {
        this.session = session
    }

    func Reset() {
        RawReceived = Array.Empty[JsonElement]()
        RawSends = Array.Empty[JsonElement]()
        DecodedReceived = Dictionary[string, DecodedMemo](StringComparer.Ordinal)
        DecodedSends = Dictionary[string, Dictionary[string, DecodedMemo]](StringComparer.Ordinal)
        baseOutputs = Array.Empty[WalletOutput]()
        changeOutputs = Array.Empty[WalletOutput]()
        baseSends = Array.Empty[WalletSend]()
        received = List[WalletOutput]()
        loaded = 0
        blockTimes.Clear()
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
        let changes = List[WalletOutput]()
        for row in RawReceived {
            let txid = NodeJson.Text(row, "txid")
            let index = int32(NodeJson.Number(row, "output_index"))
            let hex = NodeJson.Text(row, "memo_hex")
            let output = WalletOutput{
                TxId: txid,
                OutputIndex: index,
                Amount: NodeJson.Number(row, "amount"),
                BlockHeight: NodeJson.Number(row, "block_height"),
                Spent: NodeJson.Flag(row, "spent"),
                Coinbase: NodeJson.Flag(row, "is_coinbase"),
                IsChange: sentTransactions.TryGetValue(txid, out let recipientCount) && index >= recipientCount,
                OutputIndices: DecodedReceived.TryGetValue(txid, out let decoded) && decoded.OutputIndices.Contains(
                    index
                ) ?
                decoded.OutputIndices: Array.Empty[int32](),
                Memo: hex.Length > 0 && binaryMemos.Contains(txid) ? "[non-text memo]": NodeJson.Memo(hex)
            }
            if output.IsChange {
                changes.Add(output)
            } else {
                outputs.Add(output)
            }
        }
        baseOutputs = outputs.ToArray()
        changeOutputs = changes.ToArray()
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
                let message = session.Messages.HistoryMessage(output.TxId, "", false)
                outputs.Add(
                    WalletOutput{
                        ... output,
                        OutputIndex: output.OutputIndices[0],
                        Memo: message?.Text ?? output.Memo,
                        InvitationName: message?.InvitationName ?? output.InvitationName
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
                    let message = session.Messages.HistoryMessage(sent.TxId, recipient.Address, true)
                    let merged = WalletRecipient{
                        ... recipient,
                        Memo: message?.Text ?? recipient.Memo,
                        InvitationName: message?.InvitationName ?? recipient.InvitationName
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
            let status = session.Node.Status
            if blockHash != status.BestHash {
                var extends = false
                if blockHash.Length > 0 && status.Height == blockHeight + 1 {
                    using let block = await session.Node.Api.JsonAsync("block/" + status.Height.ToString(), ct: ct)
                    extends = NodeJson.Text(block.RootElement, "prev_hash").StartsWith(
                        blockHash,
                        StringComparison.Ordinal
                    )
                }
                if !extends {
                    for entry in blockTimes {
                        if entry.Key > status.Height || status.Height - entry.Key < 100 {
                            blockTimes.Remove(entry.Key)
                        }
                    }
                }
                blockHash = status.BestHash
                blockHeight = status.Height
            }
            let times = Dictionary[uint64, int64]()
            for height in heights {
                if !blockTimes.ContainsKey(height) {
                    using let block = await session.Node.Api.JsonAsync("block/" + height.ToString(), ct: ct)
                    blockTimes[height] = NodeJson.Signed(block.RootElement, "timestamp")
                }
                times[height] = blockTimes[height]
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
    shared {
        private func SelfSends(snapshot WalletSnapshot) HashSet[string] -> snapshot
            .Sends
            .Where(send -> send.IsSelf(snapshot.Address))
            .Select(send -> send.TxId)
            .ToHashSet()

        func PrepareRibbon(
            rows[]HistoryRow,
            low uint64,
            span uint64,
            tip uint64,
            columns int32,
            ct CancellationToken
        ) HistoryRibbonData {
            let bins = [columns]HistoryRibbonBin
            let received = [columns]float64
            let mined = [columns]float64
            let sent = [columns]float64
            let size = float64(span) / columns
            for row in rows {
                ct.ThrowIfCancellationRequested()
                if row.Height <= low || row.Height > tip {
                    continue
                }
                let column = Math.Min(columns - 1, int32((row.Height - low) / size))
                if row.Kind == HistoryRowKind.Received {
                    received[column] += float64(row.Amount)
                } else if row.Kind == HistoryRowKind.Mined {
                    mined[column] += float64(row.Amount)
                } else {
                    sent[column] += float64(row.Amount)
                }
                let distance = float64(row.Height - low)
                let last = Math.Min(columns - 1, int32(Math.Ceiling(distance / size)) - 1)
                let first = Math.Min(last, int32(Math.Ceiling((distance - 1) / size)))
                for tooltipColumn in first ... last + 1 {
                    var bin = bins[tooltipColumn]
                    if bin.ReceivedCount + bin.MinedCount + bin.SentCount == 0 {
                        bin.Time = row.Time
                    }
                    if row.Kind == HistoryRowKind.Received {
                        bin.Received += row.Amount
                        bin.ReceivedCount++
                    } else if row.Kind == HistoryRowKind.Mined {
                        bin.Mined += row.Amount
                        bin.MinedCount++
                    } else if row.Kind == HistoryRowKind.Sent {
                        bin.Sent += row.Amount
                        bin.SentCount++
                    }
                    bins[tooltipColumn] = bin
                }
            }
            var top = 1.0
            for column in 0 ... columns {
                top = Math.Max(top, Math.Max(received[column] + mined[column], sent[column]))
            }
            return HistoryRibbonData{Bins: bins, Received: received, Mined: mined, Sent: sent, Top: top}
        }
    }

    func PrepareOverview(
        snapshot WalletSnapshot,
        arrivalOutputs IReadOnlyList[WalletOutput],
        changes IReadOnlyList[WalletOutput],
        outputs[]WalletOutput,
        tip uint64,
        times Dictionary[uint64, int64],
        ct CancellationToken
    ) HistoryOverview {
        let arrivals = List[HistoryArrival]()
        let activity = List[HistoryActivity]()
        let selfSends = SelfSends(snapshot)
        for output in arrivalOutputs.Concat(changes) {
            ct.ThrowIfCancellationRequested()
            let maturity = output.Maturity(tip)
            if !output.Spent && output.BlockHeight > 0 && !maturity.Ready && snapshot.Balance != nil {
                arrivals.Add(
                    HistoryArrival{
                        Kind: output.IsChange ? "change": output.Coinbase ? "mined": "in",
                        Amount: output.Amount,
                        Source: output.Memo,
                        InvitationName: output.InvitationName,
                        Confirmations: maturity.Count,
                        Required: maturity.Required,
                        Blocks: maturity.Remaining,
                        TxId: output.TxId,
                        OutputIndex: output.OutputIndex,
                        Height: output.BlockHeight,
                        Self: selfSends.Contains(output.TxId)
                    }
                )
            }
        }
        for output in outputs {
            ct.ThrowIfCancellationRequested()
            let maturity = output.Maturity(tip)
            if selfSends.Contains(output.TxId) ||
                (!output.Spent && output.BlockHeight > 0 && !maturity.Ready) ||
                activity.Count >= 50 {
                continue
            }
            activity.Add(
                HistoryActivity{
                    Kind: output.Coinbase ? "mined": "in",
                    Amount: output.Amount,
                    Label: output.Memo,
                    InvitationName: output.InvitationName,
                    Status: output.BlockHeight == 0 ? "mempool": "confirmed",
                    Ready: output.BlockHeight > 0 && maturity.Ready,
                    Order: output.BlockHeight == 0 ? uint64.MaxValue: output.BlockHeight,
                    Timestamp: times.GetValueOrDefault(output.BlockHeight),
                    TxId: output.TxId,
                    OutputIndex: output.OutputIndex,
                    Height: output.BlockHeight,
                    Confirmations: maturity.Count,
                    Required: maturity.Required
                }
            )
        }
        if let balance = snapshot.Balance {
            if balance.Unconfirmed > 0 {
                let pending = snapshot.Sends.FirstOrDefault(send -> send.Status == "mempool")
                arrivals.Add(
                    HistoryArrival{
                        Kind: "pool",
                        Amount: balance.Unconfirmed,
                        Source: "",
                        Required: 10,
                        Blocks: 11,
                        TxId: "",
                        OutputIndex: -1,
                        Self: pending?.IsSelf(snapshot.Address) ?? false
                    }
                )
            }
        }
        for send in snapshot.Sends.Take(50) {
            ct.ThrowIfCancellationRequested()
            let self = selfSends.Contains(send.TxId)
            let maturity = WalletMaturity(send.Confirmations, 10)
            activity.Add(
                HistoryActivity{
                    Kind: self ? "self": "out",
                    Amount: self ? send.Fee: send.Amount,
                    Label: "",
                    Status: send.Status,
                    Ready: send.Status == "confirmed" && maturity.Ready,
                    Order: send.Status == "mempool" ? uint64.MaxValue: tip + 1 - Math.Min(tip, send.Confirmations),
                    Timestamp: send.Timestamp,
                    TxId: send.TxId,
                    OutputIndex: -1,
                    Height: send.Status == "confirmed" && send.Confirmations > 0 && tip + 1 >= send.Confirmations ?
                    tip + 1 - send.Confirmations: 0,
                    Confirmations: maturity.Count,
                    Required: 10
                }
            )
        }
        return HistoryOverview{
            Arrivals: arrivals.OrderBy(arrival -> arrival.Blocks).ToArray(),
            Activity: activity.OrderByDescending(item -> item.Order).Take(50).ToArray()
        }
    }

    func Prepare(input HistoryPreparation, ct CancellationToken) HistoryPrepared {
        let rows = input.ReuseRows ? input.Previous.Rows: PrepareRows(input, input.Previous.Rows, ct)
        let tip = input.Tip
        let oldest = rows.Length > 0 && rows[rows.Length - 1].Height > 0 ? rows[rows.Length - 1].Height: tip
        let low = input.Cutoff == 0 ? oldest > 0 ? oldest - 1: 0UL: Math.Min(tip, input.Cutoff - 1)
        let first = input.To > 0 ? Math.Max(input.From, input.Cutoff): input.Cutoff
        let last = input.To > 0 ? input.To: tip
        let shown = rows.Where(
            (row HistoryRow) -> row.Height == 0 ? last >= tip: row.Height >= first && row.Height <= last
        )
            .ToArray()
        var summary = HistorySummary{}
        for row in shown {
            if row.Kind == HistoryRowKind.Received {
                summary.Received += row.Amount
            } else if row.Kind == HistoryRowKind.Mined {
                summary.Mined += row.Amount
            } else {
                summary.Sent += row.Self ? 0UL: row.Amount
                summary.Fees += row.Fee
            }
        }
        let export = input.ReuseExport ? input
            .Previous
            .Export: input.Complete ? rows: PrepareRows(input with{Complete = true}, input.Previous.Export, ct)
        let span = Math.Max(1UL, tip - low)
        let columns = int32(Math.Max(40.0, Math.Min(float64(span), Math.Floor(input.PlotWidth / 3))))
        let ribbon = PrepareRibbon(rows, low, span, tip, columns, ct)
        return HistoryPrepared{
            SelectionKey: input.SelectionTx.Length > 0 ?
            rows.FirstOrDefault(row -> row.TxId == input.SelectionTx).Key ?? "": "",
            Rows: input.ReuseRows || rows.SequenceEqual(input.Previous.Rows) ? input.Previous.Rows: rows,
            Shown: shown.SequenceEqual(input.Previous.Shown) ? input.Previous.Shown: shown,
            Export: input.ReuseExport || export.SequenceEqual(input.Previous.Export) ? input.Previous.Export: export,
            ExportCount: export.Count(row -> row.Height == 0 ? last >= tip: row.Height >= first && row.Height <= last),
            Summary: summary,
            Low: low,
            Span: span,
            Ribbon: ribbon.Bins.SequenceEqual(input.Previous.Ribbon.Bins) && ribbon.Received.SequenceEqual(
                input.Previous.Ribbon.Received
            ) &&
                ribbon
                .Mined
                .SequenceEqual(input.Previous.Ribbon.Mined) && ribbon.Sent.SequenceEqual(
                input.Previous.Ribbon.Sent
            ) ? input
                .Previous
                .Ribbon: ribbon
        }
    }

    func PrepareRows(input HistoryPreparation, previousRows[]HistoryRow, ct CancellationToken)[]HistoryRow {
        let snapshot = input.Snapshot
        let tip = input.Tip
        let previous = previousRows.ToDictionary(row -> row.Key, StringComparer.Ordinal)
        let rows = List[HistoryRow]()
        let selfSends = SelfSends(snapshot)
        for output in input.Complete ? input.ExportOutputs: input.Snapshot.History {
            ct.ThrowIfCancellationRequested()
            if selfSends.Contains(output.TxId) {
                continue
            }
            let key = "r:" + output.TxId + ":" + output.OutputIndex.ToString()
            let indices = previous.TryGetValue(key, out let old) && old.Indices.SequenceEqual(output.OutputIndices) ?
            old.Indices: output.OutputIndices
            rows.Add(
                Item(key) with{
                    Kind = output.Coinbase ? HistoryRowKind.Mined: HistoryRowKind.Received,
                    TxId = output.TxId,
                    Index = output.OutputIndex,
                    Indices = indices,
                    Amount = output.Amount,
                    Memo = output.Memo,
                    InvitationName = output.InvitationName,
                    Height = output.BlockHeight,
                    Maturity = output.Maturity(tip),
                    Time = input.Times.GetValueOrDefault(output.BlockHeight)
                }
            )
        }
        let lowest = if !input.Complete && snapshot.HistoryMore && snapshot.History.Length > 0 {
            snapshot.History[snapshot.History.Length - 1].BlockHeight
        } else {
            0UL
        }
        for send in snapshot.Sends {
            ct.ThrowIfCancellationRequested()
            var entries = send
                .Recipients
                .Select(
                (entry WalletRecipient, index int32) -> HistoryRecipient{
                    Index: index,
                    Address: entry.Address,
                    Amount: entry.Amount,
                    Memo: entry.Memo,
                    InvitationName: entry.InvitationName
                }
            )
                .ToArray()
            if previous.TryGetValue("s:" + send.TxId, out let old) && old.Recipients.SequenceEqual(entries) {
                entries = old.Recipients
            }
            let confirmed = send.Status == "confirmed" && send.Confirmations > 0 && tip + 1 >= send.Confirmations
            let height = confirmed ? tip + 1 - send.Confirmations: 0
            if confirmed && height < lowest {
                continue
            }
            rows.Add(
                Item("s:" + send.TxId) with{
                    Kind = confirmed ? HistoryRowKind.Sent: HistoryRowKind.Pending,
                    TxId = send.TxId,
                    Amount = selfSends.Contains(send.TxId) ? send.Fee: send.Amount,
                    SentAmount = send.Amount,
                    Self = selfSends.Contains(send.TxId),
                    Fee = send.Fee,
                    Memo = String.Join(
                        " ",
                        entries
                            .Select((entry HistoryRecipient) -> entry.Memo)
                            .Where((memo string) -> memo.Length > 0)
                            .Distinct(StringComparer.Ordinal)
                    ),
                    InvitationName = entries.Select(entry -> entry.InvitationName).FirstOrDefault(
                        name -> name.Length > 0
                    ) ??
                        "",
                    Height = height,
                    Maturity = WalletMaturity(confirmed ? send.Confirmations: uint64(0), 10),
                    Time = confirmed ? input.Times.GetValueOrDefault(height): send.Timestamp,
                    State = send.Status,
                    Recipients = entries
                }
            )
        }
        rows.Sort(
            (left HistoryRow, right HistoryRow) -> if (left.Height == 0) != (right.Height == 0) {
                left.Height == 0 ? -1: 1
            } else if left.Height != right.Height {
                right.Height.CompareTo(left.Height)
            } else {
                right.Time.CompareTo(left.Time)
            }
        )
        return rows.ToArray()
    }

    private func Item(key string) HistoryRow -> HistoryRow{
        Key: key,
        TxId: "",
        Memo: "",
        InvitationName: "",
        Indices: Array.Empty[int32](),
        State: "",
        Recipients: Array.Empty[HistoryRecipient]()
    }

    async func WriteExport(
        path string,
        all[]HistoryRow,
        tip uint64,
        times Dictionary[uint64, int64],
        withMemos bool,
        suffix string,
        selectedPeriod string,
        selectedFrom uint64,
        selectedTo uint64,
        ct CancellationToken
    ) {
        let known = Dictionary[uint64, int64](times)
        let cutoff = await PeriodStartAsync(selectedPeriod, tip, ct)
        let rows = all.Where(
            (row HistoryRow) ->
            (row.Height == 0 || row.Height >= cutoff) &&
                (
                selectedTo == 0 ||
                    (row.Height == 0 ? selectedTo >= tip: row.Height >= selectedFrom && row.Height <= selectedTo)
            )
        )
            .ToArray()
        let missing = rows
            .Select((row HistoryRow) -> row.Height)
            .Where((height uint64) -> height > 0 && !known.ContainsKey(height))
            .Distinct()
            .ToArray()
        let fetched = await BlockTimesAsync(missing, ct)
        for entry in fetched {
            known[entry.Key] = entry.Value
        }
        await PrivateFiles.WriteAtomic(
            path,
            stream -> Table(stream, rows, known, withMemos, suffix == "json", ct),
            true,
            false
        )
    }

    private func Table(
        stream Stream,
        rows[]HistoryRow,
        known Dictionary[uint64, int64],
        withMemos bool,
        json bool,
        ct CancellationToken
    ) Task {
        using let writer Utf8JsonWriter? = json ? Utf8JsonWriter(stream, JsonWriterOptions{Indented: true}): nil
        using let text StreamWriter? = json ? nil: StreamWriter(stream, UTF8Encoding(false), 65536, true)
        text?.Write(withMemos ? "type,amount,fee,height,time,txid,memo\n": "type,amount,fee,height,time,txid\n")
        writer?.WriteStartArray()
        for row in rows {
            ct.ThrowIfCancellationRequested()
            let seconds = row.Time > 0 ? row.Time: known.GetValueOrDefault(row.Height)
            let time = seconds > 0 ? DateTimeOffset.FromUnixTimeSeconds(seconds).ToString(
                "yyyy-MM-ddTHH:mm:ssZ",
                CultureInfo.InvariantCulture
            ): ""
            let amount = (row.Kind == HistoryRowKind.Received || row.Kind == HistoryRowKind.Mined ? "": "-") +
                WalletAmount.Format(row.Amount)
            let fee = WalletAmount.Format(row.Fee)
            let kind = switch row.Kind {
                case HistoryRowKind.Received: "in"
                case HistoryRowKind.Mined: "mined"
                case HistoryRowKind.Sent: "out"
                case HistoryRowKind.Pending: "pending"
            }
            let content = row.InvitationName.Length > 0 ? "Group invitation: " + row.InvitationName: row.Memo
            if let output = writer {
                output.WriteStartObject()
                output.WriteString("type", kind)
                output.WriteString("amount", amount)
                output.WriteString("fee", fee)
                output.WriteNumber("height", row.Height)
                output.WriteString("time", time)
                output.WriteString("txid", row.TxId)
                if withMemos {
                    output.WriteString("memo", content)
                }
                output.WriteEndObject()
                if output.BytesPending >= 65536 {
                    output.Flush()
                }
            } else if let csv = text {
                csv.Write(kind)
                csv.Write(',')
                csv.Write(amount)
                csv.Write(',')
                csv.Write(fee)
                csv.Write(',')
                csv.Write(row.Height.ToString(CultureInfo.InvariantCulture))
                csv.Write(',')
                csv.Write(time)
                csv.Write(',')
                csv.Write(row.TxId)
                if withMemos {
                    let memo = "=+-@\t\r".Contains(content.FirstOrDefault()) ? "'" + content: content
                    csv.Write(",\"")
                    csv.Write(memo.Replace("\"", "\"\""))
                    csv.Write('"')
                }
                csv.Write('\n')
            }
        }
        writer?.WriteEndArray()
        return Task.CompletedTask
    }

    func WriteTextAsync(path string, text string, ct CancellationToken) Task {
        let bytes = Encoding.UTF8.GetBytes(text)
        return PrivateFiles.WriteAtomic(path, stream -> stream.WriteAsync(bytes, ct).AsTask(), true, false)
    }
}
