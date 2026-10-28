package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Gyroid.History
import Gyroid.Node
import Gyroid.Wallet
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
    var Language string
    var Width float64
    var Height float64
}

class NetworkPage : Cell[NetworkInput] {
    private var report NetworkReport = NetworkReport()
    private var loaded NodeStatus? = nil
    private var loading bool
    private var tab string = "peers"
    private var selected uint64
    private var hovered string = ""
    private var revealed bool
    private let timePlot ElementHandle = ElementHandle()
    private let ribbonPlot ElementHandle = ElementHandle()
    private let peerMap ElementHandle = ElementHandle()

    init() {
        timePlot.MetricsChanged += _ -> Rebuild()
        ribbonPlot.MetricsChanged += _ -> Rebuild()
        peerMap.MetricsChanged += _ -> Rebuild()
    }

    protected override func Build(input NetworkInput) Blob {
        let ui = input.Ui
        let node = input.Node
        if node.Running && (node.Peers == 0 || node.Syncing && node.ChainHeight > node.Height + 2) {
            return Container{
                FlexGrow: 1,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                Cell.Mount[SyncInput, SyncPage](
                    "sync",
                    SyncInput{Ui: ui, Node: node, Language: input.Language, Width: input.Width, Height: input.Height}
                )
            }
        }
        if node.Running && loaded != node && !loading {
            Load(input)
        }
        let blocks = report.Blocks
        let tip = blocks.Length > 0 ? blocks[blocks.Length - 1]: NetworkBlock()
        var average = 0.0
        if blocks.Length > 1 {
            average = float64(tip.Timestamp - blocks[0].Timestamp) / (blocks.Length - 1)
        }
        let change = tip.Difficulty > 0 ? (float64(report.Difficulty) / tip.Difficulty - 1) * 100: 0.0
        let figures = Card(ui)
        figures.FlexDirection = FlexDirection.Row
        figures.Padding = Edges{Left: 22, Right: 22, Top: 14, Bottom: 14}
        figures.Gap = 20
        figures.FlexShrink = 0
        figures.Add(Figure(input, "Height", ui.Count(node.Height), ""))
        figures.Add(Figure(input, "Hashrate", Rate(report.Hashrate), Unit(report.Hashrate)))
        figures.Add(
            Figure(
                input,
                "Difficulty",
                Compact(report.Difficulty),
                if change == 0 {
                    ""
                } else {
                    (change > 0 ? "▲ ": "▼ ") + Math.Abs(change).ToString("0.0", CultureInfo.InvariantCulture) + "%"
                }
            )
        )
        figures.Add(
            Figure(
                input,
                "Mempool",
                node.Mempool.ToString(),
                ui.Strings.Get("tx") + " · " + (node.MempoolBytes / 1000.0).ToString(
                    "0.0",
                    CultureInfo.InvariantCulture
                ) +
                    " KB"
            )
        )
        figures.Add(Figure(input, "Emitted", report.Emitted.ToString("0.0", CultureInfo.InvariantCulture), "%"))
        let times = Card(ui)
        times.FlexGrow = 1
        times.FlexBasis = 0
        times.Add(
            Header(
                input,
                "Block time",
                "time",
                Duration(int64(average)),
                Cell.Mount[InfoTipInput, InfoTip](
                    "time-info",
                    InfoTipInput{
                        Ui: ui,
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
        times.Add(TimeChart(ui))
        let shown = if selected > 0 && Array.Exists(blocks, block -> block.Height == selected) {
            Array.Find(blocks, block -> block.Height == selected)
        } else {
            tip
        }
        let last = Card(ui)
        last.FlexGrow = 1.15
        last.FlexBasis = 0
        last.Add(Header(input, "Last block", "last", tip.Timestamp > 0 ? ui.Clock(tip.Timestamp): "-", Container{}))
        last.Add(Ribbon(input, tip))
        last.Add(Details(input, shown, tip))
        return Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            Width: Percent(100),
            Gap: 12,
            figures,
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                FlexDirection: FlexDirection.Row,
                Gap: 12,
                Container{FlexGrow: 1.32, FlexBasis: 0, MinWidth: 0, MinHeight: 0, Gap: 12, times, last},
                Peers(input)
            }
        }
    }

    private async func Load(input NetworkInput) {
        loading = true
        loaded = input.Node
        let previous = report
        var result NetworkReport? = nil
        try {
            result = await Task.Run(() -> input.Session.Node.ReadNetworkAsync(previous, CancellationToken.None))
        } catch (failure Exception) { }
        input.Window?.TryPost(
            () -> {
                loading = false
                guard let value = result else {
                    return
                }
                report = value
                Rebuild()
            }
        )
    }

    private func Card(ui Presentation) Container {
        let card = ui.Glass()
        card.BorderRadius = 14
        card.Padding = Edges{Left: 18, Right: 18, Top: 14, Bottom: 12}
        card.Gap = 8
        return card
    }

    private func Figure(input NetworkInput, label string, value string, unit string) Blob {
        let ui = input.Ui
        return Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Gap: 5,
            Accessibility: Accessibility{Name: ui.Strings.Get(label) + " " + value + " " + unit},
            ui.Label(ui.Strings.Get(label), 13, ui.Body, ""),
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Baseline,
                Gap: 6,
                Overflow: Overflow.Hidden,
                Cell.Mount[DecodeValueInput, DecodeValue](
                    label,
                    DecodeValueInput{
                        Value: value,
                        Name: ui.Strings.Get(label) + " " + value,
                        Size: Math.Clamp(input.Height * 0.027, 17, 26),
                        Color: ui.Ink,
                        FractionColor: ui.Ink,
                        Live: AccessibilityLive.Off,
                        Ui: ui
                    }
                ),
                ui.Label(unit, 12, ui.Body, "")
            }
        }
    }

    private func Header(input NetworkInput, label string, key string, value string, trailing Blob) Blob {
        let ui = input.Ui
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 12,
            FlexShrink: 0,
            ui.Label(ui.Strings.Get(label), 13, ui.Body, ""),
            Cell.Mount[DecodeValueInput, DecodeValue](
                key,
                DecodeValueInput{
                    Value: value,
                    Name: ui.Strings.Get(label) + " " + value,
                    Size: Math.Clamp(input.Height * 0.032, 20, 30),
                    Color: ui.Ink,
                    FractionColor: ui.Ink,
                    Live: AccessibilityLive.Off,
                    Ui: ui
                }
            ),
            Container{FlexGrow: 1},
            trailing
        }
    }

    private func TimeChart(ui Presentation) Blob {
        let blocks = report.Blocks
        let count = blocks.Length - 1
        let plot = Container{
            Handle: timePlot,
            FlexGrow: 1,
            MinHeight: 0,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: String.Format(ui.Strings.Get("last {0} block times, target 5:00"), Math.Max(count, 0))
            },
            OnPointerLeave: (event PointerEvent) -> Select(0)
        }
        let width = timePlot.BorderBox.Width
        let height = timePlot.BorderBox.Height
        if count < 1 || width <= 50 || height <= 30 {
            return plot
        }
        let inner = width - 46
        let extent = height - 22
        let step = inner / 60
        let target = Level(300, extent)
        plot.Add(Rule(2, Level(900, extent), inner, Color.Parse("#141414")))
        plot.Add(Rule(2, Level(600, extent), inner, Color.Parse("#141414")))
        plot.Add(Place(inner + 10, Level(900, extent) - 7, ui.Label("15:00", 11, ui.Dim, "")))
        plot.Add(Place(inner + 10, Level(600, extent) - 7, ui.Label("10:00", 11, ui.Dim, "")))
        for index in 0 ... count {
            let block = blocks[index + 1]
            let seconds = Math.Max(0L, block.Timestamp - blocks[index].Timestamp)
            let level = Level(float64(seconds), extent)
            let left = 2 + (60 - count + index) * step
            let slow = seconds > 300
            let chosen = block.Height == selected
            plot.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: left + step * 0.18,
                    Top: Math.Min(level, target),
                    Width: Math.Max(2.0, step * 0.64),
                    Height: Math.Max(1.5, Math.Abs(level - target)),
                    BorderRadius: 1,
                    BorderWidth: chosen ? 1.2: 0.0,
                    BorderColor: ui.Ink,
                    BackgroundColor: if slow {
                        chosen ? ui.Orange: Color.Parse("#9e6900")
                    } else {
                        chosen ? ui.Blue: Color.Parse("#00699e")
                    }
                }
            )
            plot.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: left,
                    Top: 0,
                    Width: step,
                    Height: height,
                    OnPointerEnter: (event PointerEvent) -> Select(block.Height)
                }
            )
        }
        plot.Add(
            Shape{
                Position: PositionType.Absolute,
                Left: 2,
                Top: target,
                Width: inner,
                Height: 1,
                Path: PathBuilder(0, 0, inner, 1).MoveTo(0, 0.5).LineTo(inner, 0.5).Build(),
                Fit: ShapeFit.Fill,
                BorderWidth: 1,
                BorderColor: Color.Parse("#b5b5b5"),
                Dashes: DashPattern([]float64{4, 3}, 0)
            }
        )
        plot.Add(Place(inner + 10, target - 8, ui.Label("5:00", 12, ui.Ink, "")))
        plot.Add(Place(2, height - 14, ui.Label("#" + ui.Count(blocks[0].Height), 11, ui.Dim, "")))
        plot.Add(
            Container{
                Position: PositionType.Absolute,
                Right: 44,
                Top: height - 14,
                ui.Label("#" + ui.Count(blocks[count].Height), 11, ui.Dim, "")
            }
        )
        return plot
    }

    private func Level(seconds float64, extent float64) float64 -> 6 + extent * (1 - Math.Min(seconds, 900) / 900)

    private func Rule(left float64, top float64, width float64, color Color) Blob -> Container{
        Position: PositionType.Absolute,
        Left: left,
        Top: top,
        Width: width,
        Height: 1,
        BackgroundColor: color
    }

    private func Place(left float64, top float64, content Blob) Blob -> Container{
        Position: PositionType.Absolute,
        Left: left,
        Top: top,
        HitTestSelf: false,
        content
    }

    private func Select(height uint64) {
        if selected != height {
            selected = height
            Rebuild()
        }
    }

    private func Ribbon(input NetworkInput, tip NetworkBlock) Blob {
        let ui = input.Ui
        let blocks = report.Blocks
        let plot = Container{
            Handle: ribbonPlot,
            FlexGrow: 1,
            MinHeight: 0,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: ui.Strings.Get("blocks of the last 2 hours")
            },
            OnPointerLeave: (event PointerEvent) -> Select(0)
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
                    BackgroundColor: seconds % 12 == 0 ? ui.Dim: Color.Parse("#3a3a3a")
                }
            )
        }
        plot.Add(Rule(2, bottom, width, ui.Edge))
        plot.Add(Place(2, height - 13, ui.Label(ui.Strings.Get("−2h"), 11, ui.Dim, "")))
        plot.Add(Place(Offset(3600, width) - 12, height - 13, ui.Label(ui.Strings.Get("−1h"), 11, ui.Dim, "")))
        plot.Add(
            Container{
                Position: PositionType.Absolute,
                Right: 2,
                Top: height - 13,
                ui.Label(ui.Clock(tip.Timestamp), 11, ui.Dim, "")
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
            let chosen = block.Height == selected
            plot.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: start,
                    Top: bottom - rise,
                    Width: span,
                    Height: rise,
                    OnPointerEnter: (event PointerEvent) -> Select(block.Height),
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
                            pending ? Color.Parse("#734d00"): Color.Parse("#4d7300")
                        } else {
                            pending ? Color.Parse("#1a1100"): Color.Parse("#111a00")
                        },
                        BorderWidth: chosen ? 1.4: 1.0,
                        BorderColor: if chosen {
                            ui.Ink
                        } else {
                            pending ? Color.Parse("#b37700"): Color.Parse("#77b300")
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
                        Top: 12,
                        Width: 1,
                        Height: bottom - 12,
                        HitTestSelf: false,
                        BackgroundColor: Color.Parse("#b37700")
                    }
                )
                plot.Add(
                    Place(Math.Min(right + 5, width - 58), 10, ui.Label(ui.Strings.Get("10 conf"), 11, ui.Orange, ""))
                )
            }
        }
        return plot
    }

    private func Offset(age float64, width float64) float64 -> 2 + width * (1 - age / 7200)

    private func Own(input NetworkInput, height uint64, tip uint64) Color? {
        for output in input.History {
            if output.BlockHeight == height {
                return input.Ui.Mint
            }
        }
        for send in input.Sends {
            if send.Confirmations > 0 && tip + 1 - send.Confirmations == height {
                return input.Ui.Orange
            }
        }
        return nil
    }

    private func Details(input NetworkInput, block NetworkBlock, tip NetworkBlock) Blob {
        let ui = input.Ui
        let row = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 18,
            Height: 20,
            FlexShrink: 0,
            Overflow: Overflow.Hidden,
            Accessibility: Accessibility{Live: AccessibilityLive.Polite}
        }
        if block.Hash.Length == 0 {
            return row
        }
        let index = Array.FindIndex(report.Blocks, item -> item.Height == block.Height)
        let confirmations = tip.Height - block.Height + 1
        row.Add(ui.Label("#" + ui.Count(block.Height), 12.5, ui.Lime, ""))
        row.Add(ui.Label(ui.Clock(block.Timestamp), 12.5, ui.Body, ""))
        if index > 0 {
            row.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: 6,
                    ui.Label(ui.Strings.Get("took"), 12.5, ui.Dim, ""),
                    ui.Label(Duration(block.Timestamp - report.Blocks[index - 1].Timestamp), 12.5, ui.Body, "")
                }
            )
        }
        row.Add(ui.Label(block.Transactions.ToString() + " " + ui.Strings.Get("tx"), 12.5, ui.Body, ""))
        row.Add(
            ui.Label(
                confirmations.ToString() + " " + ui.Strings.Get("conf"),
                12.5,
                confirmations < 10 ? ui.Orange: ui.Body,
                ""
            )
        )
        let copied = String(ui.ClipboardText) == block.Hash
        row.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 2,
                ui.Label(
                    block.Hash.Substring(0, 6) + "…" + block.Hash.Substring(block.Hash.Length - 4),
                    12.5,
                    ui.Dim,
                    ""
                ),
                IconButton{
                    Icon: MaterialIcons.Create(copied ? "check": "content_copy", 14, copied ? ui.Lime: ui.Dim),
                    AccessibilityName: ui.Strings.Get("copy hash"),
                    OnClick: () -> {
                        ui.Copy(block.Hash, 120000)
                        Rebuild()
                    }
                }.Build()
            }
        )
        return row
    }

    private func Peers(input NetworkInput) Blob {
        let ui = input.Ui
        let card = ui.Glass()
        card.BorderRadius = 14
        card.Padding = Edges{Left: 14, Right: 14, Top: 12, Bottom: 12}
        card.Gap = 8
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                FlexShrink: 0,
                Container{
                    FlexDirection: FlexDirection.Row,
                    Padding: 3,
                    BorderRadius: 10,
                    BorderWidth: 1,
                    BorderColor: ui.Rule,
                    BackgroundColor: Color.Parse("#080808"),
                    Accessibility: Accessibility{Role: AccessibilityRole.TabList},
                    Segment(ui, "peers", report.Peers.Length),
                    Segment(ui, "banned", report.Banned.Length)
                },
                Container{FlexGrow: 1},
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
        card.Add(Map(ui))
        var tcp = 0
        for peer in report.Peers {
            if peer.Transport != "quic" {
                tcp++
            }
        }
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.Center,
                Gap: 16,
                FlexShrink: 0,
                Legend(ui, "tcp", tcp, ui.Blue),
                Legend(ui, "quic", report.Peers.Length - tcp, ui.Mint),
                Legend(ui, "banned", report.Banned.Length, ui.Pink)
            }
        )
        let list = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Theme.Read().Scrollbar
        }
        if tab == "peers" {
            for peer in report.Peers {
                list.Add(PeerRow(input, peer))
            }
        } else {
            for ban in report.Banned {
                list.Add(BanRow(ui, ban))
            }
        }
        card.Add(list)
        let identity = input.Node.PeerId
        let hours = input.Node.IdentityAge.Contains('h') ? int32.Parse(
            input.Node.IdentityAge.Substring(0, input.Node.IdentityAge.IndexOf('h')),
            CultureInfo.InvariantCulture
        ): 0
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 10,
                FlexShrink: 0,
                Padding: Edges{Top: 8},
                BorderWidth: Edges{Top: 1},
                BorderColor: ui.Rule,
                ui.Label(ui.Strings.Get("This node"), 12.5, ui.Body, ""),
                ui.Label(
                    if identity.Length < 10 {
                        identity
                    } else if revealed {
                        Short(identity)
                    } else {
                        identity.Substring(0, 4) + "…••••••"
                    },
                    12.5,
                    ui.Ink,
                    ""
                ),
                ui.Label(
                    String.Format(
                        ui.Strings.Get(hours >= 24 ? "identity {0} d": "identity {0} h"),
                        hours >= 24 ? hours / 24: hours
                    ),
                    12.5,
                    ui.Dim,
                    ""
                ),
                Container{FlexGrow: 1},
                IconButton{
                    Icon: MaterialIcons.Create(revealed ? "visibility_off": "visibility", 15, ui.Body),
                    AccessibilityName: ui.Strings.Get(revealed ? "Hide node ID": "Show node ID"),
                    OnClick: () -> {
                        revealed = !revealed
                        Rebuild()
                    }
                }.Build()
            }
        )
        return card
    }

    private func Segment(ui Presentation, key string, count int32) Blob -> Goo
        .Button{
        Padding: Edges{Left: 12, Right: 12, Top: 5, Bottom: 5},
        BorderRadius: 7,
        BackgroundColor: tab == key ? Color.Parse("#1a1a1a"): Color.Transparent,
        Hover: Style{BackgroundColor: ui.Rule},
        Focus: Theme.Read().FocusStyle,
        Accessibility: Accessibility{
            Role: AccessibilityRole.Tab,
            Name: ui.Strings.Get(key) + " " + count.ToString(),
            Selected: tab == key
        },
        OnClick: () -> {
            tab = key
            Rebuild()
        },
        ui.Label(ui.Strings.Get(key) + " " + count.ToString(), 14, tab == key ? ui.Ink: ui.Body, "")
    }

    private func Legend(ui Presentation, label string, count int32, color Color) Blob {
        let mark Blob = if label == "banned" {
            MaterialIcons.Create("close", 12, color)
        } else {
            Container{Width: 8, Height: 8, BorderRadius: 4, BackgroundColor: color}
        }
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 6,
            mark,
            ui.Label(ui.Strings.Get(label), 12, ui.Body, ""),
            ui.Label(count.ToString(), 12, ui.Ink, "")
        }
    }

    private func Map(ui Presentation) Blob {
        let plot = Container{
            Handle: peerMap,
            FlexGrow: 1.5,
            FlexBasis: 0,
            MinHeight: 140,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: String.Format(ui.Strings.Get("{0} peers, {1} banned"), report.Peers.Length, report.Banned.Length)
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
        plot.Add(Circle(x, y, outer, Color.Parse("#40002b"), DashPattern([]float64{2, 4}, 0)))
        plot.Add(Circle(x, y, ring, Color.Parse("#171717"), nil))
        let tcp = PathBuilder(0, 0, width, height)
        let quic = PathBuilder(0, 0, width, height)
        for index in 0 ... report.Peers.Length {
            let peer = report.Peers[index]
            let angle = -Math.PI / 2 + index * 2.39996
            (peer.Transport == "quic" ? quic: tcp).MoveTo(x, y).LineTo(
                x + Math.Cos(angle) * ring,
                y + Math.Sin(angle) * ring
            )
        }
        plot.Add(Lines(width, height, tcp, Color.Parse("#003047")))
        plot.Add(Lines(width, height, quic, Color.Parse("#004730")))
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
                BackgroundColor: ui.Surface,
                BorderWidth: 1.5,
                BorderColor: ui.Lime
            }
        )
        plot.Add(Dot(x, y, 3, ui.Lime))
        for index in 0 ... report.Banned.Length {
            let angle = 0.78 * Math.PI + index * 0.84 * Math.PI
            let mark = MaterialIcons.Create("close", 14, ui.Pink)
            plot.Add(Place(x + Math.Cos(angle) * outer - 7, y + Math.Sin(angle) * outer - 7, mark))
        }
        for index in 0 ... report.Peers.Length {
            let peer = report.Peers[index]
            let angle = -Math.PI / 2 + index * 2.39996
            let px = x + Math.Cos(angle) * ring
            let py = y + Math.Sin(angle) * ring
            let color = peer.Transport == "quic" ? ui.Mint: ui.Blue
            let active = peer.Id == hovered
            let radius = active ? 7.0: 5.5
            if active {
                plot.Add(Lines(width, height, PathBuilder(0, 0, width, height).MoveTo(x, y).LineTo(px, py), color))
            }
            let dot = Dot(px, py, radius, color)
            dot.BorderWidth = active ? 1.5: 0.0
            dot.BorderColor = ui.Ink
            dot.OnPointerEnter = (event PointerEvent) -> Hover(peer.Id)
            dot.OnPointerLeave = (event PointerEvent) -> Hover("")
            plot.Add(dot)
            if active {
                plot.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Left: px + 14 + 250 > width ? Math.Max(0.0, px - 264): px + 14,
                        Top: Math.Max(0.0, py - 34),
                        ZIndex: 4,
                        HitTestSelf: false,
                        Padding: Edges{Left: 12, Right: 12, Top: 10, Bottom: 10},
                        Gap: 5,
                        BackgroundColor: Color.Parse("#0b0b0b"),
                        BorderWidth: 1,
                        BorderColor: ui.Edge,
                        BorderRadius: 10,
                        BoxShadows: []BoxShadow{BoxShadow{OffsetY: 10, Blur: 30, Color: ui.Black}},
                        Tip(ui, "peer ID", Short(peer.Id), ui.Ink),
                        Tip(ui, "via", peer.Transport + " · " + peer.Family, color),
                        Tip(ui, "address", peer.Address, ui.Ink)
                    }
                )
            }
        }
        return plot
    }

    private func Tip(ui Presentation, label string, value string, color Color) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        Gap: 14,
        Container{Width: 60, ui.Label(ui.Strings.Get(label), 12.5, ui.Dim, "")},
        ui.Label(value, 12.5, color, "")
    }

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
        BorderWidth: 1,
        BorderColor: color,
        Dashes: dashes
    }

    private func Lines(width float64, height float64, path PathBuilder, color Color) Blob -> Shape{
        Position: PositionType.Absolute,
        Width: width,
        Height: height,
        Path: path.Build(),
        Fit: ShapeFit.Fill,
        BorderWidth: 1,
        BorderColor: color
    }

    private func Dot(x float64, y float64, radius float64, color Color) Container -> Container{
        Position: PositionType.Absolute,
        Left: x - radius,
        Top: y - radius,
        Width: radius * 2,
        Height: radius * 2,
        BorderRadius: radius,
        BackgroundColor: color
    }

    private func Hover(id string) {
        if hovered != id {
            hovered = id
            Rebuild()
        }
    }

    private func PeerRow(input NetworkInput, peer NetworkPeer) Blob {
        let ui = input.Ui
        let row = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Height: 30,
            FlexShrink: 0,
            Padding: Edges{Left: 8, Right: 8},
            BorderRadius: 7,
            BackgroundColor: peer.Id == hovered ? ui.Rule: Color.Transparent,
            Accessibility: Accessibility{Name: Short(peer.Id) + " " + peer.Transport + " " + peer.Address},
            OnPointerEnter: (event PointerEvent) -> Hover(peer.Id),
            OnPointerLeave: (event PointerEvent) -> Hover(""),
            Container{
                Width: 12,
                AlignItems: AlignItems.Center,
                Container{
                    Width: 8,
                    Height: 8,
                    BorderRadius: 4,
                    BackgroundColor: peer.Transport == "quic" ? ui.Mint: ui.Blue
                }
            },
            ui.Grow(ui.Label(Short(peer.Id), 12.5, ui.Ink, ""))
        }
        if input.Width >= 1100 {
            row.Add(ui.Label(peer.Address, 12.5, ui.Body, ""))
        }
        return row
    }

    private func BanRow(ui Presentation, ban BannedPeer) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 10,
        Height: 30,
        FlexShrink: 0,
        Padding: Edges{Left: 8, Right: 8},
        Accessibility: Accessibility{Name: Short(ban.Id) + " " + ban.Reason},
        MaterialIcons.Create("close", 12, ui.Pink),
        ui.Label(Short(ban.Id), 12.5, ui.Ink, ""),
        ui.Grow(ui.Label(ban.Reason, 12.5, ui.Body, "")),
        ui.Label(ban.Count.ToString() + "× · ", 12.5, ui.Dim, ""),
        if ban.Permanent {
            ui.Label(ui.Strings.Get("permanent"), 12.5, ui.Pink, "")
        } else {
            ui.Label(String.Format(ui.Strings.Get("until {0}"), ui.Clock(ban.Expires)), 12.5, ui.Body, "")
        }
    }

    private func Short(id string) string -> if id.Length > 12 {
        id.Substring(0, 4) + "…" + id.Substring(id.Length - 6)
    } else {
        id
    }

    private func Duration(seconds int64) string -> (seconds / 60).ToString(CultureInfo.InvariantCulture) +
        ":" +
        (seconds % 60).ToString("00", CultureInfo.InvariantCulture)

    private func Rate(hashes float64) string -> (
        hashes / Math.Pow(1000, Math.Clamp(Math.Floor(Math.Log10(Math.Max(hashes, 1)) / 3), 0, 3))
    ).ToString("0.00", CultureInfo.InvariantCulture)

    private func Unit(hashes float64) string -> switch int32(
        Math.Clamp(Math.Floor(Math.Log10(Math.Max(hashes, 1)) / 3), 0, 3)
    ) {
        case 0: "H/s"
        case 1: "kH/s"
        case 2: "MH/s"
        default: "GH/s"
    }

    private func Compact(value uint64) string -> if value >= 1000000000 {
        (value / 1e9).ToString("0.00", CultureInfo.InvariantCulture) + " G"
    } else if value >= 1000000 {
        (value / 1e6).ToString("0.00", CultureInfo.InvariantCulture) + " M"
    } else if value >= 1000 {
        (value / 1e3).ToString("0.00", CultureInfo.InvariantCulture) + " K"
    } else {
        value.ToString(CultureInfo.InvariantCulture)
    }
}
