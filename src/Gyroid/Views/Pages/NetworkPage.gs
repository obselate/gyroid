package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Navigation
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.NetworkParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Globalization
import System.Threading
import System.Threading.Tasks

data struct NetworkInput {
    var Ui Presentation
    var Session WalletSession
    var Window Window?
    var Node NodeStatus
    var History[]WalletOutput
    var Sends[]WalletSend
    var Clipboard[]char
    var Language string
    var Width float64
    var Height float64
}

class NetworkPage : Cell, IDisposable {
    private var input NetworkInput
    private var report NetworkReport = NetworkReport()
    private var loaded NodeStatus? = nil
    private var source WalletSession? = nil
    private var wallet string = ""
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var request CancellationTokenSource? = nil
    private var generation int32
    private var failed bool

    public func Accept(input NetworkInput) {
        let changed = this.input != input
        this.input = input
        if source == input.Session && loaded == input.Node && wallet == input.Session.Settings.ActiveWallet {
            if changed {
                Rebuild()
            }
            return
        }
        source = input.Session
        loaded = input.Node
        wallet = input.Session.Settings.ActiveWallet
        generation++
        request?.Cancel()
        request?.Dispose()
        request = nil
        report = input.Session.Node.Network
        failed = false
        if input.Node.Running {
            let current = CancellationTokenSource.CreateLinkedTokenSource(
                lifetime.Token,
                input.Window?.Closed ?? CancellationToken.None
            )
            request = current
            go Load(input.Session.Node, input.Window, generation, current.Token)
        }
        Rebuild()
    }

    override func Build() Blob {
        let input = this.input
        let page = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, Width: Percent(100), Gap: AppTheme.Space12}
        if failed {
            page.Add(
                Banner{
                    Tone: Tone.Danger,
                    Content: input.Ui.Strings.Get("Refresh failed"),
                    FontFamily: AppTheme.Font
                }.Build()
            )
        }
        page.Add(
            Cell.Mount[NetworkSummaryInput, NetworkSummary](
                "network-summary",
                NetworkSummaryInput{
                    Ui: input.Ui,
                    Height: input.Height,
                    ChainHeight: input.Node.Height,
                    Mempool: input.Node.Mempool,
                    MempoolBytes: input.Node.MempoolBytes,
                    Language: input.Language,
                    Hashrate: report.Hashrate,
                    Difficulty: report.Difficulty,
                    Emitted: report.Emitted,
                    PreviousDifficulty: report.Blocks.Length > 0 ? report.Blocks[report.Blocks.Length - 1].Difficulty: 0
                }
            )
        )
        page.Add(
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                FlexDirection: FlexDirection.Row,
                Gap: AppTheme.Space12,
                Cell.Mount[NetworkBlocksInput, NetworkBlocks](
                    "network-blocks",
                    NetworkBlocksInput{
                        Ui: input.Ui,
                        Blocks: report.Blocks,
                        History: input.History,
                        Sends: input.Sends,
                        Clipboard: input.Clipboard,
                        Language: input.Language,
                        Height: input.Height
                    }
                ),
                Cell.Mount[NetworkPeersInput, NetworkPeers](
                    "network-peers",
                    NetworkPeersInput{
                        Ui: input.Ui,
                        Peers: report.Peers,
                        Banned: report.Banned,
                        PeerId: input.Node.PeerId,
                        IdentityAge: input.Node.IdentityAge,
                        Clipboard: input.Clipboard,
                        Width: input.Width,
                        Language: input.Language
                    }
                )
            }
        )
        return page
    }

    public func Dispose() {
        generation++
        lifetime.Cancel()
        request?.Dispose()
        lifetime.Dispose()
    }

    private async func Load(node NodeSession, window Window?, id int32, token CancellationToken) {
        try {
            while !token.IsCancellationRequested {
                var result NetworkReport? = nil
                try {
                    result = await node.ReadNetworkAsync(token)
                } catch (failure OperationCanceledException) when token.IsCancellationRequested {
                    return
                } catch (failure Exception) { }
                if token.IsCancellationRequested {
                    return
                }
                window?.TryPost(
                    () -> {
                        if id != generation {
                            return
                        }
                        let changed = failed != (result == nil) || result != nil && report != result
                        failed = result == nil
                        if let value = result {
                            report = value
                        }
                        if changed {
                            Rebuild()
                        }
                    }
                )
                if result != nil {
                    return
                }
                await Task.Delay(5000, token)
            }
        } catch (failure OperationCanceledException) when token.IsCancellationRequested { } catch (failure Exception) {
            Console.Error.WriteLine("Network background task failed: " + failure.GetType().Name)
        }
    }
}

data struct NetworkSummaryInput {
    var Ui Presentation
    var ChainHeight uint64
    var Mempool uint64
    var MempoolBytes uint64
    var Language string
    var Height float64
    var Hashrate float64
    var Difficulty uint64
    var PreviousDifficulty uint64
    var Emitted float64
}

class NetworkSummary : Cell[NetworkSummaryInput] {
    protected override func Build(input NetworkSummaryInput) Blob {
        let ui = input.Ui
        let change = input.PreviousDifficulty > 0 ? (
            float64(input.Difficulty) / input.PreviousDifficulty - 1
        ) * 100: 0.0
        let figures = WalletParts.Card(
            ui,
            Edges{Left: AppTheme.Space22, Right: AppTheme.Space22, Top: AppTheme.Space14, Bottom: AppTheme.Space14},
            AppTheme.Space20,
            AppTheme.Radius14
        )
        figures.FlexDirection = FlexDirection.Row
        figures.FlexShrink = 0
        figures.Add(Figure(input, "Height", Count(input.ChainHeight), ""))
        figures.Add(Figure(input, "Hashrate", Rate(input.Hashrate), Unit(input.Hashrate)))
        figures.Add(
            Figure(
                input,
                "Difficulty",
                Compact(input.Difficulty),
                change == 0 ? "": (change > 0 ? "▲ ": "▼ ") + Math.Abs(change).ToString(
                    "0.0",
                    CultureInfo.InvariantCulture
                ) +
                    "%"
            )
        )
        figures.Add(
            Figure(
                input,
                "Mempool",
                input.Mempool.ToString(),
                ui.Strings.Get("tx") + " · " + (input.MempoolBytes / 1000.0).ToString(
                    "0.0",
                    CultureInfo.InvariantCulture
                ) +
                    " KB"
            )
        )
        figures.Add(Figure(input, "Emitted", input.Emitted.ToString("0.0", CultureInfo.InvariantCulture), "%"))
        return figures
    }

    private func Figure(input NetworkSummaryInput, label string, value string, unit string) Blob ->
    TextParts.Figure(input.Ui, label, value, unit, AppTheme.GetFigureSize(input.Height), AppTheme.Ink)
}

data struct NetworkBlocksInput {
    var Ui Presentation
    var Blocks[]NetworkBlock
    var History[]WalletOutput
    var Sends[]WalletSend
    var Clipboard[]char
    var Language string
    var Height float64
}

data struct NetworkChartInput {
    var Ui Presentation
    var Blocks[]NetworkBlock
    var Language string
    var Height float64
    var Selected uint64
    var Select Action[uint64]
}

data struct NetworkRibbonInput {
    var Chart NetworkChartInput
    var History[]WalletOutput
    var Sends[]WalletSend
    var Clipboard[]char
}

class NetworkBlocks : Cell[NetworkBlocksInput] {
    private var selected uint64
    private let chooseBlock Action[uint64]

    init() {
        chooseBlock = Select
    }

    protected override func Build(input NetworkBlocksInput) Blob {
        let chart = NetworkChartInput{
            Ui: input.Ui,
            Blocks: input.Blocks,
            Language: input.Language,
            Height: input.Height,
            Selected: selected,
            Select: chooseBlock
        }
        return Container{
            FlexGrow: 1.32,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: 0,
            Gap: AppTheme.Space12,
            Cell.Mount[NetworkChartInput, NetworkTimeChart]("network-times", chart),
            Cell.Mount[NetworkRibbonInput, NetworkRibbon](
                "network-ribbon",
                NetworkRibbonInput{Chart: chart, History: input.History, Sends: input.Sends, Clipboard: input.Clipboard}
            )
        }
    }

    private func Select(height uint64) {
        if selected != height {
            selected = height
            Rebuild()
        }
    }
}

class NetworkTimeChart : Cell[NetworkChartInput] {
    private let timePlot ElementHandle = ElementHandle()

    init() {
        timePlot.MetricsChanged += _ -> Rebuild()
    }

    protected override func Build(input NetworkChartInput) Blob {
        let blocks = input.Blocks
        let average = blocks.Length > 1 ? float64(blocks[blocks.Length - 1].Timestamp - blocks[0].Timestamp) / (
            blocks.Length - 1
        ): 0.0
        let card = WalletParts.Card(
            input.Ui,
            Edges{Left: AppTheme.Space16, Right: AppTheme.Space16, Top: AppTheme.Space14, Bottom: AppTheme.Space12},
            AppTheme.Space8,
            AppTheme.Radius14
        )
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.Add(
            NetworkHeading.Build(
                input,
                "Block time",
                "time",
                Duration(int64(average)),
                Cell.Mount[InfoTipInput, InfoTip](
                    "time-info",
                    InfoTipInput{
                        Ui: input.Ui,
                        Topic: "About block time",
                        Lines: []string{
                            "Each bar is one of the last 60 blocks, measured from the 5:00 target. Orange took longer, blue was faster. Difficulty adjusts over these 60 blocks."
                        },
                        Language: input.Language,
                        Width: 300
                    }
                )
            )
        )
        card.Add(NetworkParts.TimeChart(input.Ui, blocks, timePlot, input.Selected, input.Select))
        return card
    }
}

class NetworkHeading {
    shared {
        func Build(input NetworkChartInput, label string, key string, value string, trailing Blob) Blob ->
        WalletParts.Header(
            Label(input.Ui, input.Ui.Strings.Get(label), AppTheme.Type13, AppTheme.Body, ""),
            AppTheme.Space8,
            trailing,
            TextParts.Value(
                input.Ui,
                key,
                input.Ui.Strings.Get(label) + " " + value,
                value,
                AppTheme.GetSecondaryFigureSize(input.Height),
                AppTheme.Ink
            )
        )
    }
}

class NetworkRibbon : Cell[NetworkRibbonInput] {
    private let ribbonPlot ElementHandle = ElementHandle()

    init() {
        ribbonPlot.MetricsChanged += _ -> Rebuild()
    }

    protected override func Build(input NetworkRibbonInput) Blob {
        let chart = input.Chart
        let blocks = chart.Blocks
        let tip = blocks.Length > 0 ? blocks[blocks.Length - 1]: NetworkBlock()
        let shown = chart.Selected > 0 && Array.Exists(blocks, block -> block.Height == chart.Selected) ?
        Array.Find(blocks, block -> block.Height == chart.Selected): tip
        let card = WalletParts.Card(
            chart.Ui,
            Edges{Left: AppTheme.Space16, Right: AppTheme.Space16, Top: AppTheme.Space14, Bottom: AppTheme.Space12},
            AppTheme.Space8,
            AppTheme.Radius14
        )
        card.FlexGrow = 1.15
        card.FlexBasis = 0
        card.Add(
            NetworkHeading.Build(
                chart,
                "Last block",
                "last",
                tip.Timestamp > 0 ? Clock(tip.Timestamp): "-",
                Container{}
            )
        )
        card.Add(Ribbon(input, tip))
        card.Add(Details(input, shown, tip))
        return card
    }

    private func Ribbon(input NetworkRibbonInput, tip NetworkBlock) Blob {
        let ui = input.Chart.Ui
        let blocks = input.Chart.Blocks
        let plot = Container{
            Handle: ribbonPlot,
            FlexGrow: 1,
            MinHeight: 0,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: ui.Strings.Get("blocks of the last 2 hours")
            },
            OnPointerLeave: (event PointerEvent) -> input.Chart.Select(0)
        }
        let width = ribbonPlot.BorderBox.Width - 4
        let height = ribbonPlot.BorderBox.Height
        if blocks.Length < 2 || width <= 50 || height <= 50 {
            return plot
        }
        let bottom = height - 20
        var most = 6.0
        for block in blocks {
            if tip.Timestamp - block.Timestamp < 7200 {
                most = Math.Max(most, float64(block.Transactions))
            }
        }
        let unit = (bottom - 34) / most
        for seconds in 0 ... 25 {
            let left = Offset(seconds * 300, width)
            plot.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: left,
                    Top: bottom + 3,
                    Width: 1,
                    Height: seconds % 12 == 0 ? 6.0: 3.0,
                    BackgroundColor: seconds % 12 == 0 ? AppTheme.Dim: AppTheme.StrongRule
                }
            )
        }
        plot.Add(Rule(2, bottom, width, AppTheme.Edge))
        plot.Add(Place(2, height - 13, Label(ui, ui.Strings.Get("−2h"), AppTheme.Type11, AppTheme.Dim, "")))
        plot.Add(
            Place(
                Offset(3600, width) - 12,
                height - 13,
                Label(ui, ui.Strings.Get("−1h"), AppTheme.Type11, AppTheme.Dim, "")
            )
        )
        plot.Add(
            Container{
                Position: PositionType.Absolute,
                Right: 2,
                Top: height - 13,
                Label(ui, Clock(tip.Timestamp), AppTheme.Type11, AppTheme.Dim, "")
            }
        )
        for index in 1 ... blocks.Length {
            let block = blocks[index]
            let age = float64(tip.Timestamp - block.Timestamp)
            let right = Offset(age, width)
            let start = Math.Max(2.0, Offset(age + float64(block.Timestamp - blocks[index - 1].Timestamp), width)) + 1
            if right <= 2 {
                continue
            }
            let span = Math.Max(3.0, right - start - 1.5)
            let rise = 8 + float64(block.Transactions) * unit
            let confirmations = tip.Height - block.Height + 1
            let pending = confirmations < 10
            let chosen = block.Height == input.Chart.Selected
            plot.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: start,
                    Top: bottom - rise,
                    Width: span,
                    Height: rise,
                    OnPointerEnter: (event PointerEvent) -> input.Chart.Select(block.Height),
                    Shape{
                        Width: span,
                        Height: rise,
                        Path: PathBuilder(0, 0, span, rise)
                            .MoveTo(0, 0)
                            .LineTo(span, 0)
                            .LineTo(span, rise)
                            .LineTo(0, rise)
                            .Close()
                            .Build(),
                        Fit: ShapeFit.Fill,
                        CornerRadius: 2,
                        BackgroundColor: if chosen {
                            pending ? AppTheme.OrangeMuted: AppTheme.LimeMuted
                        } else {
                            pending ? AppTheme.OrangeQuiet: AppTheme.LimeQuiet
                        },
                        BorderWidth: chosen ? 1.4: AppTheme.Border1,
                        BorderColor: if chosen {
                            AppTheme.Ink
                        } else {
                            pending ? AppTheme.OrangeStrong: AppTheme.LimeStrong
                        },
                        Dashes: pending && !chosen ? DashPattern([]float64{3, 2}, 0): nil
                    }
                }
            )
            if let mine = Own(input, block.Height, tip.Height) {
                plot.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Left: start + span / 2 - 3.2,
                        Top: bottom - rise - 10.2,
                        Width: 6.4,
                        Height: 6.4,
                        BorderRadius: 3.2,
                        HitTestSelf: false,
                        BackgroundColor: mine
                    }
                )
            }
            if confirmations == 10 {
                plot.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Left: right,
                        Top: AppTheme.Space22,
                        Width: 1,
                        Height: bottom - AppTheme.Space22,
                        HitTestSelf: false,
                        BackgroundColor: AppTheme.OrangeStrong
                    }
                )
                plot.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Right: AppTheme.Space4,
                        Top: AppTheme.Space2,
                        Label(ui, ui.Strings.Get("10 conf"), AppTheme.Type11, AppTheme.Orange, "")
                    }
                )
            }
        }
        return plot
    }

    private func Offset(age float64, width float64) float64 -> 2 + width * (1 - age / 7200)

    private func Own(input NetworkRibbonInput, height uint64, tip uint64) Color? {
        for output in input.History {
            if output.BlockHeight == height {
                return AppTheme.Mint
            }
        }
        for send in input.Sends {
            if send.Confirmations > 0 && tip + 1 - send.Confirmations == height {
                return AppTheme.Orange
            }
        }
        return nil
    }

    private func Details(input NetworkRibbonInput, block NetworkBlock, tip NetworkBlock) Blob {
        let ui = input.Chart.Ui
        let row = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space16,
            Height: AppTheme.ControlCompact,
            FlexShrink: 0,
            Overflow: Overflow.Hidden,
            Accessibility: Accessibility{Live: AccessibilityLive.Polite}
        }
        if block.Hash.Length == 0 {
            return row
        }
        let index = Array.FindIndex(input.Chart.Blocks, item -> item.Height == block.Height)
        let confirmations = tip.Height - block.Height + 1
        row.Add(Label(ui, "#" + Count(block.Height), AppTheme.Type13, AppTheme.Lime, ""))
        row.Add(Label(ui, Clock(block.Timestamp), AppTheme.Type13, AppTheme.Body, ""))
        if index > 0 {
            row.Add(
                KeyValue(
                    ui,
                    ui.Strings.Get("took"),
                    Duration(block.Timestamp - input.Chart.Blocks[index - 1].Timestamp),
                    AppTheme.Space6,
                    AppTheme.Dim,
                    AppTheme.Body,
                    AppTheme.Type13
                )
            )
        }
        row.Add(
            Label(ui, block.Transactions.ToString() + " " + ui.Strings.Get("tx"), AppTheme.Type13, AppTheme.Body, "")
        )
        row.Add(
            Label(
                ui,
                confirmations.ToString() + " " + ui.Strings.Get("conf"),
                AppTheme.Type13,
                confirmations < 10 ? AppTheme.Orange: AppTheme.Body,
                ""
            )
        )
        let copied = ReadOnlySpan[char](ui.Actions.ClipboardText).SequenceEqual(
            System.MemoryExtensions.AsSpan(block.Hash)
        )
        row.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space2,
                Label(
                    ui,
                    block.Hash.Substring(0, 6) + "…" + block.Hash.Substring(block.Hash.Length - 4),
                    AppTheme.Type13,
                    AppTheme.Dim,
                    ""
                ),
                ControlParts.Icon(
                    ui,
                    MaterialIcons.Create(
                        copied ? "check": "content_copy",
                        AppTheme.Icon14,
                        copied ? AppTheme.Lime: AppTheme.Dim
                    ),
                    ui.Strings.Get("copy hash"),
                    () -> {
                        ui.Actions.Copy(block.Hash, 120000)
                    },
                    size: AppTheme.ControlCompact,
                    style: AppTheme.DisclosureStyle
                )
            }
        )
        return row
    }
}

data struct NetworkPeersInput {
    var Ui Presentation
    var Peers[]NetworkPeer
    var Banned[]BannedPeer
    var PeerId string
    var IdentityAge string
    var Clipboard[]char
    var Width float64
    var Language string
}

class NetworkPeers : Cell[NetworkPeersInput] {
    private var tab string = "peers"
    private var hovered string = ""
    private var revealed bool
    private let peerMap ElementHandle = ElementHandle()

    init() {
        peerMap.MetricsChanged += _ -> Rebuild()
    }

    protected override func Build(input NetworkPeersInput) Blob {
        let ui = input.Ui
        let card = WalletParts.Card(
            ui,
            Edges{Left: AppTheme.Space14, Right: AppTheme.Space14, Top: AppTheme.Space12, Bottom: AppTheme.Space12},
            AppTheme.Space8,
            AppTheme.Radius14
        )
        card.FlexGrow = 1
        card.FlexBasis = 0
        let tabs = ControlParts.Tabs(
            ui,
            "peer-tabs",
            ui.Strings.Get("peers"),
            []NavigationItem{
                NavigationItem{Id: "peers", Label: ui.Strings.Get("peers") + " " + input.Peers.Length.ToString()},
                NavigationItem{Id: "banned", Label: ui.Strings.Get("banned") + " " + input.Banned.Length.ToString()}
            },
            tab,
            value -> {
                tab = value
                Rebuild()
            }
        )
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                FlexShrink: 0,
                tabs,
                Cell.Mount[InfoTipInput, InfoTip](
                    "peers-info",
                    InfoTipInput{
                        Ui: ui,
                        Topic: "About peers",
                        Lines: []string{
                            "Peers are the nodes your core is connected to now. The core reports each peer's ID and address. Banned peers sent invalid data and are refused until the ban ends."
                        },
                        Language: input.Language,
                        Width: 300
                    }
                )
            }
        )
        card.Add(Map(input))
        var tcp = 0
        for peer in input.Peers {
            if peer.Transport != "quic" {
                tcp++
            }
        }
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.Center,
                Gap: AppTheme.Space16,
                FlexShrink: 0,
                Legend(ui, "tcp", tcp, AppTheme.Blue),
                Legend(ui, "quic", input.Peers.Length - tcp, AppTheme.Mint),
                Legend(ui, "banned", input.Banned.Length, AppTheme.Pink)
            }
        )
        let list = Container{
            FlexShrink: 1,
            MinHeight: 0,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Theme.Read().Scrollbar
        }
        if tab == "peers" {
            for peer in input.Peers {
                list.Add(PeerRow(input, peer))
            }
        } else if input.Banned.Length == 0 {
            list.Add(ListParts.Empty(ui, "no banned peers"))
        } else {
            for ban in input.Banned {
                list.Add(BanRow(ui, ban))
            }
        }
        let viewport = ListParts.Viewport(list, Style{FlexShrink: 1, MaxHeight: Percent(45)}, grow: false)
        card.Add(viewport)
        let identity = input.PeerId
        let hours = input.IdentityAge.Contains('h') ? int32.Parse(
            input.IdentityAge.Substring(0, input.IdentityAge.IndexOf('h')),
            CultureInfo.InvariantCulture
        ): 0
        let identityRow = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            Label(ui, ui.Strings.Get("This node"), AppTheme.Type13, AppTheme.Body, ""),
            Label(
                ui,
                String.Format(
                    ui.Strings.Get(hours >= 24 ? "identity {0} d": "identity {0} h"),
                    hours >= 24 ? hours / 24: hours
                ),
                AppTheme.Type13,
                AppTheme.Dim,
                ""
            ),
            Container{FlexGrow: 1},
            ControlParts.Icon(
                ui,
                MaterialIcons.Create(revealed ? "visibility_off": "visibility", AppTheme.Icon16, AppTheme.Body),
                ui.Strings.Get(revealed ? "Hide node ID": "Show node ID"),
                () -> {
                    revealed = !revealed
                }
            )
        }
        let identityPanel = Container{
            Gap: AppTheme.Space6,
            FlexShrink: 0,
            Padding: Edges{Top: AppTheme.Space8},
            BorderWidth: Edges{Top: AppTheme.Border1},
            BorderColor: AppTheme.Rule,
            identityRow
        }
        if revealed {
            let copied = ReadOnlySpan[char](ui.Actions.ClipboardText).SequenceEqual(
                System.MemoryExtensions.AsSpan(identity)
            )
            identityRow.Add(
                ControlParts.Icon(
                    ui,
                    MaterialIcons.Create(
                        copied ? "check": "content_copy",
                        AppTheme.Icon16,
                        copied ? AppTheme.Lime: AppTheme.Body
                    ),
                    ui.Strings.Get("Copy node ID"),
                    () -> {
                        ui.Actions.Copy(identity, 120000)
                    }
                )
            )
            identityPanel.Add(
                Text{
                    Content: Grouped(identity),
                    FontFamily: AppTheme.Font,
                    FontSize: AppTheme.Type13,
                    Color: AppTheme.Ink,
                    TextWrap: TextWrap.Wrap,
                    Accessibility: Accessibility{Name: identity}
                }
            )
        }
        card.Add(identityPanel)
        return card
    }

    private func Legend(ui Presentation, label string, count int32, color Color) Blob ->
    TextParts.Legend(ui, ui.Strings.Get(label), color, Label(ui, count.ToString(), AppTheme.Type12, AppTheme.Ink, ""))

    private func Map(input NetworkPeersInput) Blob {
        let ui = input.Ui
        let plot = Container{
            Handle: peerMap,
            FlexGrow: 1.5,
            FlexBasis: 0,
            MinHeight: 140,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: String.Format(ui.Strings.Get("{0} peers, {1} banned"), input.Peers.Length, input.Banned.Length)
            }
        }
        let width = peerMap.BorderBox.Width
        let height = peerMap.BorderBox.Height
        if width <= 0 || height <= 0 {
            return plot
        }
        let x = width / 2
        let y = height / 2
        let outer = Math.Min(width, height) / 2 - 4
        let ring = outer * 0.62
        plot.Add(Circle(x, y, outer, AppTheme.PinkSoft, DashPattern([]float64{2, 4}, 0)))
        plot.Add(Circle(x, y, ring, AppTheme.FaintRule, nil))
        let tcp = PathBuilder(0, 0, width, height)
        let quic = PathBuilder(0, 0, width, height)
        for index in 0 ... input.Peers.Length {
            let peer = input.Peers[index]
            let angle = -Math.PI / 2 + index * 2.39996
            (peer.Transport == "quic" ? quic: tcp).MoveTo(x, y).LineTo(
                x + Math.Cos(angle) * ring,
                y + Math.Sin(angle) * ring
            )
        }
        plot.Add(Lines(width, height, tcp, AppTheme.BlueSoft))
        plot.Add(Lines(width, height, quic, AppTheme.MintSoft))
        let hexagon = PathBuilder(0, 0, 28, 28)
        for corner in 0 ... 7 {
            let angle = Math.PI / 6 + corner * Math.PI / 3
            if corner == 0 {
                hexagon.MoveTo(14 + Math.Cos(angle) * 13, 14 + Math.Sin(angle) * 13)
            } else {
                hexagon.LineTo(14 + Math.Cos(angle) * 13, 14 + Math.Sin(angle) * 13)
            }
        }
        plot.Add(
            Shape{
                Position: PositionType.Absolute,
                Left: x - 14,
                Top: y - 14,
                Width: 28,
                Height: 28,
                Path: hexagon.Close().Build(),
                Fit: ShapeFit.Fill,
                BackgroundColor: AppTheme.Surface,
                BorderWidth: 1.5,
                BorderColor: AppTheme.Lime
            }
        )
        plot.Add(Dot(x, y, 3, AppTheme.Lime))
        for index in 0 ... input.Banned.Length {
            let angle = 0.78 * Math.PI + index * 0.84 * Math.PI
            let mark = MaterialIcons.Create("close", AppTheme.Icon14, AppTheme.Pink)
            plot.Add(Place(x + Math.Cos(angle) * outer - 7, y + Math.Sin(angle) * outer - 7, mark))
        }
        for index in 0 ... input.Peers.Length {
            let peer = input.Peers[index]
            let angle = -Math.PI / 2 + index * 2.39996
            let px = x + Math.Cos(angle) * ring
            let py = y + Math.Sin(angle) * ring
            let color = peer.Transport == "quic" ? AppTheme.Mint: AppTheme.Blue
            let active = peer.Id == hovered
            let radius = active ? 7.0: 5.5
            if active {
                plot.Add(Lines(width, height, PathBuilder(0, 0, width, height).MoveTo(x, y).LineTo(px, py), color))
            }
            let dot = Dot(px, py, radius, color)
            dot.BorderWidth = active ? 1.5: AppTheme.Border0
            dot.BorderColor = AppTheme.Ink
            dot.OnPointerEnter = (event PointerEvent) -> Hover(peer.Id)
            dot.OnPointerLeave = (event PointerEvent) -> Hover("")
            plot.Add(dot)
            if active {
                plot.Add(
                    ChartParts.Tooltip(
                        px + 14 + 250 > width ? Math.Max(0.0, px - 264): px + 14,
                        Math.Max(0.0, py - 34),
                        Container{
                            Gap: AppTheme.Space4,
                            Tip(ui, "peer ID", Short(peer.Id), AppTheme.Ink),
                            Tip(ui, "via", peer.Transport + " · " + peer.Family, color),
                            Tip(ui, "address", peer.Address, AppTheme.Ink)
                        },
                        zIndex: 4
                    )
                )
            }
        }
        return plot
    }

    private func Tip(ui Presentation, label string, value string, color Color) Blob ->
    KeyValue(ui, ui.Strings.Get(label), value, AppTheme.Space14, AppTheme.Dim, color, AppTheme.Type13, 60)

    private func Circle(x float64, y float64, radius float64, color Color, dashes DashPattern?) Blob -> Shape{
        Position: PositionType.Absolute,
        Left: x - radius,
        Top: y - radius,
        Width: radius * 2,
        Height: radius * 2,
        Path: PathBuilder(0, 0, radius * 2, radius * 2)
            .MoveTo(radius, 0)
            .ArcTo(radius, radius, 0, false, true, radius, radius * 2)
            .ArcTo(radius, radius, 0, false, true, radius, 0)
            .Build(),
        Fit: ShapeFit.Fill,
        BorderWidth: AppTheme.Border1,
        BorderColor: color,
        Dashes: dashes
    }

    private func Lines(width float64, height float64, path PathBuilder, color Color) Blob -> Shape{
        Position: PositionType.Absolute,
        Width: width,
        Height: height,
        Path: path.Build(),
        Fit: ShapeFit.Fill,
        BorderWidth: AppTheme.Border1,
        BorderColor: color
    }

    private func Dot(x float64, y float64, radius float64, color Color) Container {
        let point = ChartParts.Point(x, y, color, radius * 2)
        point.HitTestSelf = true
        return point
    }

    private func Hover(id string) {
        if hovered != id {
            hovered = id
        }
    }

    private func PeerRow(input NetworkPeersInput, peer NetworkPeer) Blob {
        let ui = input.Ui
        let row = Container{
            BasedOn: AppTheme.ListRowStyle,
            Height: 30,
            FlexShrink: 0,
            Padding: Edges{Left: AppTheme.Space8, Right: AppTheme.Space8},
            BorderRadius: AppTheme.Radius8,
            BackgroundColor: peer.Id == hovered ? AppTheme.Rule: Color.Transparent,
            Accessibility: Accessibility{Name: Short(peer.Id) + " " + peer.Transport + " " + peer.Address},
            OnPointerEnter: (event PointerEvent) -> Hover(peer.Id),
            OnPointerLeave: (event PointerEvent) -> Hover(""),
            Container{
                Width: 12,
                AlignItems: AlignItems.Center,
                Container{
                    BasedOn: AppTheme.MarkerStyle,
                    BorderRadius: AppTheme.Radius4,
                    BackgroundColor: peer.Transport == "quic" ? AppTheme.Mint: AppTheme.Blue
                }
            },
            Grow(Label(ui, Short(peer.Id), AppTheme.Type13, AppTheme.Ink, ""))
        }
        if input.Width >= 1100 {
            row.Add(Label(ui, peer.Address, AppTheme.Type13, AppTheme.Body, ""))
        }
        return row
    }

    private func BanRow(ui Presentation, ban BannedPeer) Blob -> Container{
        Gap: AppTheme.Space4,
        MinHeight: 44,
        FlexShrink: 0,
        Padding: Edges{Left: AppTheme.Space8, Right: AppTheme.Space8},
        Accessibility: Accessibility{Name: Short(ban.Id) + " " + ban.Reason},
        Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            MaterialIcons.Create("close", AppTheme.Icon12, AppTheme.Pink),
            Label(ui, Short(ban.Id), AppTheme.Type13, AppTheme.Ink, ""),
            Grow(Label(ui, ban.Reason, AppTheme.Type13, AppTheme.Body, "")),
            Label(ui, ban.Count.ToString() + "×", AppTheme.Type13, AppTheme.Dim, "")
        },
        if ban.Permanent {
            Label(ui, ui.Strings.Get("permanent"), AppTheme.Type13, AppTheme.Pink, "")
        } else {
            Label(ui, String.Format(ui.Strings.Get("until {0}"), Time(ban.Expires)), AppTheme.Type13, AppTheme.Body, "")
        }
    }

    private func Short(id string) string -> if id.Length > 12 {
        id.Substring(0, 4) + "…" + id.Substring(id.Length - 6)
    } else {
        id
    }
}
