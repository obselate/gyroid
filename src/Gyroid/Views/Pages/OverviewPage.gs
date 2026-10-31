package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.LayoutParts
import Gyroid.Components.NetworkParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Globalization
import System.Linq
import System.Threading

data struct OverviewInput {
    var Ui Presentation
    var Session WalletSession
    var Window Window?
    var Snapshot WalletSnapshot
    var Node NodeStatus
    var Contacts SortedDictionary[string, string]
    var Privacy bool
    var Height float64
    var Width float64
    var OnNavigate Action[AppPage]
    var OnUpgrade Action
}

data struct Arrival {
    var Kind string
    var Amount uint64
    var Source string
    var Confirmations uint64
    var Required uint64
    var Blocks uint64
    var TxId string
    var Height uint64
    var Self bool
}

data struct Activity {
    var Kind string
    var Amount uint64
    var Label string
    var Status string
    var Ready bool
    var Order uint64
    var Timestamp int64
}

class OverviewPage : Cell[OverviewInput] {
    private let hero ElementHandle = ElementHandle()
    private let strip ElementHandle = ElementHandle()
    private let infoAnchor ElementHandle = ElementHandle()
    private var heroWidth float64
    private var stripWidth float64
    private var hovering bool
    private var infoOpen bool
    private var peeking bool
    private var expanded string = ""
    private let fraction Color = Color.Parse("#588203")
    private let times Dictionary[uint64, int64] = Dictionary[uint64, int64]()
    private let requested HashSet[uint64] = HashSet[uint64]()
    private var fetching bool
    private var failedSnapshot WalletSnapshot? = nil

    private let networkPlot ElementHandle = ElementHandle()
    private var networkLoaded NodeStatus? = nil
    private var networkLoading bool
    init() {
        hero.MetricsChanged += _ -> if hero.BorderBox.Width != heroWidth {
            Rebuild()
        }
        strip.MetricsChanged += _ -> if strip.BorderBox.Width != stripWidth {
            Rebuild()
        }
        networkPlot.MetricsChanged += _ -> Rebuild()
    }

    protected override func Build(input OverviewInput) Blob {
        heroWidth = hero.BorderBox.Width
        stripWidth = strip.BorderBox.Width
        let snapshot = input.Snapshot
        let chain = snapshot.Balance?.ChainHeight ?? input.Node.Height
        RequestTimes(input)
        RequestNetwork(input)
        let arrivals = Arrivals(input, chain)
        let page = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, Gap: 12}
        if input.Node.UpgradeDate.Length > 0 {
            page.Add(Upgrade(input))
        }
        let top = Container{
            Height: Math.Clamp(Math.Min(input.Height * 0.32, input.Width * 0.09 + 151), 260, 352),
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            Gap: 16
        }
        let balance = Hero(input, arrivals)
        balance.Width = input.Width < 1200 ? 400.0: Percent(39)
        balance.FlexGrow = 0
        balance.FlexShrink = 0
        top.Add(balance)
        top.Add(Network(input))
        page.Add(top)
        page.Add(Recent(input, chain, arrivals))
        return page
    }

    private func RequestNetwork(input OverviewInput) {
        let blocks = input.Session.Node.Network.Blocks
        if blocks.Length > 0 &&
            blocks[blocks.Length - 1].Height == input
            .Node
            .Height &&
            blocks[blocks.Length - 1]
            .Hash
            .StartsWith(input.Node.BestHash, StringComparison.Ordinal) {
            return
        }
        if networkLoading || !input.Node.Running || networkLoaded == input.Node {
            return
        }
        guard let window = input.Window else {
            return
        }
        networkLoaded = input.Node
        networkLoading = true
        input.Ui.Actions.Background(ct -> LoadNetwork(input, window, ct))
    }

    private async func LoadNetwork(input OverviewInput, window Window, ct CancellationToken) {
        try {
            await input.Session.Node.ReadNetworkSummaryAsync(ct)
        } catch (error Exception) { } finally {
            window.TryPost(
                () -> {
                    networkLoading = false
                    Rebuild()
                }
            )
        }
    }

    private func Network(input OverviewInput) Blob {
        let ui = input.Ui
        let node = input.Node
        let report = input.Session.Node.Network
        let online = node.Running
        let size = input.Width < 1200 ? 20.0: 24.0
        let color = online ? ui.Ink: ui.Dim
        let card = WalletParts.Card(ui, input.Width < 1200 ? 16.0: 18.0, 10)
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.OnPointerDown = (event PointerEvent) -> if !event.IsFromInteractiveChild {
            input.OnNavigate(AppPage.Network)
        }
        let height = !online ? ui.Strings.Get("offline"): Count(node.Height)
        let sync = !online ? "": node.Syncing ? "/ " + Count(node.ChainHeight): ui.Strings.Get("synced")
        let age = Math.Max(0L, DateTimeOffset.Now.ToUnixTimeSeconds() - node.LastBlockTime)
        let last = node.LastBlockTime == 0 ? "-": String.Format(
            ui.Strings.Get(age < 3600 ? "{0}m ago": "{0}h ago"),
            age < 3600 ? age / 60: age / 3600
        )
        let first = Container{
            FlexDirection: FlexDirection.Row,
            Gap: 10,
            NetworkParts.Figure(
                ui,
                "height",
                height,
                sync,
                size,
                !online ? ui.Pink: node.Syncing ? ui.Orange: ui.Lime,
                1.85
            ),
            NetworkParts.Figure(ui, "peers", Count(node.Peers), "", size, color),
            NetworkParts.Figure(ui, "last block", last, "", size, online && age > 900 ? ui.Orange: color)
        }
        card.Add(first)
        let second = Container{
            FlexDirection: FlexDirection.Row,
            Gap: 10,
            NetworkParts.Figure(ui, "hashrate", Rate(report.Hashrate), Unit(report.Hashrate), size, color, 1.85),
            NetworkParts.Figure(ui, "difficulty", Compact(report.Difficulty), "", size, color),
            NetworkParts.Figure(
                ui,
                "mempool",
                Count(node.Mempool),
                ui.Strings.Get("tx") + " · " + (node.MempoolBytes / 1000.0).ToString(
                    "0.0",
                    CultureInfo.InvariantCulture
                ) +
                    " KB",
                size,
                color
            )
        }
        card.Add(second)
        card.Add(NetworkParts.TimeChart(ui, report.Blocks, networkPlot, 0, _ -> { }, true, !online))
        let blocks = report.Blocks
        let count = blocks.Length - 1
        let average = count > 0 ? Duration(
            (blocks[blocks.Length - 1].Timestamp - blocks[blocks.Length - count - 1].Timestamp) / count
        ): "-"
        card.Add(
            WalletParts.Header(
                Label(ui, ui.Strings.Get("block time") + " " + average, 12, color, ""),
                8,
                Link(ui, "network", () -> input.OnNavigate(AppPage.Network))
            )
        )
        return card
    }

    private func RequestTimes(input OverviewInput) {
        if fetching {
            return
        }
        if failedSnapshot != nil && failedSnapshot != input.Snapshot {
            requested.IntersectWith(times.Keys)
            failedSnapshot = nil
        }
        guard let window = input.Window else {
            return
        }
        let missing = input
            .Snapshot
            .History
            .Take(50)
            .Select((output WalletOutput) -> output.BlockHeight)
            .Where((height uint64) -> height > 0 && !requested.Contains(height))
            .Distinct()
            .ToArray()
        if missing.Length == 0 {
            return
        }
        for height in missing {
            requested.Add(height)
        }
        fetching = true
        input.Ui.Actions.Background(ct -> FetchTimes(window, input.Session.History, input.Snapshot, missing, ct))
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

    private func Fixed(units uint64) string ->
    (units / 100000000).ToString(CultureInfo.InvariantCulture) + "." + (units % 100000000 / 10000).ToString(
        "D4",
        CultureInfo.InvariantCulture
    )

    private func Wait(input OverviewInput, blocks uint64) string {
        let minutes = blocks * 5
        return if minutes < 60 {
            String.Format(input.Ui.Strings.Get("~{0}m"), minutes)
        } else if minutes % 60 == 0 {
            String.Format(input.Ui.Strings.Get("~{0}h"), minutes / 60)
        } else {
            String.Format(input.Ui.Strings.Get("~{0}h{1}m"), minutes / 60, minutes % 60)
        }
    }

    private func Short(txid string) string -> if txid.Length > 8 {
        "tx " + txid.Substring(0, 4) + "…" + txid.Substring(txid.Length - 4)
    } else {
        "tx " + txid
    }

    private func Contact(input OverviewInput, send WalletSend?) string {
        guard let value = send else {
            return ""
        }
        let memo = value
            .Recipients
            .Select((recipient WalletRecipient) -> recipient.Memo)
            .FirstOrDefault((text string) -> text.Length > 0) ??
            ""
        if input.Session.Messages.Lookup(value.TxId) != nil {
            return memo
        }
        for (name, destination) in input.Contacts {
            if value.Recipients.Any((recipient WalletRecipient) -> recipient.Address == destination) {
                return name
            }
        }
        return memo
    }

    private func Change(input OverviewInput, send WalletSend?) string {
        let name = Contact(input, send)
        return input.Ui.Strings.Get("change") + if name.Length > 0 {
            " · " + name
        } else {
            ""
        }
    }

    private func Arrivals(input OverviewInput, chain uint64) List[Arrival] {
        let ui = input.Ui
        let arrivals = List[Arrival]()
        guard let balance = input.Snapshot.Balance else {
            return arrivals
        }
        var listed uint64 = 0
        for output in input.Session.History.Outputs {
            let required = output.Coinbase ? uint64(60): uint64(10)
            let confirmations = chain > output.BlockHeight ? chain - output.BlockHeight: uint64(0)
            if output.Spent || output.BlockHeight == 0 || confirmations >= required {
                continue
            }
            listed += output.Amount
            arrivals.Add(
                Arrival{
                    Kind: output.Coinbase ? "mined": "in",
                    Self: input
                        .Snapshot
                        .Sends
                        .Any(send -> send.TxId == output.TxId && send.IsSelf(input.Snapshot.Address)),
                    Amount: output.Amount,
                    Source: if output.Coinbase {
                        ui.Strings.Get("mined") + " · " + ui.Strings.Get("block") + " " + Count(output.BlockHeight)
                    } else if output.Memo.Length > 0 {
                        output.Memo
                    } else {
                        Short(output.TxId)
                    },
                    Confirmations: confirmations + 1,
                    Required: required,
                    Blocks: required - confirmations,
                    TxId: output.TxId,
                    Height: output.BlockHeight
                }
            )
        }
        let confirming = (balance.Pending ?? uint64(0)) - balance.Unconfirmed
        let recent WalletSend? = input
            .Snapshot
            .Sends
            .FirstOrDefault((item WalletSend) -> item.Status == "confirmed" && item.Confirmations < 10)
        if let send = recent && confirming > listed {
            arrivals.Add(
                Arrival{
                    Kind: "change",
                    Self: send.IsSelf(input.Snapshot.Address),
                    Amount: confirming - listed,
                    Source: Change(input, send),
                    Confirmations: send.Confirmations,
                    Required: 10,
                    Blocks: 10 - send.Confirmations,
                    TxId: ""
                }
            )
        }
        let pending = input.Snapshot.Sends.FirstOrDefault((item WalletSend) -> item.Status == "mempool")
        if balance.Unconfirmed > 0 {
            arrivals.Add(
                Arrival{
                    Kind: "pool",
                    Self: pending?.IsSelf(input.Snapshot.Address) ?? false,
                    Amount: balance.Unconfirmed,
                    Source: Change(input, pending),
                    Required: 10,
                    Blocks: 11,
                    TxId: ""
                }
            )
        }
        arrivals.Sort((a Arrival, b Arrival) -> a.Blocks.CompareTo(b.Blocks))
        return arrivals
    }

    private func Number(ui Presentation, masked bool, text string, color Color, fraction Color) Blob {
        if masked {
            return Label(ui, "••••••••", 14, fraction, "")
        }
        let point = text.IndexOf('.')
        return Text{
            Content: text,
            StyleRanges: []TextStyleRange{
                TextStyleRange(TextRange(point, text.Length - point), Style{Color: fraction})
            },
            FontSize: 14,
            Color: color,
            TextWrap: TextWrap.NoWrap,
            FlexShrink: 0
        }
    }

    private func Link(ui Presentation, label string, action Action) Blob {
        let button = Goo
            .Button{
            FlexShrink: 0,
            BorderRadius: 3,
            BackgroundColor: Color.Transparent,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Link, Name: ui.Strings.Get(label)},
            OnClick: action,
            Label(ui, ui.Strings.Get(label) + " ›", 12, ui.Lime, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Upgrade(input OverviewInput) Blob {
        let ui = input.Ui
        let node = input.Node
        let bar = WalletParts.Card(ui, Edges{Top: 0, Bottom: 0, Left: 16, Right: 10}, 14)
        bar.FlexShrink = 0
        bar.FlexDirection = FlexDirection.Row
        bar.AlignItems = AlignItems.Center
        bar.Height = 40
        bar.Add(Label(ui, ui.Strings.Get("Network upgrade") + " " + node.UpgradeDate, 12, ui.Body, ""))
        bar.Add(
            Container{
                Handle: strip,
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                if stripWidth > 0 {
                    UpgradeTimeline(ui, node, stripWidth)
                } else {
                    Container{}
                }
            }
        )
        if !node.Syncing {
            bar.Add(Label(ui, Count(node.UpgradeBlocksLeft) + " " + ui.Strings.Get("blocks"), 14, ui.Ink, ""))
        }
        bar.Add(
            IconButton{
                Icon: MaterialIcons.Create("info", 16, ui.Body),
                AccessibilityName: ui.Strings.Get("Upgrade notice"),
                OnClick: input.OnUpgrade
            }.Build()
        )
        return bar
    }

    private func Hero(input OverviewInput, arrivals List[Arrival]) Blob {
        let ui = input.Ui
        let balance = input.Snapshot.Balance
        let masked = input.Privacy && !peeking
        let total = balance?.Balance ?? uint64(0)
        let ready = balance?.Spendable ?? uint64(0)
        let unconfirmed = balance?.Unconfirmed ?? uint64(0)
        let confirming = (balance?.Pending ?? uint64(0)) - unconfirmed
        let known = balance?.Balance != nil
        let scanning = balance?.Scanning == true
        let value = if masked {
            "••••••••"
        } else if known {
            Fixed(total)
        } else {
            "-"
        }
        let color = if masked || !known || total == 0 {
            ui.Dim
        } else {
            ui.Lime
        }
        let inner = Math.Max(0.0, heroWidth - 40)
        let size = if masked || !known {
            34.0
        } else {
            Math.Clamp(Math.Min(input.Height * 0.12, inner * 1.53 / value.Length), 34, 150)
        }
        let card = WalletParts.Card(ui, Edges{Top: 16, Bottom: 16, Left: 20, Right: 20}, 14)
        card.Handle = hero
        card.FlexGrow = 1
        if peeking {
            card.BorderColor = ui.StrongRule
        }
        let header = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            FlexShrink: 0,
            Grow(Label(ui, ui.Strings.Get("balance"), 12, ui.Body, ""))
        }
        if input.Privacy {
            let press = (event PointerEvent) -> if !event.IsFromInteractiveChild {
                event.Capture()
                peeking = true
                Rebuild()
            }
            header.Height = 28
            header.Add(Label(ui, ui.Strings.Get(peeking ? "release to hide": "hold to show"), 12, ui.Dim, ""))
            header.Add(
                Container{
                    Width: 28,
                    Height: 28,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    BorderWidth: 1,
                    BorderRadius: 6,
                    BorderColor: peeking ? ui.Lime: ui.Edge,
                    BackgroundColor: peeking ? ui.Active: Color.Transparent,
                    Focusable: true,
                    Focus: Theme.Read().FocusStyle,
                    Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get("Show amounts")},
                    OnKeyDown: (event KeyEvent) -> if !peeking && (event.Key == Key.Space || event.Key == Key.Enter) {
                        peeking = true
                        Rebuild()
                    },
                    OnKeyUp: (event KeyEvent) -> Hide(),
                    OnBlur: (event FocusEvent) -> Hide(),
                    OnPointerDown: press,
                    OnPointerUp: (event PointerEvent) -> Hide(),
                    OnPointerCancel: (event PointerEvent) -> Hide(),
                    MaterialIcons.Create("visibility_off", 16, peeking ? ui.Lime: ui.Body)
                }
            )
            card.OnPointerDown = press
            card.OnPointerUp = (event PointerEvent) -> Hide()
            card.OnPointerCancel = (event PointerEvent) -> Hide()
        }
        card.Add(header)
        let figure = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: 12,
            Cell.Mount[DecodeValueInput, DecodeValue](
                "balance",
                DecodeValueInput{
                    Value: value,
                    Ui: ui,
                    Name: if masked {
                        ui.Strings.Get("Amounts hidden")
                    } else if known {
                        ui.Strings.Get("balance") + " " + WalletAmount.Format(total) + " BNT"
                    } else {
                        value
                    },
                    Size: size,
                    Color: color,
                    FractionColor: color == ui.Lime ? fraction: Color.Parse("#3f3f3f"),
                    Live: AccessibilityLive.Polite
                }
            )
        }
        if known && !masked {
            figure.Add(Label(ui, "BNT", 16, ui.Body, ""))
        }
        card.Add(
            Container{
                FlexGrow: 1,
                MinHeight: 0,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                figure
            }
        )
        if scanning {
            card.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 6,
                    Text{
                        Content: String.Format(
                            ui.Strings.Get("Syncing {0} / {1} · balance may be inaccurate"),
                            Count(balance?.ScanHeight ?? uint64(0)),
                            Count(balance?.ChainHeight ?? input.Node.Height)
                        ),
                        FontFamily: ui.Font,
                        FontSize: 12,
                        Color: ui.Orange,
                        TextWrap: TextWrap.Wrap,
                        FlexGrow: 1,
                        MinWidth: 0
                    },
                    Cell.Mount[InfoTipInput, InfoTip](
                        "scan-info",
                        InfoTipInput{
                            Ui: ui,
                            Topic: "About sync",
                            Lines: []string{
                                "The wallet is catching up with the chain. The amount shown is the last known balance and updates when syncing ends."
                            },
                            Language: ui.Strings.Language,
                            Width: 300
                        }
                    )
                }
            )
        }
        let height = Math.Clamp(input.Height * 0.018, 12, 20)
        let bar = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 3,
            Height: height,
            FlexShrink: 0,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: if masked {
                    ui.Strings.Get("Amounts hidden")
                } else {
                    ui.Strings.Get("ready") + " " + WalletAmount.Format(ready) + ", " + ui.Strings.Get("confirming") +
                        " " +
                        WalletAmount.Format(confirming) + ", " + ui.Strings.Get("in mempool") +
                        " " +
                        WalletAmount.Format(unconfirmed)
                }
            }
        }
        if masked || total == 0 {
            bar.Add(Container{FlexGrow: 1, Height: height, BorderRadius: 2, BackgroundColor: ui.Selected})
        } else {
            if ready > 0 {
                bar.Add(BarSegment(float64(ready) / 100000000, ui.Lime, height, 14))
            }
            if confirming > 0 {
                let segment = BarSegment(float64(confirming) / 100000000, ui.Orange, hovering ? height + 6: height, 14)
                segment.OnPointerEnter = (event PointerEvent) -> {
                    hovering = true
                    Rebuild()
                }
                segment.OnPointerLeave = (event PointerEvent) -> {
                    hovering = false
                    Rebuild()
                }
                if hovering {
                    segment.BoxShadows = []BoxShadow{
                        BoxShadow{Spread: 1, Color: ui.Black},
                        BoxShadow{Spread: 2, Color: ui.Orange}
                    }
                }
                bar.Add(segment)
            }
            if unconfirmed > 0 {
                bar.Add(BarSegment(float64(unconfirmed) / 100000000, ui.Blue, height, 14))
            }
        }
        let wrap = Container{FlexShrink: 0, Position: PositionType.Relative, bar}
        if hovering && !masked && confirming > 0 {
            let outputs = arrivals.Count((item Arrival) -> item.Kind != "pool")
            let last = arrivals.Where((item Arrival) -> item.Kind != "pool").Max((item Arrival) -> item.Blocks)
            wrap.Add(
                Container{
                    Position: PositionType.Absolute,
                    Right: 20,
                    Bottom: height + 8,
                    ZIndex: 5,
                    HitTestSelf: false,
                    Padding: Edges{Top: 10, Bottom: 10, Left: 12, Right: 12},
                    Gap: 4,
                    BackgroundColor: ui.Control,
                    BorderWidth: 1,
                    BorderColor: ui.PopoverEdge,
                    BorderRadius: 6,
                    BoxShadows: []BoxShadow{BoxShadow{OffsetY: 10, Blur: 28, Color: ui.Black}},
                    KeyValue(ui, ui.Strings.Get("confirming"), Fixed(confirming)),
                    KeyValue(ui, ui.Strings.Get("outputs"), outputs.ToString()),
                    KeyValue(ui, ui.Strings.Get("all ready"), Wait(input, last))
                }
            )
        }
        card.Add(wrap)
        card.Add(Legend(input, masked, ready, confirming, unconfirmed, total == 0))
        return card
    }

    private func Hide() {
        if peeking {
            peeking = false
            Rebuild()
        }
    }

    private func Legend(
        input OverviewInput,
        masked bool,
        ready uint64,
        confirming uint64,
        unconfirmed uint64,
        empty bool
    ) Blob {
        let ui = input.Ui
        let wide = heroWidth - 40 >= 470
        let legend = Container{FlexDirection: wide ? FlexDirection.Row: FlexDirection.Column, Gap: 8, FlexShrink: 0}
        let items = [](string, uint64, Color){
            ("ready", ready, ui.Lime),
            ("confirming", confirming, ui.Orange),
            ("in mempool", unconfirmed, ui.Blue)
        }
        for (label, units, tint) in items {
            let name = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                Height: 18,
                Container{Width: 8, Height: 8, BorderRadius: 2, BackgroundColor: tint},
                Label(ui, ui.Strings.Get(label), 12, ui.Body, "")
            }
            if label == "confirming" {
                name.Add(Info(ui))
            }
            let text = masked ? "••••••••": Fixed(units)
            let color = if masked || empty {
                ui.Dim
            } else if label == "ready" {
                ui.Ink
            } else {
                tint
            }
            let value = Cell.Mount[DecodeValueInput, DecodeValue](
                label,
                DecodeValueInput{
                    Value: text,
                    Ui: ui,
                    Name: ui.Strings.Get(label) + " " + if masked {
                        ui.Strings.Get("Amounts hidden")
                    } else {
                        WalletAmount.Format(units)
                    },
                    Size: wide ? Math.Clamp(input.Height * 0.024, 16, 26): 16,
                    Color: color,
                    FractionColor: ui.Dim
                }
            )
            legend.Add(
                if wide {
                    Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Gap: 6, name, value}
                } else {
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        name,
                        Container{FlexGrow: 1},
                        value
                    }
                }
            )
        }
        return legend
    }

    private func Info(ui Presentation) Blob -> Container{
        Handle: infoAnchor,
        IconButton{
            Icon: MaterialIcons.Create("info", 16, infoOpen ? ui.Ink: ui.Body),
            AccessibilityName: ui.Strings.Get("About confirming"),
            OnClick: () -> {
                infoOpen = !infoOpen
                Rebuild()
            }
        }.Build(),
        Cell.Mount[PopoverInput, Popover](
            "confirming-info",
            PopoverInput{
                Open: infoOpen,
                Anchor: infoAnchor,
                Placement: PopoverPlacement.BottomStart,
                Width: Length.Auto,
                Padding: 12,
                BackgroundColor: ui.Control,
                BorderColor: ui.PopoverEdge,
                TakeFocus: false,
                AccessibilityName: ui.Strings.Get("About confirming"),
                Content: Container{
                    Gap: 4,
                    Label(ui, ui.Strings.Get("Received: 10 blocks."), 12, ui.Body, ""),
                    Label(ui, ui.Strings.Get("Mined: 60 blocks."), 12, ui.Body, ""),
                    Label(ui, ui.Strings.Get("Mempool: change from your send."), 12, ui.Body, ""),
                    Label(ui, ui.Strings.Get("1 block ≈ 5 min."), 12, ui.Body, "")
                },
                OnDismiss: reason -> {
                    infoOpen = false
                    Rebuild()
                }
            }
        )
    }

    private func Fade(color Color, faded bool) Color -> if faded {
        Color.FromNormalized(color.R * 0.3F + 0.014F, color.G * 0.3F + 0.014F, color.B * 0.3F + 0.014F, 1F)
    } else {
        color
    }

    private func Arrive(input OverviewInput, item Arrival) Blob {
        let ui = input.Ui
        let faded = hovering && item.Kind == "pool"
        let key = item.TxId + ":" + item.Height.ToString()
        let unfolded = item.TxId.Length > 0 && expanded == key
        let glyph Blob = switch item.Kind {
            case "mined": Label(ui, "◆", 14, Fade(ui.Violet, faded), "")
            case "in": Label(ui, "↓", 14, Fade(ui.Mint, faded), "")
            default: MaterialIcons.Create("replay", 14, Fade(ui.Blue, faded))
        }
        let row = Goo
            .Button{
            FlexDirection: FlexDirection.Column,
            AlignItems: AlignItems.Stretch,
            JustifyContent: JustifyContent.FlexStart,
            Gap: 6,
            Padding: Edges{Top: 12, Bottom: 12},
            FlexShrink: 0,
            BorderWidth: Edges{Bottom: 1},
            BorderColor: ui.Rule,
            BackgroundColor: Color.Transparent,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: Hidden(input.Privacy, SafeText(item.Source, 512)) + " " + Wait(input, item.Blocks),
                Expanded: item.TxId.Length > 0 ? unfolded: nil
            },
            OnClick: () -> {
                if item.TxId.Length > 0 {
                    expanded = unfolded ? "": key
                    Rebuild()
                }
            },
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 12,
                Container{Width: 16, AlignItems: AlignItems.Center, glyph},
                Container{
                    Width: 120,
                    Number(ui, input.Privacy, Fixed(item.Amount), Fade(ui.Ink, faded), Fade(ui.Dim, faded))
                },
                Grow(Label(ui, Hidden(input.Privacy, SafeText(item.Source, 512)), 13, Fade(ui.Dim, faded), "")),
                Container{
                    Width: input.Width < 1200 ? 110.0: 160.0,
                    Gap: 5,
                    AlignItems: AlignItems.FlexEnd,
                    Label(
                        ui,
                        item.Kind == "pool" ? ui.Strings.Get("mempool"): item.Confirmations.ToString() +
                            "/" +
                            item
                            .Required
                            .ToString(),
                        11,
                        Fade(item.Kind == "pool" ? ui.Blue: ui.Orange, faded),
                        ""
                    ),
                    Container{
                        Width: Percent(100),
                        Height: 3,
                        BackgroundColor: Fade(ui.Selected, faded),
                        Container{
                            Width: Percent(100.0 * item.Confirmations / item.Required),
                            Height: 3,
                            BackgroundColor: Fade(ui.Orange, faded)
                        }
                    }
                },
                Container{
                    Width: 60,
                    AlignItems: AlignItems.FlexEnd,
                    Label(ui, Wait(input, item.Blocks), 11, Fade(ui.Dim, faded), "")
                }
            }
        }
        WidgetKeyBindings.BindActivation(row)
        if unfolded {
            let ready = DateTime
                .Now
                .AddMinutes(float64(item.Blocks * 5))
                .ToString("HH:mm", CultureInfo.InvariantCulture)
            row.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    FlexWrap: FlexWrap.Wrap,
                    AlignItems: AlignItems.Center,
                    Gap: 18,
                    RowGap: 6,
                    Padding: Edges{Left: 28, Top: 4},
                    KeyValue(ui, ui.Strings.Get("block"), Count(item.Height), 6, ui.Dim),
                    KeyValue(ui, "tx", Short(item.TxId).Substring(3), 6, ui.Dim),
                    KeyValue(ui, ui.Strings.Get("ready at"), ready, 6, ui.Dim),
                    Container{FlexGrow: 1},
                    Link(ui, "history", () -> input.OnNavigate(AppPage.Transactions))
                }
            )
        }
        return row
    }

    private func Activities(input OverviewInput, chain uint64) List[Activity] {
        let ui = input.Ui
        let snapshot = input.Snapshot
        let items = List[Activity]()
        let selfSends = snapshot
            .Sends
            .Where(send -> send.IsSelf(snapshot.Address))
            .Select(send -> send.TxId)
            .ToHashSet()
        for output in snapshot.History.Take(50) {
            if selfSends.Contains(output.TxId) {
                continue
            }
            let required = output.Coinbase ? uint64(60): uint64(10)
            let confirmations = chain > output.BlockHeight ? chain - output.BlockHeight: uint64(0)
            items.Add(
                Activity{
                    Kind: output.Coinbase ? "mined": "in",
                    Amount: output.Amount,
                    Label: if output.Memo.Length > 0 {
                        output.Memo
                    } else if output.Coinbase {
                        ui.Strings.Get("block") + " " + Count(output.BlockHeight)
                    } else {
                        Short(output.TxId)
                    },
                    Status: if output.BlockHeight == 0 {
                        "mempool"
                    } else {
                        Math.Min(confirmations + 1, required).ToString() + "/" + required.ToString()
                    },
                    Ready: output.BlockHeight > 0 && confirmations >= required,
                    Order: output.BlockHeight == 0 ? uint64.MaxValue: output.BlockHeight,
                    Timestamp: times.GetValueOrDefault(output.BlockHeight)
                }
            )
        }
        for send in snapshot.Sends.Take(50) {
            let label = Contact(input, send)
            let self = selfSends.Contains(send.TxId)
            items.Add(
                Activity{
                    Kind: self ? "self": "out",
                    Amount: self ? send.Fee: send.Amount,
                    Label: self ? ui.Strings.Get("To self") +
                        (label.Length > 0 ? " · " + label: ""): label.Length > 0 ? label: Short(send.TxId),
                    Status: send.Status == "not_found" ? ui.Strings.Get(
                        "not found"
                    ): send.Status == "mempool" ? "mempool": Math
                        .Min(send.Confirmations, uint64(10)).ToString() + "/10",
                    Ready: send.Status == "confirmed" && send.Confirmations >= 10,
                    Order: if send.Status == "mempool" {
                        uint64.MaxValue
                    } else {
                        chain + 1 - Math.Min(chain, send.Confirmations)
                    },
                    Timestamp: send.Timestamp
                }
            )
        }
        return items.OrderByDescending((item Activity) -> item.Order).Take(50).ToList()
    }

    private func Recent(input OverviewInput, chain uint64, arrivals List[Arrival]) Blob {
        let ui = input.Ui
        let incoming = arrivals.Where(item -> !item.Self).ToArray()
        let card = WalletParts.Card(ui, Edges{Top: 12, Bottom: 12, Left: 16, Right: 16}, 0)
        card.Overflow = Overflow.Hidden
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.MinWidth = 0
        let header = WalletParts.Header(Label(ui, ui.Strings.Get("recent"), 12, ui.Body, ""))
        header.Height = 24
        header.Margin = Edges{Bottom: 4}
        if incoming.Length > 0 {
            header.Add(Label(ui, ui.Strings.Get("incoming") + " " + incoming.Length.ToString(), 11, ui.Body, ""))
            header.Add(
                Label(
                    ui,
                    ui.Strings.Get("all ready") + " " + Wait(input, incoming.Max((item Arrival) -> item.Blocks)),
                    11,
                    ui.Dim,
                    ""
                )
            )
        }
        header.Add(Container{FlexGrow: 1})
        header.Add(Link(ui, "history", () -> input.OnNavigate(AppPage.Transactions)))
        card.Add(header)
        let activities = Activities(input, chain)
        if activities.Count == 0 && incoming.Length == 0 {
            card.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Height: 40,
                    Grow(Label(ui, ui.Strings.Get("no transactions yet"), 14, ui.Dim, ""))
                }
            )
            return card
        }
        let height = 48.0
        let rows = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            Overflow: Overflow.Scroll,
            ScrollbarY: Theme.Read().Scrollbar
        }
        for item in incoming {
            rows.Add(Arrive(input, item))
        }
        for item in activities {
            let outgoing = item.Kind == "out" || item.Kind == "self"
            let shown = input.Privacy ? ui.Strings.Get("Amounts hidden"): WalletAmount.Format(item.Amount)
            let glyph Blob = if item.Kind == "self" {
                MaterialIcons.Create("sync", 14, ui.Pink)
            } else {
                Label(
                    ui,
                    outgoing ? "↑": item.Kind == "mined" ? "◆": "↓",
                    14,
                    outgoing ? ui.Pink: item.Kind == "mined" ? ui.Violet: ui.Mint,
                    ""
                )
            }
            rows.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 12,
                    Height: height,
                    FlexShrink: 0,
                    MinWidth: 0,
                    Overflow: Overflow.Hidden,
                    BorderWidth: Edges{Bottom: 1},
                    BorderColor: ui.Rule,
                    Accessibility: Accessibility{
                        Name: ui.Strings.Get(item.Kind == "self" ? "To self": outgoing ? "sent": "received") +
                            " " +
                            shown +
                            " " +
                            Hidden(input.Privacy, SafeText(item.Label, 512))
                    },
                    Container{Width: 16, AlignItems: AlignItems.Center, glyph},
                    Container{
                        Width: 120,
                        Number(
                            ui,
                            input.Privacy,
                            (outgoing ? "-": "+") +
                                (item.Kind == "self" ? WalletAmount.Format(item.Amount): Fixed(item.Amount)),
                            outgoing ? ui.Pink: ui.Mint,
                            ui.Dim
                        )
                    },
                    Grow(Label(ui, Hidden(input.Privacy, SafeText(item.Label, 512)), 13, ui.Dim, "")),
                    Container{
                        Width: input.Width < 1200 ? 110.0: 160.0,
                        AlignItems: AlignItems.FlexEnd,
                        Label(
                            ui,
                            item.Status == "mempool" ? ui.Strings.Get("mempool"): item.Status,
                            11,
                            item.Status == "mempool" ? ui.Blue: item.Ready ? ui.Lime: ui.Orange,
                            ""
                        )
                    },
                    Container{
                        Width: 60,
                        AlignItems: AlignItems.FlexEnd,
                        Label(ui, item.Timestamp > 0 ? Clock(item.Timestamp): "-", 12, ui.Dim, "")
                    }
                }
            )
        }
        card.Add(rows)
        return card
    }
}
