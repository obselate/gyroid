package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Data
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Globalization
import System.IO
import System.Linq
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

data struct HistoryInput {
    var Session WalletSession
    var Ui Presentation
    var Snapshot WalletSnapshot
    var Window Window?
    var Tip uint64
    var Privacy bool
    var Language string
    var Width float64
    var OnReceive Action
    var OnMessage Action[string]
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
    var Fee uint64
    var Self bool
    var Memo string
    var Outputs string
    var Height uint64
    var Depth uint64
    var Need uint64
    var Time int64
    var State string
    var Recipients[]WalletRecipient
    var Open bool
    var Revision int32
    var Privacy bool
    var Language string
    var Width float64
}

class HistoryPage : Cell[HistoryInput] {
    private var current HistoryInput
    private var period string = "30d"
    private var from uint64
    private var to uint64
    private var anchor uint64
    private var dragging bool
    private var hover int32 = -1
    private var marked uint64
    private var expanded string = ""
    private var tab string = "details"
    private var revision int32
    private var proofFor string = ""
    private var proofKey string = ""
    private var proofValid bool
    private var proofRecipient int32
    private var exporting bool
    private var format string = "csv"
    private var observed string = ""
    private var memos bool = true
    private var plotWidth float64
    private var low uint64
    private var span uint64 = 1
    private var shown[]HistoryRow = []HistoryRow{}
    private var fetching bool
    private var loading bool
    private var resolving bool
    private var resolvedPeriod string = ""
    private var resolvedTip uint64
    private var periodStart uint64
    private let times Dictionary[uint64, int64] = Dictionary[uint64, int64]()
    private let requested HashSet[uint64] = HashSet[uint64]()
    private let plot ElementHandle = ElementHandle()
    private let list ElementHandle = ElementHandle()
    private let exportAnchor ElementHandle = ElementHandle()
    private let rowKey Func[HistoryRow, string]
    private let rowBuilder Func[HistoryRow, Blob]
    private var failedSnapshot WalletSnapshot? = nil

    init() {
        rowKey = (row HistoryRow) -> row.Key
        rowBuilder = (row HistoryRow) -> Row(row)
        plot.MetricsChanged += metrics -> {
            if metrics.BorderBox.Width != plotWidth {
                plotWidth = metrics.BorderBox.Width
                Rebuild()
            }
        }
        list.MetricsChanged += metrics -> {
            let first = int32(metrics.ScrollOffset.Y / 38)
            RequestTimes(shown.Skip(Math.Max(0, first - 10)).Take(50).Select((row HistoryRow) -> row.Height))
            if period == "all" && metrics.ScrollRange.Y - metrics.ScrollOffset.Y < 440 {
                LoadMore()
            }
        }
    }

    protected override func Build(input HistoryInput) Blob {
        current = input
        let ui = input.Ui
        let compact = input.Width < 1000
        let all = Collect(input, exporting)
        let tip = input.Tip
        let resolved = resolvedPeriod == period && resolvedTip == tip
        if period != "all" && !resolved && !resolving && failedSnapshot != input.Snapshot {
            if let window = input.Window {
                resolving = true
                input.Ui.Actions.Background(ct -> ResolvePeriod(window, input, period, ct))
            }
        }
        let cutoff = period == "all" ? 0UL: resolved ? periodStart: tip + 1
        let oldest = all.Count > 0 && all[all.Count - 1].Height > 0 ? all[all.Count - 1].Height: tip
        low = period == "all" ? oldest > 0 ? oldest - 1: 0UL: Math.Min(tip, cutoff > 0 ? cutoff - 1: 0UL)
        span = Math.Max(1UL, tip - low)
        if input.Snapshot.HistoryMore && period != "all" && resolved && oldest >= cutoff {
            LoadMore()
        }
        let first = to > 0 ? Math.Max(from, cutoff): cutoff
        let last = to > 0 ? to: tip
        shown = all.Where((row HistoryRow) -> row.Height == 0 ? last >= tip: row.Height >= first && row.Height <= last)
            .ToArray()
        RequestTimes(shown.Take(50).Select((row HistoryRow) -> row.Height))
        let panel = WalletParts.Card(ui, Edges{Top: 12, Bottom: 12, Left: 20, Right: 20}, compact ? 8.0: 10.0)
        panel.FlexGrow = 1
        panel.AlignSelf = AlignSelf.Stretch
        let bar = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Height: 30,
            FlexShrink: 0,
            Segments(
                "period",
                "range",
                []string{"1d", "7d", "30d", "all"},
                period,
                id -> {
                    period = id
                    to = 0
                    Rebuild()
                }
            )
        }
        if to > 0 {
            bar.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    Height: 28,
                    Padding: Edges{Left: 10, Right: 4},
                    BorderWidth: 1,
                    BorderColor: ui.Edge,
                    BorderRadius: 4,
                    Label(ui, Count(from) + " – " + Count(to), 12, ui.Ink, ""),
                    IconButton{
                        Icon: MaterialIcons.Create("close", 12, ui.Dim),
                        AccessibilityName: ui.Strings.Get("clear range"),
                        OnClick: () -> {
                            to = 0
                            Rebuild()
                        }
                    }.Build()
                }
            )
        }
        bar.Add(
            Info(
                "range",
                "Drag across blocks to pick a range. Bars above the line are received or mined. Bars below are sent.",
                input
            )
        )
        bar.Add(Container{FlexGrow: 1})
        bar.Add(Export(input))
        panel.Add(bar)
        panel.Add(Ribbon(input, all, compact))
        if all.Count == 0 && !input.Snapshot.HistoryMore {
            panel.Add(
                Container{
                    FlexGrow: 1,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Gap: 14,
                    Label(ui, ui.Strings.Get("No transactions yet"), 15, ui.Ink),
                    Button(ui, "receive", input.OnReceive, false, true)
                }
            )
            return panel
        }
        panel.Add(Summary(input))
        let rows = VirtualRows(shown, 38, rowKey, rowBuilder, false)
        rows.Handle = list
        rows.FlexGrow = 1
        rows.FlexBasis = 0
        rows.MinHeight = 0
        rows.BorderWidth = Edges{Top: 1}
        rows.BorderColor = ui.Rule
        panel.Add(rows)
        let lensRow = Array.FindIndex(
            shown,
            (row HistoryRow) -> row.Kind == HistoryRowKind.Sent && row.TxId == observed
        )
        if lensRow >= 0 {
            let row = shown[lensRow]
            let portal = Portal()
            portal.Add(
                Cell.Mount[ObserverLensInput, ObserverLens](
                    "lens",
                    ObserverLensInput{
                        Session: input.Session,
                        Ui: ui,
                        Send: input.Snapshot.Sends.First((send WalletSend) -> send.TxId == observed),
                        Recipient: WalletText.Short(row.Recipients.FirstOrDefault()?.Address ?? "") +
                            (row.Recipients.Length > 1 ? " +" + (row.Recipients.Length - 1).ToString(): ""),
                        Privacy: input.Privacy,
                        Language: input.Language,
                        Width: input.Width,
                        OnProve: () -> {
                            observed = ""
                            tab = "proof"
                            revision++
                            if proofFor != row.TxId {
                                Prove(row)
                            }
                            Rebuild()
                        },
                        OnClose: () -> {
                            observed = ""
                            Rebuild()
                        }
                    }
                )
            )
            panel.Add(portal)
        }
        return panel
    }

    private func Collect(input HistoryInput, complete bool = false) List[HistoryRow] {
        let snapshot = input.Snapshot
        let tip = input.Tip
        let rows = List[HistoryRow]()
        let selfSends = snapshot
            .Sends
            .Where(send -> send.IsSelf(snapshot.Address))
            .Select(send -> send.TxId)
            .ToHashSet()
        for output in complete ? input.Session.History.Outputs: input.Snapshot.History {
            if selfSends.Contains(output.TxId) {
                continue
            }
            rows.Add(
                Item(input, "r:" + output.TxId + ":" + output.OutputIndex.ToString()) with{
                    Kind = output.Coinbase ? HistoryRowKind.Mined: HistoryRowKind.Received,
                    TxId = output.TxId,
                    Index = output.OutputIndex,
                    Outputs = String.Join(", ", output.OutputIndices.Select(index -> "#" + index.ToString())),
                    Amount = output.Amount,
                    Memo = output.Memo,
                    Height = output.BlockHeight,
                    Depth = output.BlockHeight > 0 && tip >= output.BlockHeight ? tip + 1 - output.BlockHeight: 0,
                    Need = output.Coinbase ? 60UL: 10UL,
                    Time = times.GetValueOrDefault(output.BlockHeight)
                }
            )
        }
        let lowest = if !complete && snapshot.HistoryMore && snapshot.History.Length > 0 {
            snapshot.History[snapshot.History.Length - 1].BlockHeight
        } else {
            0UL
        }
        for send in snapshot.Sends {
            let confirmed = send.Status == "confirmed" && send.Confirmations > 0 && tip + 1 >= send.Confirmations
            let height = confirmed ? tip + 1 - send.Confirmations: 0
            if confirmed && height < lowest {
                continue
            }
            rows.Add(
                Item(input, "s:" + send.TxId) with{
                    Kind = confirmed ? HistoryRowKind.Sent: HistoryRowKind.Pending,
                    TxId = send.TxId,
                    Amount = selfSends.Contains(send.TxId) ? send.Fee: send.Amount,
                    Self = selfSends.Contains(send.TxId),
                    Fee = send.Fee,
                    Memo = String.Join(
                        " ",
                        send
                            .Recipients
                            .Select((entry WalletRecipient) -> entry.Memo)
                            .Where((memo string) -> memo.Length > 0)
                            .Distinct(StringComparer.Ordinal)
                    ),
                    Height = height,
                    Depth = confirmed ? send.Confirmations: 0,
                    Need = 10,
                    Time = confirmed ? times.GetValueOrDefault(height): send.Timestamp,
                    State = send.Status,
                    Recipients = send.Recipients
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
        return rows
    }

    private func Item(input HistoryInput, key string) HistoryRow -> HistoryRow{
        Key: key,
        TxId: "",
        Memo: "",
        Outputs: "",
        State: "",
        Recipients: Array.Empty[WalletRecipient](),
        Open: key == expanded,
        Revision: key == expanded ? revision: 0,
        Privacy: input.Privacy,
        Language: input.Language,
        Width: input.Width
    }

    private func Ribbon(input HistoryInput, all List[HistoryRow], compact bool) Blob {
        let ui = input.Ui
        let tip = input.Tip
        let width = plotWidth
        let height = compact ? 60.0: input.Width >= 1700 ? 110.0: 84.0
        let columns = int32(Math.Max(40.0, Math.Min(float64(span), Math.Floor(width / 3))))
        let size = float64(span) / columns
        let received = [columns]float64
        let mined = [columns]float64
        let sent = [columns]float64
        for row in all {
            if row.Height <= low || row.Height > tip {
                continue
            }
            let column = Math.Min(columns - 1, int32((row.Height - low) / size))
            let value = float64(row.Amount)
            if row.Kind == HistoryRowKind.Received {
                received[column] += value
            } else if row.Kind == HistoryRowKind.Mined {
                mined[column] += value
            } else {
                sent[column] += value
            }
        }
        var top = 1.0
        for column in 0 ... columns {
            top = Math.Max(top, Math.Max(received[column] + mined[column], sent[column]))
        }
        let scale Func[float64, float64] = value -> input.Privacy ? 1.0: Math.Sqrt(value / top)
        let up = PathBuilder(0, 0, Math.Max(1.0, width), height)
        let coin = PathBuilder(0, 0, Math.Max(1.0, width), height)
        let down = PathBuilder(0, 0, Math.Max(1.0, width), height)
        let step = width / columns
        for column in 0 ... columns {
            let x = (column + 0.15) * step
            let w = 0.7 * step
            let total = received[column] + mined[column]
            if total > 0 {
                let bar = scale(total) * 0.44 * height
                let split = bar * received[column] / total
                Rectangle(up, x, 0.56 * height - bar, w, split)
                Rectangle(coin, x, 0.56 * height - bar + split, w, bar - split)
            }
            if sent[column] > 0 {
                Rectangle(down, x, 0.58 * height, w, Math.Max(0.03, scale(sent[column]) * 0.4) * height)
            }
        }
        let area = Container{
            Handle: plot,
            Height: height,
            FlexShrink: 0,
            Focusable: true,
            Accessibility: Accessibility{Name: ui.Strings.Get("block range")},
            Focus: Theme.Read().FocusStyle,
            OnPointerDown: (event PointerEvent) -> {
                event.Capture()
                dragging = true
                anchor = HeightAt(event.Position.X)
                Select(anchor, anchor)
            },
            OnPointerMove: (event PointerEvent) -> {
                let at = HeightAt(event.Position.X)
                if dragging {
                    Select(Math.Min(anchor, at), Math.Max(anchor, at))
                } else {
                    let column = Math.Min(columns - 1, int32(Math.Max(0.0, event.Position.X) / step))
                    if column != hover {
                        hover = column
                        Rebuild()
                    }
                }
            },
            OnPointerUp: (event PointerEvent) -> {
                dragging = false
                if to - from < 2 {
                    let column = Math.Min(columns - 1, int32(Math.Max(0.0, event.Position.X) / step))
                    Select(low + 1 + uint64(column * size), Math.Min(tip, low + uint64((column + 1) * size)))
                }
            },
            OnPointerLeave: (event PointerEvent) -> {
                if hover >= 0 {
                    hover = -1
                    Rebuild()
                }
            },
            OnKeyDown: (event KeyEvent) -> {
                let block = uint64(Math.Max(1.0, size))
                if event.Key == Key.Escape && to > 0 {
                    to = 0
                    Rebuild()
                } else if event.Key == Key.Left || event.Key == Key.Right {
                    let start = to > 0 ? from: tip - block + 1
                    let end = to > 0 ? to: tip
                    let shift = event.Key == Key.Left ? -int64(block): int64(block)
                    let next = uint64(Math.Clamp(int64(start) + shift, int64(low + 1), int64(tip)))
                    if event.Modifiers.Shift {
                        Select(Math.Min(next, end), end)
                    } else {
                        Select(next, Math.Min(tip, next + block - 1))
                    }
                    event.PreventDefault()
                }
            },
            Container{
                Position: PositionType.Absolute,
                Left: 0,
                Right: 0,
                Top: 0.57 * height,
                Height: 1,
                BackgroundColor: ui.Edge
            },
            Shape{
                Position: PositionType.Absolute,
                Width: width,
                Height: height,
                Path: up.Build(),
                Fit: ShapeFit.Fill,
                BackgroundColor: ui.Mint
            },
            Shape{
                Position: PositionType.Absolute,
                Width: width,
                Height: height,
                Path: coin.Build(),
                Fit: ShapeFit.Fill,
                BackgroundColor: ui.Lime
            },
            Shape{
                Position: PositionType.Absolute,
                Width: width,
                Height: height,
                Path: down.Build(),
                Fit: ShapeFit.Fill,
                BackgroundColor: ui.Pink
            }
        }
        if to > 0 {
            let left = Offset(from - 1)
            let right = Offset(to)
            area.Add(Shade(0, left))
            area.Add(Shade(right, width))
            area.Add(Handle(left, height))
            area.Add(Handle(right, height))
        }
        let cursor = if hover >= 0 && !dragging {
            (hover + 0.5) * step
        } else if marked > low {
            Offset(marked)
        } else {
            -1.0
        }
        if cursor >= 0 {
            area.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: cursor,
                    Width: 1,
                    Top: 0,
                    Bottom: 0,
                    BackgroundColor: Color.Parse("#858585"),
                    HitTestSelf: false
                }
            )
        }
        if hover >= 0 && !dragging {
            area.Add(Tip(input, all, hover, size, step, width))
        }
        let days = float64(span) / 288
        let mark = if days <= 1 {
            48UL
        } else if days <= 7 {
            288UL
        } else {
            288UL * uint64(Math.Ceiling(days / 6))
        }
        let axis = Container{Height: 18, FlexShrink: 0, BorderWidth: Edges{Top: 1}, BorderColor: ui.Edge}
        let marks = List[uint64]()
        var at = tip - Math.Min(tip, mark)
        while at > low + mark * 3 / 10 {
            marks.Add(at)
            at -= Math.Min(at, mark)
        }
        RequestTimes(marks)
        for value in marks {
            let seconds = times.GetValueOrDefault(value)
            if seconds > 0 {
                let time = DateTimeOffset.FromUnixTimeSeconds(seconds).ToLocalTime()
                axis.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Left: Offset(value) - 40,
                        Width: 80,
                        Top: 3,
                        AlignItems: AlignItems.Center,
                        Label(
                            ui,
                            time.ToString(days <= 1 ? "HH:mm": "MM-dd", CultureInfo.InvariantCulture),
                            11,
                            ui.Dim,
                            ""
                        )
                    }
                )
            }
        }
        axis.Add(Container{Position: PositionType.Absolute, Right: 0, Top: 3, Label(ui, Count(tip), 11, ui.Body, "")})
        return Container{
            FlexShrink: 0,
            Padding: Edges{Top: 8, Left: 12, Right: 12},
            BorderWidth: 1,
            BorderColor: ui.Rule,
            BorderRadius: 4,
            BackgroundColor: ui.Field,
            area,
            axis
        }
    }

    private func Rectangle(path PathBuilder, x float64, y float64, w float64, h float64) {
        path.MoveTo(x, y).LineTo(x + w, y).LineTo(x + w, y + h).LineTo(x, y + h).Close()
    }

    private func Offset(height uint64) float64 -> plotWidth * Math.Clamp(
        (float64(height) - float64(low)) / span,
        0.0,
        1.0
    )

    private func HeightAt(x float64) uint64 -> Math.Max(
        low + 1,
        low + uint64(Math.Round(Math.Clamp(x / Math.Max(1.0, plotWidth), 0.0, 1.0) * span))
    )

    private func Select(start uint64, end uint64) {
        from = start
        to = end
        hover = -1
        Rebuild()
    }

    private func Shade(left float64, right float64) Blob -> Container{
        Position: PositionType.Absolute,
        Left: left,
        Width: Math.Max(0.0, right - left),
        Top: 0,
        Bottom: 0,
        BackgroundColor: current.Ui.Black.WithAlpha(0.88),
        HitTestSelf: false
    }

    private func Handle(x float64, height float64) Blob -> Container{
        Position: PositionType.Absolute,
        Left: x - 4,
        Width: 8,
        Top: 0,
        Bottom: 0,
        AlignItems: AlignItems.Center,
        HitTestSelf: false,
        Container{Width: 2, Height: height, BackgroundColor: current.Ui.Lime},
        Container{
            Position: PositionType.Absolute,
            Top: height / 2 - 11,
            Width: 8,
            Height: 22,
            BorderRadius: 2,
            BackgroundColor: current.Ui.Lime
        }
    }

    private func Tip(
        input HistoryInput,
        all List[HistoryRow],
        column int32,
        size float64,
        step float64,
        width float64
    ) Blob {
        let ui = input.Ui
        let start = low + 1 + uint64(column * size)
        let end = Math.Max(start, low + uint64((column + 1) * size))
        let inside = all.Where((row HistoryRow) -> row.Height >= start && row.Height <= end).ToArray()
        let tip = Container{
            Position: PositionType.Absolute,
            Top: 4,
            Gap: 3,
            Padding: Edges{Top: 8, Bottom: 8, Left: 10, Right: 10},
            BackgroundColor: ui.Raised,
            BorderWidth: 1,
            BorderColor: ui.Edge,
            BorderRadius: 4,
            ZIndex: 3,
            HitTestSelf: false,
            Label(ui, start == end ? Count(start): Count(start) + " – " + Count(end), 12, ui.Ink, "")
        }
        if inside.Length > 0 && inside[0].Time > 0 {
            tip.Add(Label(ui, Moment(inside[0].Time), 12, ui.Dim, ""))
        }
        for category in[]HistoryRowKind{HistoryRowKind.Received, HistoryRowKind.Mined, HistoryRowKind.Sent} {
            let rows = inside.Where((row HistoryRow) -> row.Kind == category).ToArray()
            if rows.Length > 0 {
                let total = rows.Aggregate(0UL, (sum uint64, row HistoryRow) -> sum + row.Amount)
                tip.Add(
                    Label(
                        ui,
                        (category == HistoryRowKind.Sent ? "−": "+") + Amount(ui.Privacy, total),
                        12,
                        Tint(category),
                        ""
                    )
                )
            }
        }
        let x = (column + 0.5) * step
        if x > width / 2 {
            tip.Right = width - x + 12
        } else {
            tip.Left = x + 12
        }
        return tip
    }

    private func Summary(input HistoryInput) Blob {
        let ui = input.Ui
        var received = 0UL
        var sent = 0UL
        var fees = 0UL
        var mined = 0UL
        for row in shown {
            if row.Kind == HistoryRowKind.Received {
                received += row.Amount
            } else if row.Kind == HistoryRowKind.Mined {
                mined += row.Amount
            } else {
                sent += row.Self ? 0UL: row.Amount
                fees += row.Fee
            }
        }
        let gain = received + mined
        let loss = sent + fees
        let net = (gain >= loss ? "+": "−") + Amount(ui.Privacy, gain >= loss ? gain - loss: loss - gain)
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: input.Width < 1000 ? 14.0: 22.0,
            FlexShrink: 0,
            Padding: Edges{Top: 2, Left: 2, Right: 2},
            Figure(ui, "in", received > 0 ? "+" + Amount(ui.Privacy, received): "0", ui.Mint, 14, compact: true),
            Figure(ui, "out", sent > 0 ? "−" + Amount(ui.Privacy, sent): "0", ui.Pink, 14, compact: true),
            Figure(ui, "fees", fees > 0 ? Amount(ui.Privacy, fees): "0", ui.Body, 14, compact: true),
            Figure(ui, "mined", mined > 0 ? "+" + Amount(ui.Privacy, mined): "0", ui.Lime, 14, compact: true),
            Figure(ui, "net", net, ui.Ink, input.Width < 1000 ? 16.0: 18.0, compact: true)
        }
    }

    private func Tint(category HistoryRowKind) Color -> switch category {
        case HistoryRowKind.Received: current.Ui.Mint
        case HistoryRowKind.Mined: current.Ui.Lime
        case HistoryRowKind.Pending: current.Ui.Orange
        case HistoryRowKind.Sent: current.Ui.Pink
    }

    private func Moment(seconds int64) string -> DateTimeOffset
        .FromUnixTimeSeconds(seconds)
        .ToLocalTime()
        .ToString("MM-dd HH:mm", CultureInfo.InvariantCulture)

    private func Short(value string) string -> value.Length > 16 ? value.Substring(0, 8) + "…" + value.Substring(
        value.Length - 8
    ): value

    private func Row(row HistoryRow) Blob {
        let ui = current.Ui
        let compact = row.Width < 1000
        let pending = row.Height == 0
        let mature = !pending && row.Depth > row.Need
        let lit = pending ? 0: int32(Math.Min(10UL, (row.Depth - 1) * 10 / row.Need))
        let segments = Container{FlexDirection: FlexDirection.Row, Gap: compact ? 2.0: 3.0}
        for index in 0 ... 10 {
            segments.Add(
                Container{
                    Width: compact ? 9.0: 12.0,
                    Height: compact ? 5.0: 6.0,
                    BorderRadius: 1,
                    BackgroundColor: index >= lit ? ui.Rule: mature ? Color.Parse("#558000"): ui.Orange
                }
            )
        }
        let depth = if pending {
            ui.Strings.Get(row.State == "not_found" ? "not found": "pending")
        } else if mature {
            row.Depth >= 10000 ? (row.Depth / 1000).ToString() + "k": Count(row.Depth)
        } else {
            row.Depth.ToString() + "/" + row.Need.ToString()
        }
        let recipient = row.Recipients.FirstOrDefault()
        let note = row
            .Memo
            .Length > 0 ? row.Memo: row
            .Recipients
            .Length > 1 ? Short(recipient?.Address ?? ""): Short(row.TxId)
        let preview = Hidden(ui.Privacy, SafeText(note, 512))
        let sign = row.Kind == HistoryRowKind.Received || row.Kind == HistoryRowKind.Mined ? "+": "−"
        let notes = Container{
            Padding: Edges{Left: 6},
            FlexDirection: FlexDirection.Row,
            MinWidth: 0,
            Overflow: Overflow.Hidden,
            Gap: 6,
            Grow(
                Label(
                    ui,
                    (row.Self ? ui.Strings.Get("To self") + " · ": "") + preview,
                    12,
                    row.Memo.Length > 0 ? ui.Ink: ui.Dim,
                    ""
                )
            )
        }
        if row.Recipients.Length > 1 {
            notes.Add(Label(ui, "+" + (row.Recipients.Length - 1).ToString(), 12, ui.Dim, ""))
        }
        let line = Goo
            .Button{
            Height: row.Width >= 1700 ? 42.0: 38.0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 12,
            Padding: Edges{Left: 10, Right: 10},
            BorderWidth: Edges{Bottom: 1},
            BorderColor: row.Open ? Color.Transparent: ui.Rule,
            BackgroundColor: row.Open ? ui.Expanded: Color.Transparent,
            Hover: Style{BackgroundColor: Color.Parse("#0c0c0c")},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get(
                    row.Self ? "To self": switch row.Kind {
                        case HistoryRowKind.Received: "received"
                        case HistoryRowKind.Mined: "mined"
                        case HistoryRowKind.Sent: "sent"
                        case HistoryRowKind.Pending: "pending"
                    }
                ) +
                    " " +
                    sign +
                    Amount(ui.Privacy, row.Amount) +
                    " " +
                    preview +
                    " " +
                    depth,
                Expanded: row.Open
            },
            OnClick: () -> {
                expanded = row.Open ? "": row.Key
                tab = "details"
                proofRecipient = 0
                proofFor = ""
                revision++
                Rebuild()
            },
            OnPointerEnter: (event PointerEvent) -> {
                marked = row.Height
                Rebuild()
            },
            OnPointerLeave: (event PointerEvent) -> {
                if marked == row.Height {
                    marked = 0
                    Rebuild()
                }
            },
            MaterialIcons.Create(
                row.Self ? "sync": switch row.Kind {
                    case HistoryRowKind.Received: "south_west"
                    case HistoryRowKind.Mined: "diamond"
                    case HistoryRowKind.Pending: "schedule"
                    case HistoryRowKind.Sent: "north_east"
                },
                16,
                Tint(row.Kind)
            ),
            Container{
                Width: compact ? 112.0: 128.0,
                FlexShrink: 0,
                AlignItems: AlignItems.FlexEnd,
                Label(
                    ui,
                    sign + Amount(ui.Privacy, row.Amount),
                    14,
                    row.Kind == HistoryRowKind.Pending ? ui.Pink: Tint(row.Kind),
                    ""
                )
            },
            Grow(notes),
            Container{
                Width: compact ? 170.0: 212.0,
                FlexShrink: 0,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                segments,
                Container{Width: 52, Label(ui, depth, 12, mature ? ui.Body: ui.Orange, "")}
            }
        }
        WidgetKeyBindings.BindActivation(line)
        if row.Width >= 1100 {
            line.Children.Add(
                Container{
                    Width: 64,
                    FlexShrink: 0,
                    AlignItems: AlignItems.FlexEnd,
                    Label(ui, pending ? "": Count(row.Height), 12, ui.Body, "")
                }
            )
        }
        line.Children.Add(
            Container{
                Width: compact ? 84.0: 88.0,
                FlexShrink: 0,
                AlignItems: AlignItems.FlexEnd,
                Label(ui, row.Time > 0 ? Moment(row.Time): "", 12, ui.Body, "")
            }
        )
        line.Children.Add(
            MaterialIcons.Create(row.Open ? "expand_more": "chevron_right", 14, row.Open ? ui.Ink: ui.Dim)
        )
        if !row.Open {
            return line
        }
        return Container{FlexShrink: 0, line, Details(row)}
    }

    private func Details(row HistoryRow) Blob {
        let ui = current.Ui
        let recipients = ProofRecipients(row)
        let recipient = recipients.ElementAtOrDefault(proofRecipient)
        let panel = Container{
            Gap: 12,
            Padding: Edges{Top: 4, Bottom: 14, Left: row.Width < 1000 ? 16.0: 38.0, Right: 16},
            BackgroundColor: ui.Expanded,
            BorderWidth: Edges{Bottom: 1},
            BorderColor: ui.Rule
        }
        if row.Kind == HistoryRowKind.Sent {
            let tabs = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 10,
                Segments(
                    "tabs",
                    "Transaction",
                    recipients.Length > 0 ? []string{"details", "proof"}: []string{"details"},
                    tab,
                    id -> {
                        tab = id
                        revision++
                        if id == "proof" && proofFor != row.TxId {
                            Prove(row)
                        }
                        Rebuild()
                    }
                ),
                Container{FlexGrow: 1},
                IconButton{
                    Icon: MaterialIcons.Create("visibility", 16, ui.Body),
                    AccessibilityName: ui.Strings.Get("observer view"),
                    OnClick: () -> {
                        observed = row.TxId
                        Rebuild()
                    }
                }.Build()
            }
            if tab == "proof" {
                tabs.Add(
                    Info(
                        "proof",
                        "A proof shows that this address got this amount from you. Anyone can check it in Tools. Your keys stay private.",
                        current
                    )
                )
            }
            panel.Add(tabs)
            if tab == "proof" && recipients.Length > 0 {
                if recipients.Length > 1 {
                    panel.Add(
                        Cell.Mount[ToggleGroupInput, ToggleGroup](
                            "proof-recipient",
                            ToggleGroupInput{
                                Items: recipients.Select(
                                    (entry WalletRecipient, index int32) -> ToggleOption{
                                        Id: index.ToString(),
                                        Label: ui.Strings.Get("Recipient") + " " + (index + 1).ToString()
                                    }
                                )
                                    .ToArray(),
                                SelectedIds: []string{proofRecipient.ToString()},
                                AccessibilityName: ui.Strings.Get("recipient"),
                                OnChange: ids -> {
                                    if ids.Length > 0 {
                                        proofRecipient = Int32.Parse(ids[0], CultureInfo.InvariantCulture)
                                        Prove(row)
                                        revision++
                                        Rebuild()
                                    }
                                }
                            }
                        )
                    )
                }
                panel.Add(
                    Block(
                        "proof key",
                        proofFor == row.TxId ? proofKey: "",
                        Grouped(proofFor == row.TxId ? proofKey: ""),
                        ui.Ink
                    )
                )
                panel.Add(Block("transaction", row.TxId, Grouped(row.TxId), ui.Body))
                panel.Add(Block("recipient", recipient?.Address ?? "", Spaced(recipient?.Address ?? "", 10), ui.Body))
                let ready = proofFor == row.TxId && proofKey.Length > 0
                let actions = Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 10,
                    if ready {
                        Status(
                            ui,
                            ui.Strings.Get(proofValid ? "valid": "invalid"),
                            proofValid ? ui.Lime: ui.Pink,
                            proofValid ? "check": "close"
                        )
                    } else {
                        Container{}
                    },
                    Figure(
                        ui,
                        "amount",
                        Amount(ui.Privacy, recipient?.Amount ?? 0UL) + " BNT",
                        ui.Ink,
                        14,
                        compact: true
                    ),
                    Container{FlexGrow: 1},
                    Button(ui, "save", () -> SaveProof(row), !ready),
                    Button(ui, "copy proof", () -> ui.Actions.Copy(ProofText(row), 120000), !ready, true)
                }
                panel.Add(actions)
                return panel
            }
        }
        let values = Container{FlexDirection: FlexDirection.Row, FlexWrap: FlexWrap.Wrap, RowGap: 8, ColumnGap: 26}
        values.Add(
            Figure(
                ui,
                "height",
                row.Height > 0 ? Count(row.Height): ui.Strings.Get("pending"),
                row.Height > 0 ? ui.Ink: ui.Orange,
                13,
                compact: true
            )
        )
        if row.Time > 0 {
            values.Add(Figure(ui, "time", Time(row.Time), ui.Ink, 13, compact: true))
        }
        if row.Kind == HistoryRowKind.Sent || row.Kind == HistoryRowKind.Pending {
            values.Add(Figure(ui, "fee", Amount(ui.Privacy, row.Fee), ui.Ink, 13, compact: true))
            if row.Recipients.Length == 1 {
                let address = row.Recipients[0].Address
                values.Add(
                    Figure(
                        ui,
                        "recipient",
                        Hidden(
                            ui.Privacy,
                            address.Length > 14 ? address.Substring(0, 8) + "…" + address.Substring(
                                address.Length - 6
                            ): address
                        ),
                        ui.Ink,
                        13,
                        compact: true
                    )
                )
            }
        }
        if row.Kind == HistoryRowKind.Mined && row.Depth <= 60 {
            values.Add(Figure(ui, "spendable at", Count(row.Height + 60), ui.Orange, 13, compact: true))
        }
        if row.Kind == HistoryRowKind.Received {
            values.Add(
                Figure(
                    ui,
                    "output",
                    row.Outputs.Length > 0 ? row.Outputs: "#" + row.Index.ToString(),
                    ui.Ink,
                    13,
                    compact: true
                )
            )
        }
        panel.Add(values)
        if row.Memo.Length > 0 && row.Recipients.Length <= 1 && !row.Self {
            panel.Add(MemoSection(row, row.Memo))
        }
        if row.Self || row.Recipients.Length > 1 {
            for index in 0 ... row.Recipients.Length {
                let entry = row.Recipients[index]
                let details = Container{
                    Gap: 4,
                    if row.Self {
                        Figure(ui, "output", "#" + index.ToString(), ui.Ink, 13, compact: true)
                    } else {
                        Block("recipient", entry.Address, Spaced(entry.Address, 10), ui.Body)
                    },
                    Figure(ui, "amount", Amount(ui.Privacy, entry.Amount) + " BNT", ui.Ink, 13, compact: true)
                }
                if entry.Memo.Length > 0 {
                    details.Add(MemoSection(row, entry.Memo))
                }
                panel.Add(details)
            }
        }
        panel.Add(Block("transaction", row.TxId, Grouped(row.TxId), ui.Body))
        return panel
    }

    private func MemoSection(row HistoryRow, memo string) Blob {
        let ui = current.Ui
        let section = Container{
            Gap: 3,
            MinWidth: 0,
            Overflow: Overflow.Hidden,
            Label(ui, ui.Strings.Get("memo"), 12, ui.Dim, "")
        }
        if current.Session.Messages.Lookup(row.TxId) != nil {
            let preview = Hidden(ui.Privacy, MessagesPage.Preview(SafeText(memo, 512)))
            let label = Label(ui, preview, 13, ui.Ink, "")
            let button = Goo
                .Button{
                MinWidth: 0,
                Padding: 8,
                BorderRadius: 6,
                BackgroundColor: ui.Rule,
                Hover: Style{BackgroundColor: ui.Edge},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: preview},
                OnClick: () -> current.OnMessage(row.TxId),
                label
            }
            WidgetKeyBindings.BindActivation(button)
            section.Add(button)
        } else {
            section.Add(
                Container{
                    MinWidth: 0,
                    MaxHeight: 100,
                    OverflowY: Overflow.Scroll,
                    ScrollbarY: Theme.Read().Scrollbar,
                    Text{
                        Content: Hidden(ui.Privacy, SafeText(memo, 512)),
                        FontFamily: ui.Font,
                        FontSize: 13,
                        Color: ui.Ink,
                        TextWrap: TextWrap.Wrap,
                        MinWidth: 0
                    }
                }
            )
        }
        return section
    }

    private func Block(label string, value string, text string, color Color) Blob {
        let ui = current.Ui
        return Container{
            Gap: 3,
            MinWidth: 0,
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 6,
                Label(ui, ui.Strings.Get(label), 12, ui.Dim, ""),
                IconButton{
                    Icon: MaterialIcons.Create("content_copy", 14, ui.Dim),
                    AccessibilityName: ui.Strings.Get("Copy") + " " + ui.Strings.Get(label),
                    Disabled: value.Length == 0,
                    OnClick: () -> ui.Actions.Copy(value, 120000)
                }.Build()
            },
            Text{
                Content: Hidden(ui.Privacy, text),
                FontFamily: ui.Font,
                FontSize: 13,
                LineHeight: 1.5,
                Color: color,
                TextWrap: TextWrap.Wrap
            }
        }
    }

    private func Spaced(value string, size int32) string {
        let parts = List[string]()
        var start = 0
        while start < value.Length {
            parts.Add(value.Substring(start, Math.Min(size, value.Length - start)))
            start += size
        }
        return String.Join(" ", parts)
    }

    private func Segments(key string, label string, ids[]string, selected string, chosen Action[string]) Blob {
        let ui = current.Ui
        return Cell.Mount[ToggleGroupInput, ToggleGroup](
            key,
            ToggleGroupInput{
                Items: ids.Select((id string) -> ToggleOption{Id: id, Label: ui.Strings.Get(id)}).ToArray(),
                SelectedIds: []string{selected},
                AccessibilityName: ui.Strings.Get(label),
                CreateRoot: (group ToggleGroupInput, root Container) -> Container{
                    BorderWidth: 1,
                    BorderColor: ui.Edge,
                    BorderRadius: 4,
                    Overflow: Overflow.Hidden,
                    FlexShrink: 0
                },
                CreateItem: (group ToggleGroupInput, item ToggleOption, button Button) -> {
                    let active = item.Id == selected
                    button.MinHeight = 28
                    button.Height = 28
                    button.Padding = Edges{Left: 10, Right: 10}
                    button.BorderWidth = 0
                    button.BorderRadius = 0
                    button.BoxShadow = BoxShadow{}
                    button.BackgroundColor = active ? ui.Lime: Color.Transparent
                    button.Color = active ? ui.Black: ui.Body
                    button.Hover = Style{BackgroundColor: active ? ui.Lime: ui.Rule}
                    button.Children.Clear()
                    button.Children.Add(Label(ui, ui.Strings.Get(item.Id), 12, active ? ui.Black: ui.Body, ""))
                    return button
                },
                OnChange: ids -> {
                    if ids.Length > 0 {
                        chosen(ids[0])
                    }
                }
            }
        )
    }

    private func Info(topic string, text string, input HistoryInput) Blob -> Cell.Mount[InfoTipInput, InfoTip](
        "info-" + topic,
        InfoTipInput{Ui: input.Ui, Topic: topic, Lines: []string{text}, Language: input.Language, Width: 280}
    )

    private func Export(input HistoryInput) Blob {
        let ui = input.Ui
        let button = Goo
            .Button{
            Handle: exportAnchor,
            Height: 30,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            Padding: Edges{Left: 12, Right: 12},
            BorderWidth: 1,
            BorderColor: exporting ? ui.ExportEdge: ui.Edge,
            BorderRadius: 4,
            BackgroundColor: exporting ? ui.FaintRule: ui.Raised,
            Hover: Style{BorderColor: ui.ExportEdge},
            Focus: Theme.Read().FocusStyle,
            Disabled: shown.Length == 0,
            Opacity: shown.Length == 0 ? 0.4: 1.0,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get("export"),
                HasPopup: true,
                Expanded: exporting
            },
            OnClick: () -> {
                exporting = !exporting
                Rebuild()
            },
            MaterialIcons.Create("download", 16, ui.Ink),
            Label(ui, ui.Strings.Get("export"), 12, ui.Ink, "")
        }
        WidgetKeyBindings.BindActivation(button)
        let shownRange = to > 0 ? Count(from) + " – " + Count(to): ui.Strings.Get(period)
        let content = Container{
            Gap: 12,
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                Label(ui, ui.Strings.Get("export"), 14, ui.Ink, ""),
                Label(ui, shownRange, 12, ui.Dim, ""),
                Container{FlexGrow: 1},
                Info(
                    "export",
                    "The file is not encrypted. It holds amounts, heights, times and transaction IDs.",
                    input
                )
            },
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Label(ui, ui.Strings.Get("format"), 12, ui.Dim, ""),
                Segments(
                    "format",
                    "format",
                    []string{"csv", "json"},
                    format,
                    id -> {
                        format = id
                        Rebuild()
                    }
                )
            },
            Checkbox{
                State: memos ? AccessibilityChecked.True: AccessibilityChecked.False,
                Label: ui.Strings.Get("memos"),
                LabelFontSize: 12,
                Size: 14,
                BorderRadius: 2,
                OnChange: state -> {
                    memos = state == AccessibilityChecked.True
                    Rebuild()
                }
            }.Build(),
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Figure(ui, "rows", shown.Length.ToString(), ui.Ink, 14, compact: true),
                Button(ui, "save", () -> SaveExport(input), shown.Length == 0, true)
            }
        }
        return Container{
            FlexShrink: 0,
            button,
            Cell.Mount[PopoverInput, Popover](
                "export",
                PopoverInput{
                    Open: exporting,
                    Anchor: exportAnchor,
                    Placement: PopoverPlacement.BottomEnd,
                    Gap: 8,
                    Width: 300,
                    Padding: 14,
                    BackgroundColor: ui.Raised,
                    BorderColor: ui.Edge,
                    Content: content,
                    Role: AccessibilityRole.Dialog,
                    AccessibilityName: ui.Strings.Get("export"),
                    OnDismiss: reason -> {
                        exporting = false
                        Rebuild()
                    }
                }
            )
        }
    }

    private func RequestTimes(heights IEnumerable[uint64]) {
        if fetching {
            return
        }
        if failedSnapshot != nil && failedSnapshot != current.Snapshot {
            requested.IntersectWith(times.Keys)
            failedSnapshot = nil
        }
        let missing = heights
            .Where((height uint64) -> height > 0 && !requested.Contains(height))
            .Distinct()
            .Take(16)
            .ToArray()
        guard let window = current.Window else {
            return
        }
        if missing.Length == 0 {
            return
        }
        for height in missing {
            requested.Add(height)
        }
        fetching = true
        current.Ui.Actions.Background(ct -> FetchTimes(window, current.Session.History, current.Snapshot, missing, ct))
    }

    private async func FetchTimes(
        window Window,
        history HistoryService,
        snapshot WalletSnapshot,
        heights[]uint64,
        ct CancellationToken
    ) {
        var fetched = Dictionary[uint64, int64]()
        var failed = false
        try {
            fetched = await history.BlockTimesAsync(heights, ct)
        } catch (error Exception) {
            failed = true
        } finally {
            window.TryPost(
                () -> {
                    for entry in fetched {
                        times[entry.Key] = entry.Value
                    }
                    fetching = false
                    if failed {
                        failedSnapshot = snapshot
                    }
                    if fetched.Count > 0 {
                        Rebuild()
                    }
                }
            )
        }
    }

    private func LoadMore() {
        guard let window = current.Window else {
            return
        }
        if loading {
            return
        }
        loading = true
        let history = current.Session.History
        current.Ui.Actions.Background(ct -> LoadMoreAsync(window, history, ct))
    }

    private async func LoadMoreAsync(window Window, history HistoryService, ct CancellationToken) {
        try {
            await history.LoadMoreAsync(ct)
        } finally {
            window.TryPost(
                () -> {
                    loading = false
                    Rebuild()
                }
            )
        }
    }

    private async func ResolvePeriod(window Window, input HistoryInput, selected string, ct CancellationToken) {
        var start uint64
        var failed = false
        try {
            start = await input.Session.History.PeriodStartAsync(selected, input.Tip, ct)
        } catch (error Exception) {
            failed = true
        } finally {
            window.TryPost(
                () -> {
                    resolving = false
                    if failed {
                        failedSnapshot = input.Snapshot
                    } else {
                        resolvedPeriod = selected
                        resolvedTip = input.Tip
                        periodStart = start
                        Rebuild()
                    }
                }
            )
        }
    }

    private func ProofRecipients(row HistoryRow)[]WalletRecipient -> row
        .Recipients
        .Where((recipient WalletRecipient) -> recipient.Address != current.Snapshot.Address)
        .GroupBy((recipient WalletRecipient) -> recipient.Address)
        .Select(
        group -> WalletRecipient{
            Address: group.Key,
            Amount: group.Aggregate(0UL, (total uint64, recipient WalletRecipient) -> total + recipient.Amount)
        }
    )
        .ToArray()

    private func Prove(row HistoryRow) {
        let proofs = current.Session.Proofs
        let selected = proofRecipient
        let recipients = ProofRecipients(row)
        if selected >= recipients.Length {
            return
        }
        let recipient = recipients[selected]
        let amount = WalletAmount.Format(recipient.Amount)
        var prove Task[string]
        proofFor = row.TxId
        proofKey = ""
        proofValid = false
        current
            .Ui
            .Actions
            .Run(
            ct -> {
                prove = proofs.ProveAsync(row.TxId, ct)
                return prove
            },
            () -> {
                if proofFor != row.TxId || proofRecipient != selected {
                    return
                }
                var verify Task[bool]
                current
                    .Ui
                    .Actions
                    .Run(
                    ct -> {
                        verify = proofs.VerifyProofAsync(row.TxId, prove.Result, recipient.Address, amount, ct)
                        return verify
                    },
                    () -> {
                        if proofFor != row.TxId || proofRecipient != selected {
                            return
                        }
                        proofKey = prove.Result
                        proofValid = verify.Result
                        revision++
                        Rebuild()
                    }
                )
                revision++
                Rebuild()
            }
        )
    }

    private func ProofText(row HistoryRow) string {
        let strings = current.Ui.Strings
        let recipient = ProofRecipients(row).ElementAtOrDefault(proofRecipient)
        return strings.Get("transaction") + " " + row.TxId + "\n" + strings.Get("proof key") +
            " " +
            proofKey +
            "\n" +
            strings.Get("recipient") + " " + (recipient?.Address ?? "") + "\n" + strings.Get("amount") +
            " " +
            WalletAmount.Format(recipient?.Amount ?? 0UL) + "\n"
    }

    private func SaveProof(row HistoryRow) {
        if let window = current.Window {
            let choice = Choose(window, "proof-" + row.TxId.Substring(0, 8) + ".txt")
            let text = ProofText(row)
            current.Ui.Actions.Run(ct -> WriteText(choice, text, ct))
        }
    }

    private func SaveExport(input HistoryInput) {
        exporting = false
        Rebuild()
        if let window = input.Window {
            let choice = Choose(window, "history." + format)
            let rows = Collect(input, true).ToArray()
            input
                .Ui
                .Actions
                .Run(
                ct -> WriteExport(
                    choice,
                    input.Session,
                    rows,
                    input.Tip,
                    Dictionary[uint64, int64](times),
                    memos,
                    format,
                    period,
                    from,
                    to,
                    ct
                )
            )
        }
    }

    private async func WriteExport(
        choice Task[string],
        session WalletSession,
        all[]HistoryRow,
        tip uint64,
        known Dictionary[uint64, int64],
        withMemos bool,
        suffix string,
        selectedPeriod string,
        selectedFrom uint64,
        selectedTo uint64,
        ct CancellationToken
    ) {
        let path = await choice.WaitAsync(ct)
        if path.Length == 0 {
            return
        }
        let cutoff = await session.History.PeriodStartAsync(selectedPeriod, tip, ct)
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
        let fetched = await session.History.BlockTimesAsync(missing, ct)
        for entry in fetched {
            known[entry.Key] = entry.Value
        }
        await Write(path, Table(rows, known, withMemos, suffix == "json"), ct)
    }

    private func Table(rows[]HistoryRow, known Dictionary[uint64, int64], withMemos bool, json bool) string {
        let output = MemoryStream()
        using let writer = Utf8JsonWriter(output, JsonWriterOptions{Indented: true})
        let text = StringBuilder(
            withMemos ? "type,amount,fee,height,time,txid,memo\n": "type,amount,fee,height,time,txid\n"
        )
        writer.WriteStartArray()
        for row in rows {
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
            writer.WriteStartObject()
            writer.WriteString("type", kind)
            writer.WriteString("amount", amount)
            writer.WriteString("fee", fee)
            writer.WriteNumber("height", row.Height)
            writer.WriteString("time", time)
            writer.WriteString("txid", row.TxId)
            text.Append(kind + "," + amount + "," + fee + "," + row.Height.ToString() + "," + time + "," + row.TxId)
            if withMemos {
                writer.WriteString("memo", row.Memo)
                let memo = "=+-@\t\r".Contains(row.Memo.FirstOrDefault()) ? "'" + row.Memo: row.Memo
                text.Append(",\"" + memo.Replace("\"", "\"\"") + "\"")
            }
            writer.WriteEndObject()
            text.Append("\n")
        }
        writer.WriteEndArray()
        writer.Flush()
        return json ? Encoding.UTF8.GetString(output.ToArray()): text.ToString()
    }

    private async func WriteText(choice Task[string], text string, ct CancellationToken) {
        let path = await choice.WaitAsync(ct)
        if path.Length > 0 {
            await Write(path, text, ct)
        }
    }

    private async func Choose(window Window, name string) string {
        let result = await window.ShowFileDialogAsync(
            FileDialogKind.SaveFile,
            FileDialogOptions{
                Title: current.Ui.Strings.Get("save"),
                InitialPath: Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), name)
            }
        )
        if result.Status == FileDialogStatus.Success && result.Paths.Count > 0 {
            return result.Paths[0]
        }
        if result.Status != FileDialogStatus.Cancelled {
            throw WalletException("File dialog unavailable")
        }
        return ""
    }

    private func Write(path string, text string, ct CancellationToken) Task {
        let bytes = Encoding.UTF8.GetBytes(text)
        return PrivateFiles.WriteAtomic(path, stream -> stream.WriteAsync(bytes, ct).AsTask(), true, false)
    }
}
