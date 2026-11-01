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
    var OutputIndex int32
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
    private var heroWidth float64
    private var stripWidth float64
    private var hovering bool
    private var peeking bool
    private var expanded string = ""
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
        let page = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, Gap: AppTheme.Space12}
        if input.Node.UpgradeDate.Length > 0 {
            page.Add(Upgrade(input))
        }
        let top = Container{
            Height: Math.Clamp(Math.Min(input.Height * 0.32, input.Width * 0.09 + 151), 260, 352),
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space16
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
        let size = input.Width < 1200 ? AppTheme.Type20: AppTheme.Type24
        let color = online ? AppTheme.Ink: AppTheme.Dim
        let card = WalletParts.Card(ui, AppTheme.Space16, AppTheme.Space10)
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
            Gap: AppTheme.Space10,
            TextParts.Figure(
                ui,
                "height",
                height,
                sync,
                size,
                !online ? AppTheme.Pink: node.Syncing ? AppTheme.Orange: AppTheme.Lime,
                1.85
            ),
            TextParts.Figure(ui, "peers", Count(node.Peers), "", size, color),
            TextParts.Figure(ui, "last block", last, "", size, online && age > 900 ? AppTheme.Orange: color)
        }
        card.Add(first)
        let second = Container{
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space10,
            TextParts.Figure(ui, "hashrate", Rate(report.Hashrate), Unit(report.Hashrate), size, color, 1.85),
            TextParts.Figure(ui, "difficulty", Compact(report.Difficulty), "", size, color),
            TextParts.Figure(
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
                Label(ui, ui.Strings.Get("block time") + " " + average, AppTheme.Type12, color, ""),
                AppTheme.Space8,
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
        for output in input.Session.History.Outputs.Concat(input.Session.History.ChangeOutputs) {
            let maturity = output.Maturity(chain)
            if output.Spent || output.BlockHeight == 0 || maturity.Ready {
                continue
            }
            let send = input.Snapshot.Sends.FirstOrDefault(item -> item.TxId == output.TxId)
            arrivals.Add(
                Arrival{
                    Kind: output.IsChange ? "change": output.Coinbase ? "mined": "in",
                    Self: send?.IsSelf(input.Snapshot.Address) ?? false,
                    Amount: output.Amount,
                    Source: if output.IsChange {
                        Change(input, send)
                    } else if output.Coinbase {
                        ui.Strings.Get("mined") + " · " + ui.Strings.Get("block") + " " + Count(output.BlockHeight)
                    } else if output.Memo.Length > 0 {
                        output.Memo
                    } else {
                        Short(output.TxId)
                    },
                    Confirmations: maturity.Count,
                    Required: maturity.Required,
                    Blocks: maturity.Remaining,
                    TxId: output.TxId,
                    OutputIndex: output.OutputIndex,
                    Height: output.BlockHeight
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
            return Label(ui, "••••••••", AppTheme.Type14, fraction, "")
        }
        let point = text.IndexOf('.')
        return Text{
            Content: text,
            StyleRanges: []TextStyleRange{
                TextStyleRange(TextRange(point, text.Length - point), Style{Color: fraction})
            },
            FontSize: AppTheme.Type14,
            Color: color,
            TextWrap: TextWrap.NoWrap,
            FlexShrink: 0
        }
    }

    private func Link(ui Presentation, label string, action Action) Blob {
        let button = Goo
            .Button{
            FlexShrink: 0,
            BorderRadius: AppTheme.Radius3,
            BackgroundColor: Color.Transparent,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Link, Name: ui.Strings.Get(label)},
            OnClick: action,
            Label(ui, ui.Strings.Get(label) + " ›", AppTheme.Type12, AppTheme.Lime, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Upgrade(input OverviewInput) Blob {
        let ui = input.Ui
        let node = input.Node
        let bar = WalletParts.Card(
            ui,
            Edges{Top: AppTheme.Space0, Bottom: AppTheme.Space0, Left: AppTheme.Space16, Right: AppTheme.Space10},
            AppTheme.Space14
        )
        bar.FlexShrink = 0
        bar.FlexDirection = FlexDirection.Row
        bar.AlignItems = AlignItems.Center
        bar.Height = 40
        bar.Add(
            Label(ui, ui.Strings.Get("Network upgrade") + " " + node.UpgradeDate, AppTheme.Type12, AppTheme.Body, "")
        )
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
            bar.Add(
                Label(
                    ui,
                    Count(node.UpgradeBlocksLeft) + " " + ui.Strings.Get("blocks"),
                    AppTheme.Type14,
                    AppTheme.Ink,
                    ""
                )
            )
        }
        bar.Add(
            (
                AppTheme.IconButton with{
                    Icon = MaterialIcons.Create("info", AppTheme.Icon16, AppTheme.Body),
                    AccessibilityName = ui.Strings.Get("Upgrade notice"),
                    OnClick = input.OnUpgrade
                }
            ).Build()
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
            AppTheme.Dim
        } else {
            AppTheme.Lime
        }
        let inner = Math.Max(0.0, heroWidth - 40)
        let size = AppTheme.GetBalanceSize(masked || !known, input.Height, inner, value.Length)
        let card = WalletParts.Card(
            ui,
            Edges{Top: AppTheme.Space16, Bottom: AppTheme.Space16, Left: AppTheme.Space20, Right: AppTheme.Space20},
            AppTheme.Space14
        )
        card.Handle = hero
        card.FlexGrow = 1
        if peeking {
            card.BorderColor = AppTheme.StrongRule
        }
        let header = WalletParts.Header(
            Label(ui, ui.Strings.Get("balance"), AppTheme.Type12, AppTheme.Body, ""),
            AppTheme.Space10
        )
        if input.Privacy {
            let press = (event PointerEvent) -> if !event.IsFromInteractiveChild {
                event.Capture()
                peeking = true
                Rebuild()
            }
            header.Height = AppTheme.ControlCompact
            header.Add(
                Label(
                    ui,
                    ui.Strings.Get(peeking ? "release to hide": "hold to show"),
                    AppTheme.Type12,
                    AppTheme.Dim,
                    ""
                )
            )
            header.Add(
                Container{
                    BasedOn: AppTheme.IconButtonStyle,
                    Width: AppTheme.ControlCompact,
                    Height: AppTheme.ControlCompact,
                    BorderRadius: AppTheme.Radius6,
                    BorderColor: peeking ? AppTheme.Lime: AppTheme.Edge,
                    BackgroundColor: peeking ? AppTheme.LimeQuiet: Color.Transparent,
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
                    MaterialIcons.Create("visibility_off", AppTheme.Icon16, peeking ? AppTheme.Lime: AppTheme.Body)
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
            Gap: AppTheme.Space12,
            TextParts.Value(
                ui,
                "balance",
                if masked {
                    ui.Strings.Get("Amounts hidden")
                } else if known {
                    ui.Strings.Get("balance") + " " + WalletAmount.Format(total) + " BNT"
                } else {
                    value
                },
                value,
                size,
                color,
                color == AppTheme.Lime ? AppTheme.LimeMuted: AppTheme.StrongRule,
                AccessibilityLive.Polite
            )
        }
        if known && !masked {
            figure.Add(Label(ui, "BNT", AppTheme.Type16, AppTheme.Body, ""))
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
                    Gap: AppTheme.Space6,
                    Text{
                        Content: String.Format(
                            ui.Strings.Get("Syncing {0} / {1} · balance may be inaccurate"),
                            Count(balance?.ScanHeight ?? uint64(0)),
                            Count(balance?.ChainHeight ?? input.Node.Height)
                        ),
                        FontFamily: AppTheme.Font,
                        FontSize: AppTheme.Type12,
                        Color: AppTheme.Orange,
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
            Gap: AppTheme.Space4,
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
            bar.Add(
                Container{FlexGrow: 1, Height: height, BorderRadius: AppTheme.Radius2, BackgroundColor: AppTheme.Rule}
            )
        } else {
            if ready > 0 {
                bar.Add(BarSegment(float64(ready) / 100000000, AppTheme.Lime, height, 14))
            }
            if confirming > 0 {
                let segment = BarSegment(
                    float64(confirming) / 100000000,
                    AppTheme.Orange,
                    hovering ? height + 6: height,
                    14
                )
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
                        BoxShadow{Spread: 1, Color: AppTheme.Black},
                        BoxShadow{Spread: 2, Color: AppTheme.Orange}
                    }
                }
                bar.Add(segment)
            }
            if unconfirmed > 0 {
                bar.Add(BarSegment(float64(unconfirmed) / 100000000, AppTheme.Blue, height, 14))
            }
        }
        let wrap = Container{FlexShrink: 0, Position: PositionType.Relative, bar}
        if hovering && !masked && confirming > 0 {
            let outputs = arrivals.Count((item Arrival) -> item.Kind != "pool")
            let last = arrivals.Where((item Arrival) -> item.Kind != "pool").Max((item Arrival) -> item.Blocks)
            let content = Container{
                Gap: AppTheme.Space4,
                KeyValue(ui, ui.Strings.Get("confirming"), Fixed(confirming)),
                KeyValue(ui, ui.Strings.Get("outputs"), outputs.ToString()),
                KeyValue(ui, ui.Strings.Get("all ready"), Wait(input, last))
            }
            wrap.Add(ChartParts.Tooltip(0, 0, content, right: 20, bottom: height + AppTheme.Space8, zIndex: 5))
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
        let legend = Container{
            FlexDirection: wide ? FlexDirection.Row: FlexDirection.Column,
            Gap: AppTheme.Space8,
            FlexShrink: 0
        }
        let items = [](string, uint64, Color){
            ("ready", ready, AppTheme.Lime),
            ("confirming", confirming, AppTheme.Orange),
            ("in mempool", unconfirmed, AppTheme.Blue)
        }
        for (label, units, tint) in items {
            let name = TextParts.Legend(ui, ui.Strings.Get(label), tint)
            name.Height = 18
            if label == "confirming" {
                name.Add(Info(ui))
            }
            let text = masked ? "••••••••": Fixed(units)
            let color = if masked || empty {
                AppTheme.Dim
            } else if label == "ready" {
                AppTheme.Ink
            } else {
                tint
            }
            let value = TextParts.Value(
                ui,
                label,
                ui.Strings.Get(label) + " " + if masked {
                    ui.Strings.Get("Amounts hidden")
                } else {
                    WalletAmount.Format(units)
                },
                text,
                AppTheme.GetLegendFigureSize(wide, input.Height),
                color,
                AppTheme.Dim
            )
            legend.Add(
                if wide {
                    Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Gap: AppTheme.Space6, name, value}
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

    private func Info(ui Presentation) Blob -> Cell.Mount[InfoTipInput, InfoTip](
        "confirming-info",
        InfoTipInput{
            Ui: ui,
            Topic: "About confirming",
            Lines: []string{
                "Received: 10 blocks.",
                "Mined: 60 blocks.",
                "Mempool: change from your send.",
                "1 block ≈ 5 min."
            },
            Language: ui.Strings.Language,
            Width: 300,
            Placement: PopoverPlacement.BottomStart,
            TakeFocus: false
        }
    )

    private func Fade(color Color, faded bool) Color -> if faded {
        Color.FromNormalized(color.R * 0.3F + 0.014F, color.G * 0.3F + 0.014F, color.B * 0.3F + 0.014F, 1F)
    } else {
        color
    }

    private func Arrive(input OverviewInput, item Arrival) Blob {
        let ui = input.Ui
        let faded = hovering && item.Kind == "pool"
        let key = item.TxId + ":" + item.OutputIndex.ToString()
        let unfolded = item.TxId.Length > 0 && expanded == key
        let glyph Blob = switch item.Kind {
            case "mined": Label(ui, "◆", AppTheme.Type14, Fade(AppTheme.Lime, faded), "")
            case "in": Label(ui, "↓", AppTheme.Type14, Fade(AppTheme.Mint, faded), "")
            default: MaterialIcons.Create("replay", AppTheme.Icon14, Fade(AppTheme.Blue, faded))
        }
        let row = Goo
            .Button{
            BasedOn: AppTheme.ListRowStyle,
            FlexDirection: FlexDirection.Column,
            AlignItems: AlignItems.Stretch,
            JustifyContent: JustifyContent.FlexStart,
            Gap: AppTheme.Space6,
            Padding: Edges{Top: AppTheme.Space12, Bottom: AppTheme.Space12},
            FlexShrink: 0,
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
                Gap: AppTheme.Space12,
                Container{Width: 16, AlignItems: AlignItems.Center, glyph},
                Container{
                    Width: 120,
                    Number(ui, input.Privacy, Fixed(item.Amount), Fade(AppTheme.Ink, faded), Fade(AppTheme.Dim, faded))
                },
                Grow(
                    Label(
                        ui,
                        Hidden(input.Privacy, SafeText(item.Source, 512)),
                        AppTheme.Type13,
                        Fade(AppTheme.Dim, faded),
                        ""
                    )
                ),
                Container{
                    Width: input.Width < 1200 ? 110.0: 160.0,
                    Gap: AppTheme.Space6,
                    AlignItems: AlignItems.FlexEnd,
                    Label(
                        ui,
                        item.Kind == "pool" ? ui.Strings.Get("mempool"): item.Confirmations.ToString() +
                            "/" +
                            item
                            .Required
                            .ToString(),
                        AppTheme.Type11,
                        Fade(item.Kind == "pool" ? AppTheme.Blue: AppTheme.Orange, faded),
                        ""
                    ),
                    Container{
                        Width: Percent(100),
                        Height: 3,
                        BackgroundColor: Fade(AppTheme.Rule, faded),
                        Container{
                            Width: Percent(100.0 * item.Confirmations / item.Required),
                            Height: 3,
                            BackgroundColor: Fade(AppTheme.Orange, faded)
                        }
                    }
                },
                Container{
                    Width: 60,
                    AlignItems: AlignItems.FlexEnd,
                    Label(ui, Wait(input, item.Blocks), AppTheme.Type11, Fade(AppTheme.Dim, faded), "")
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
                    Gap: AppTheme.Space16,
                    RowGap: AppTheme.Space6,
                    Padding: Edges{Left: AppTheme.Space28, Top: AppTheme.Space4},
                    KeyValue(ui, ui.Strings.Get("block"), Count(item.Height), AppTheme.Space6, AppTheme.Dim),
                    KeyValue(ui, "tx", Short(item.TxId).Substring(3), AppTheme.Space6, AppTheme.Dim),
                    KeyValue(ui, ui.Strings.Get("ready at"), ready, AppTheme.Space6, AppTheme.Dim),
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
        for output in snapshot.History {
            let maturity = output.Maturity(chain)
            if selfSends.Contains(output.TxId) || (!output.Spent && output.BlockHeight > 0 && !maturity.Ready) {
                continue
            }
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
                        maturity.Count.ToString() + "/" + maturity.Required.ToString()
                    },
                    Ready: output.BlockHeight > 0 && maturity.Ready,
                    Order: output.BlockHeight == 0 ? uint64.MaxValue: output.BlockHeight,
                    Timestamp: times.GetValueOrDefault(output.BlockHeight)
                }
            )
            if items.Count == 50 {
                break
            }
        }
        for send in snapshot.Sends.Take(50) {
            let label = Contact(input, send)
            let self = selfSends.Contains(send.TxId)
            let maturity = WalletMaturity(send.Confirmations, 10)
            items.Add(
                Activity{
                    Kind: self ? "self": "out",
                    Amount: self ? send.Fee: send.Amount,
                    Label: self ? ui.Strings.Get("To self") +
                        (label.Length > 0 ? " · " + label: ""): label.Length > 0 ? label: Short(send.TxId),
                    Status: send.Status == "not_found" ? ui.Strings.Get(
                        "not found"
                    ): send.Status == "mempool" ? "mempool": maturity
                        .Count
                        .ToString() + "/10",
                    Ready: send.Status == "confirmed" && maturity.Ready,
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
        let card = WalletParts.Card(
            ui,
            Edges{Top: AppTheme.Space12, Bottom: AppTheme.Space12, Left: AppTheme.Space16, Right: AppTheme.Space16},
            AppTheme.Space0
        )
        card.Overflow = Overflow.Hidden
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.MinWidth = 0
        let header = WalletParts.Header(Label(ui, ui.Strings.Get("recent"), AppTheme.Type12, AppTheme.Body, ""))
        header.Height = 24
        header.Margin = Edges{Bottom: AppTheme.Space4}
        if incoming.Length > 0 {
            header.Add(
                Label(
                    ui,
                    ui.Strings.Get("incoming") + " " + incoming.Length.ToString(),
                    AppTheme.Type11,
                    AppTheme.Body,
                    ""
                )
            )
            header.Add(
                Label(
                    ui,
                    ui.Strings.Get("all ready") + " " + Wait(input, incoming.Max((item Arrival) -> item.Blocks)),
                    AppTheme.Type11,
                    AppTheme.Dim,
                    ""
                )
            )
        }
        header.Add(Container{FlexGrow: 1})
        header.Add(Link(ui, "history", () -> input.OnNavigate(AppPage.Transactions)))
        card.Add(header)
        let activities = Activities(input, chain)
        if activities.Count == 0 && incoming.Length == 0 {
            card.Add(ListParts.Empty(ui, "no transactions yet"))
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
                MaterialIcons.Create("sync", AppTheme.Icon14, AppTheme.Pink)
            } else {
                Label(
                    ui,
                    outgoing ? "↑": item.Kind == "mined" ? "◆": "↓",
                    AppTheme.Type14,
                    outgoing ? AppTheme.Pink: item.Kind == "mined" ? AppTheme.Lime: AppTheme.Mint,
                    ""
                )
            }
            rows.Add(
                Container{
                    BasedOn: AppTheme.ListRowStyle,
                    Gap: AppTheme.Space12,
                    Height: height,
                    FlexShrink: 0,
                    MinWidth: 0,
                    Overflow: Overflow.Hidden,
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
                            outgoing ? AppTheme.Pink: AppTheme.Mint,
                            AppTheme.Dim
                        )
                    },
                    Grow(
                        Label(ui, Hidden(input.Privacy, SafeText(item.Label, 512)), AppTheme.Type13, AppTheme.Dim, "")
                    ),
                    Container{
                        Width: input.Width < 1200 ? 110.0: 160.0,
                        AlignItems: AlignItems.FlexEnd,
                        Label(
                            ui,
                            item.Status == "mempool" ? ui.Strings.Get("mempool"): item.Status,
                            AppTheme.Type11,
                            item.Status == "mempool" ? AppTheme.Blue: item.Ready ? AppTheme.Lime: AppTheme.Orange,
                            ""
                        )
                    },
                    Container{
                        Width: 60,
                        AlignItems: AlignItems.FlexEnd,
                        Label(ui, item.Timestamp > 0 ? Clock(item.Timestamp): "-", AppTheme.Type12, AppTheme.Dim, "")
                    }
                }
            )
        }
        card.Add(ListParts.Viewport(rows))
        return card
    }
}
