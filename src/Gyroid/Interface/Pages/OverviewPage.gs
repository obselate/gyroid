package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.History
import Gyroid.Node
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Globalization
import System.Linq
import System.Threading.Tasks

data struct OverviewInput {
    var Ui Presentation
    var Session WalletSession
    var Window Window?
    var Snapshot WalletSnapshot
    var Node NodeStatus
    var Contacts SortedDictionary[string, string]
    var Privacy bool
    var Height float64
    var OnNavigate Action[string]
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
}

data struct Activity {
    var Kind string
    var Amount uint64
    var Label string
    var Status string
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
    private let track Color = Color.Parse("#1a1a1a")
    private let times Dictionary[uint64, int64] = Dictionary[uint64, int64]()
    private let requested HashSet[uint64] = HashSet[uint64]()
    private var fetching bool
    private var failedSnapshot WalletSnapshot? = nil

    init() {
        hero.MetricsChanged += _ -> if hero.BorderBox.Width != heroWidth {
            Rebuild()
        }
        strip.MetricsChanged += _ -> if strip.BorderBox.Width != stripWidth {
            Rebuild()
        }
    }

    protected override func Build(input OverviewInput) Blob {
        heroWidth = hero.BorderBox.Width
        stripWidth = strip.BorderBox.Width
        let ui = input.Ui
        let snapshot = input.Snapshot
        let chain = snapshot.Balance?.ChainHeight ?? input.Node.Height
        RequestTimes(input)
        let arrivals = Arrivals(input, chain)
        let left = Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, MinHeight: 0, Gap: 12, Hero(input, arrivals)}
        if arrivals.Count > 0 {
            left.Add(Incoming(input, arrivals))
        }
        let page = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, Gap: 12}
        if input.Node.UpgradeDate.Length > 0 {
            page.Add(Upgrade(input))
        }
        page.Add(
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                FlexDirection: FlexDirection.Row,
                Gap: 12,
                left,
                Recent(input, chain)
            }
        )
        return page
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
        FetchTimes(window, input.Session.History, input.Snapshot, missing)
    }

    private async func FetchTimes(window Window, history HistoryService, snapshot WalletSnapshot, heights[]uint64) {
        var fetched = Dictionary[uint64, int64]()
        var failed = false
        try {
            fetched = await Task.Run(() -> history.BlockTimesAsync(heights))
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
        for (name, destination) in input.Contacts {
            if value.Recipients.Any((recipient WalletRecipient) -> recipient.Address == destination) {
                return name
            }
        }
        return value
            .Recipients
            .Select((recipient WalletRecipient) -> recipient.Memo)
            .FirstOrDefault((memo string) -> memo.Length > 0) ??
            ""
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
        for output in input.Snapshot.History {
            let required = output.Coinbase ? uint64(60): uint64(10)
            let confirmations = chain > output.BlockHeight ? chain - output.BlockHeight: uint64(0)
            if output.Spent || output.BlockHeight == 0 || confirmations >= required {
                continue
            }
            listed += output.Amount
            arrivals.Add(
                Arrival{
                    Kind: output.Coinbase ? "mined": "in",
                    Amount: output.Amount,
                    Source: if output.Coinbase {
                        ui.Strings.Get("mined") + " · " + ui.Strings.Get("block") + " " + ui.Count(output.BlockHeight)
                    } else if output.Memo.Length > 0 {
                        output.Memo
                    } else {
                        Short(output.TxId)
                    },
                    Confirmations: confirmations,
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
                    Amount: confirming - listed,
                    Source: Change(input, send),
                    Confirmations: send.Confirmations,
                    Required: 10,
                    Blocks: 10 - send.Confirmations,
                    TxId: ""
                }
            )
        }
        if balance.Unconfirmed > 0 {
            arrivals.Add(
                Arrival{
                    Kind: "pool",
                    Amount: balance.Unconfirmed,
                    Source: Change(
                        input,
                        input.Snapshot.Sends.FirstOrDefault((item WalletSend) -> item.Status == "mempool")
                    ),
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
            return ui.Label("••••••••", 14, fraction, "")
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
            ui.Label(ui.Strings.Get(label) + " ›", 12, ui.Lime, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Header(ui Presentation, label string) Container -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 8,
        Height: 24,
        FlexShrink: 0,
        Margin: Edges{Bottom: 4},
        ui.Label(ui.Strings.Get(label), 12, ui.Body, "")
    }

    private func Card(ui Presentation) Container {
        let card = ui.Glass()
        card.Padding = Edges{Top: 12, Bottom: 12, Left: 16, Right: 16}
        card.Gap = 0
        card.Overflow = Overflow.Hidden
        return card
    }

    private func Upgrade(input OverviewInput) Blob {
        let ui = input.Ui
        let node = input.Node
        let bar = ui.Glass()
        bar.FlexShrink = 0
        bar.FlexDirection = FlexDirection.Row
        bar.AlignItems = AlignItems.Center
        bar.Gap = 14
        bar.Height = 40
        bar.Padding = Edges{Top: 0, Bottom: 0, Left: 16, Right: 10}
        bar.Add(ui.Label(ui.Strings.Get("Network upgrade") + " " + node.UpgradeDate, 12, ui.Body, ""))
        bar.Add(
            Container{
                Handle: strip,
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                if stripWidth > 0 {
                    ui.UpgradeTimeline(node, stripWidth)
                } else {
                    Container{}
                }
            }
        )
        bar.Add(ui.Label(ui.Count(node.UpgradeBlocksLeft) + " " + ui.Strings.Get("blocks"), 14, ui.Ink, ""))
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
            ui.Strings.Get(scanning ? "Scanning": "Unavailable")
        }
        let color = if scanning {
            ui.Orange
        } else if masked || !known || total == 0 {
            ui.Dim
        } else {
            ui.Lime
        }
        let inner = Math.Max(0.0, heroWidth - 40)
        let size = if masked {
            34.0
        } else {
            Math.Clamp(Math.Min(input.Height * 0.12, inner * 1.53 / value.Length), 34, 150)
        }
        let card = ui.Glass()
        card.Handle = hero
        card.FlexGrow = 1
        card.Padding = Edges{Top: 16, Bottom: 16, Left: 20, Right: 20}
        card.Gap = 14
        if peeking {
            card.BorderColor = Color.Parse("#3a3a3a")
        }
        let header = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            FlexShrink: 0,
            ui.Grow(ui.Label(ui.Strings.Get("balance"), 12, ui.Body, ""))
        }
        if input.Privacy {
            let press = (event PointerEvent) -> if !event.IsFromInteractiveChild {
                event.Capture()
                peeking = true
                Rebuild()
            }
            header.Height = 28
            header.Add(ui.Label(ui.Strings.Get(peeking ? "release to hide": "hold to show"), 12, ui.Dim, ""))
            header.Add(
                Container{
                    Width: 28,
                    Height: 28,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    BorderWidth: 1,
                    BorderRadius: 6,
                    BorderColor: peeking ? ui.Lime: ui.Edge,
                    BackgroundColor: peeking ? Color.Parse("#121906"): Color.Transparent,
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
                        ui.Strings.Get("balance") + " " + ui.Money(total) + " BNT"
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
            figure.Add(ui.Label("BNT", 16, ui.Body, ""))
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
                    ui.Strings.Get("ready") + " " + ui.Money(ready) + ", " + ui.Strings.Get("confirming") +
                        " " +
                        ui.Money(confirming) + ", " + ui.Strings.Get("in mempool") + " " + ui.Money(unconfirmed)
                }
            }
        }
        if masked || total == 0 {
            bar.Add(Container{FlexGrow: 1, Height: height, BorderRadius: 2, BackgroundColor: track})
        } else {
            if ready > 0 {
                bar.Add(Segment(ready, height, ui.Lime))
            }
            if confirming > 0 {
                let segment = Segment(confirming, hovering ? height + 6: height, ui.Orange)
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
                bar.Add(Segment(unconfirmed, height, ui.Blue))
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
                    BackgroundColor: Color.Parse("#0b0b0b"),
                    BorderWidth: 1,
                    BorderColor: Color.Parse("#333333"),
                    BorderRadius: 6,
                    BoxShadows: []BoxShadow{BoxShadow{OffsetY: 10, Blur: 28, Color: ui.Black}},
                    Reading(ui, "confirming", Fixed(confirming)),
                    Reading(ui, "outputs", outputs.ToString()),
                    Reading(ui, "all ready", Wait(input, last))
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

    private func Segment(units uint64, height float64, color Color) Container -> Container{
        FlexGrow: float64(units) / 100000000,
        FlexBasis: 0,
        MinWidth: 14,
        Height: height,
        BorderRadius: 2,
        BackgroundColor: color
    }

    private func Reading(ui Presentation, label string, value string) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        Gap: 8,
        ui.Label(ui.Strings.Get(label), 12, ui.Body, ""),
        ui.Label(value, 12, ui.Ink, "")
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
                ui.Label(ui.Strings.Get(label), 12, ui.Body, "")
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
                        ui.Money(units)
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
                BackgroundColor: Color.Parse("#0b0b0b"),
                BorderColor: Color.Parse("#333333"),
                TakeFocus: false,
                AccessibilityName: ui.Strings.Get("About confirming"),
                Content: Container{
                    Gap: 4,
                    ui.Label(ui.Strings.Get("Received: 10 blocks."), 12, ui.Body, ""),
                    ui.Label(ui.Strings.Get("Mined: 60 blocks."), 12, ui.Body, ""),
                    ui.Label(ui.Strings.Get("Mempool: change from your send."), 12, ui.Body, ""),
                    ui.Label(ui.Strings.Get("1 block ≈ 5 min."), 12, ui.Body, "")
                },
                OnDismiss: reason -> {
                    infoOpen = false
                    Rebuild()
                }
            }
        )
    }

    private func Incoming(input OverviewInput, arrivals List[Arrival]) Blob {
        let ui = input.Ui
        let card = Card(ui)
        card.FlexShrink = 1
        card.MaxHeight = Percent(62)
        let header = Header(ui, "incoming")
        header.Add(ui.Label(arrivals.Count.ToString(), 14, ui.Dim, ""))
        header.Add(Container{FlexGrow: 1})
        header.Add(ui.Label(ui.Strings.Get("all ready"), 12, ui.Body, ""))
        header.Add(ui.Label(Wait(input, arrivals.Max((item Arrival) -> item.Blocks)), 14, ui.Ink, ""))
        card.Add(header)
        let rows = Container{FlexShrink: 1, MinHeight: 0, Overflow: Overflow.Scroll, ScrollbarY: Theme.Read().Scrollbar}
        for index in 0 ... arrivals.Count {
            rows.Add(Arrive(input, arrivals[index], index == arrivals.Count - 1))
        }
        card.Add(rows)
        return card
    }

    private func Fade(color Color, faded bool) Color -> if faded {
        Color.FromNormalized(color.R * 0.3F + 0.014F, color.G * 0.3F + 0.014F, color.B * 0.3F + 0.014F, 1F)
    } else {
        color
    }

    private func Arrive(input OverviewInput, item Arrival, last bool) Blob {
        let ui = input.Ui
        let faded = hovering && item.Kind == "pool"
        let key = item.TxId + ":" + item.Height.ToString()
        let unfolded = item.TxId.Length > 0 && expanded == key
        let glyph Blob = switch item.Kind {
            case "mined": ui.Label("◆", 14, Fade(ui.Violet, faded), "")
            case "in": ui.Label("↓", 14, Fade(ui.Mint, faded), "")
            default: MaterialIcons.Create("replay", 14, Fade(ui.Blue, faded))
        }
        let row = Goo
            .Button{
            FlexDirection: FlexDirection.Column,
            AlignItems: AlignItems.Stretch,
            JustifyContent: JustifyContent.FlexStart,
            Gap: 6,
            Padding: Edges{Top: 9, Bottom: 9},
            FlexShrink: 0,
            BorderWidth: Edges{Bottom: last ? 0.0: 1.0},
            BorderColor: ui.Rule,
            BackgroundColor: Color.Transparent,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: item.Source + " " + Wait(input, item.Blocks),
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
                Number(ui, input.Privacy, Fixed(item.Amount), Fade(ui.Ink, faded), Fade(ui.Dim, faded)),
                ui.Grow(ui.Label(item.Source, 13, Fade(ui.Dim, faded), "")),
                Container{
                    Width: 76,
                    AlignItems: AlignItems.FlexEnd,
                    ui.Label(Wait(input, item.Blocks), 14, Fade(ui.Ink, faded), "")
                }
            },
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 12,
                Container{Width: 16},
                ui.Grow(
                    Container{
                        Height: 4,
                        BorderRadius: 2,
                        Overflow: Overflow.Hidden,
                        BackgroundColor: Fade(track, faded),
                        Container{
                            Width: Percent(100.0 * item.Confirmations / item.Required),
                            Height: 4,
                            BackgroundColor: Fade(ui.Orange, faded)
                        }
                    }
                ),
                Container{
                    Width: 76,
                    AlignItems: AlignItems.FlexEnd,
                    if item.Kind == "pool" {
                        ui.Label(ui.Strings.Get("mempool"), 12, Fade(ui.Blue, faded), "")
                    } else {
                        ui.Label(
                            item.Confirmations.ToString() + "/" + item.Required.ToString(),
                            12,
                            Fade(ui.Dim, faded),
                            ""
                        )
                    }
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
                    Detail(ui, ui.Strings.Get("block"), ui.Count(item.Height)),
                    Detail(ui, "tx", Short(item.TxId).Substring(3)),
                    Detail(ui, ui.Strings.Get("ready at"), ready),
                    Container{FlexGrow: 1},
                    Link(ui, "history", () -> input.OnNavigate("Transactions"))
                }
            )
        }
        return row
    }

    private func Detail(ui Presentation, label string, value string) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        Gap: 6,
        ui.Label(label, 12, ui.Dim, ""),
        ui.Label(value, 12, ui.Ink, "")
    }

    private func Activities(input OverviewInput, chain uint64) List[Activity] {
        let ui = input.Ui
        let snapshot = input.Snapshot
        let items = List[Activity]()
        for output in snapshot.History.Take(50) {
            let required = output.Coinbase ? uint64(60): uint64(10)
            let confirmations = chain > output.BlockHeight ? chain - output.BlockHeight: uint64(0)
            items.Add(
                Activity{
                    Kind: output.Coinbase ? "mined": "in",
                    Amount: output.Amount,
                    Label: if output.Memo.Length > 0 {
                        output.Memo
                    } else if output.Coinbase {
                        ui.Strings.Get("block") + " " + ui.Count(output.BlockHeight)
                    } else {
                        Short(output.TxId)
                    },
                    Status: if output.BlockHeight == 0 {
                        "mempool"
                    } else if confirmations < required {
                        confirmations.ToString() + "/" + required.ToString()
                    } else {
                        ""
                    },
                    Order: output.BlockHeight == 0 ? uint64.MaxValue: output.BlockHeight,
                    Timestamp: times.GetValueOrDefault(output.BlockHeight)
                }
            )
        }
        for send in snapshot.Sends.Take(50) {
            let label = Contact(input, send)
            items.Add(
                Activity{
                    Kind: "out",
                    Amount: send.Amount,
                    Label: label.Length > 0 ? label: Short(send.TxId),
                    Status: send.Status == "not_found" ? ui.Strings.Get(
                        "not found"
                    ): send.Status == "mempool" ? "mempool": "",
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

    private func Recent(input OverviewInput, chain uint64) Blob {
        let ui = input.Ui
        let card = Card(ui)
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.MinWidth = 0
        let header = Header(ui, "recent")
        header.Add(Container{FlexGrow: 1})
        header.Add(Link(ui, "history", () -> input.OnNavigate("Transactions")))
        card.Add(header)
        let activities = Activities(input, chain)
        if activities.Count == 0 {
            card.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Height: 40,
                    ui.Grow(ui.Label(ui.Strings.Get("no transactions yet"), 14, ui.Dim, "")),
                    Link(ui, "receive", () -> input.OnNavigate("Receive"))
                }
            )
            return card
        }
        let height = Math.Clamp(input.Height * 0.05, 34, 44)
        let rows = Container{FlexGrow: 1, MinHeight: 0, Overflow: Overflow.Scroll, ScrollbarY: Theme.Read().Scrollbar}
        for item in activities {
            let outgoing = item.Kind == "out"
            let shown = input.Privacy ? ui.Strings.Get("Amounts hidden"): ui.Money(item.Amount)
            rows.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 12,
                    Height: height,
                    FlexShrink: 0,
                    BorderWidth: Edges{Bottom: 1},
                    BorderColor: ui.Rule,
                    Accessibility: Accessibility{
                        Name: ui.Strings.Get(outgoing ? "sent": "received") + " " + shown + " " + item.Label
                    },
                    Container{
                        Width: 16,
                        AlignItems: AlignItems.Center,
                        ui.Label(
                            outgoing ? "↑": item.Kind == "mined" ? "◆": "↓",
                            14,
                            outgoing ? ui.Pink: item.Kind == "mined" ? ui.Violet: ui.Mint,
                            ""
                        )
                    },
                    Number(
                        ui,
                        input.Privacy,
                        (outgoing ? "-": "+") + Fixed(item.Amount),
                        outgoing ? ui.Pink: ui.Mint,
                        ui.Dim
                    ),
                    ui.Grow(ui.Label(item.Label, 13, ui.Dim, "")),
                    ui.Label(
                        item.Status == "mempool" ? ui.Strings.Get("mempool"): item.Status,
                        12,
                        item.Status == "mempool" ? ui.Blue: ui.Orange,
                        ""
                    ),
                    Container{
                        Width: 44,
                        AlignItems: AlignItems.FlexEnd,
                        ui.Label(item.Timestamp > 0 ? ui.Clock(item.Timestamp): "-", 12, ui.Dim, "")
                    }
                }
            )
        }
        card.Add(rows)
        return card
    }
}
