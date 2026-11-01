package Gyroid.Views

import Goo
import Goo.Widgets.Inputs
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.Threading

data struct SyncInput {
    var Ui Presentation
    var Node NodeStatus
    var Language string
    var Width float64
    var Height float64
    var Fill bool
}

data struct SyncSample {
    var Seconds float64
    var Value float64
}

data struct SyncState {
    var Step int32
    var ExecutedPhases int32
    var DownloadPercent int32
    var Peers uint64
    var Limit uint64
    var Progress uint64
    var ChainHeight uint64
    var LocalHeight uint64
    var CheckpointHeight uint64
    var Rate float64
    var Listen string
    var Network string
    var Endpoint string
}

class SyncPage : Cell, IDisposable {
    private let started int64 = Stopwatch.GetTimestamp()
    private let peerSamples List[SyncSample] = List[SyncSample]()
    private let rateSamples List[SyncSample] = List[SyncSample]()
    private let configureChart Action[SyncChart]
    private var input SyncInput
    private var state SyncState
    private var pending SyncState
    private var accepted bool
    private var now float64
    private var stalled bool
    private var generation int32
    private var lifetime CancellationTokenSource?
    private var stallTimer WindowTimer?
    private var updateTimer WindowTimer?
    private var samples[]SyncSample = []SyncSample{}
    private var peak float64 = 1
    private var chartWidth float64
    private var connectedAt int64
    private var progressAt int64

    init() {
        configureChart = chart -> chart.Accept(
            SyncChartInput{
                Ui: input.Ui,
                Language: input.Language,
                Samples: samples,
                Now: now,
                Step: state.Step,
                Peak: peak,
                Stalled: stalled,
                Width: chartWidth,
                Height: input.Height,
                Fill: input.Fill
            }
        )
    }

    func Accept(next SyncInput) {
        let node = next.Node
        let value = SyncState{
            Step: Step(node),
            ExecutedPhases: node.ExecutedPhases,
            DownloadPercent: node.DownloadPercent ?? 0,
            Peers: node.Peers,
            LocalHeight: node.Height,
            Limit: Math.Max(node.MaxOutbound, uint64(1)),
            Progress: node.SyncProgress ?? node.Height,
            ChainHeight: node.ChainHeight,
            CheckpointHeight: node.CheckpointHeight,
            Rate: node.SyncRate,
            Listen: node.Listen,
            Network: node.Network,
            Endpoint: node.Endpoint
        }
        let layoutChanged = !accepted ||
            input.Language != next.Language ||
            input.Width != next.Width ||
            input.Height != next.Height ||
            input.Fill != next.Fill
        input = next
        let width = next.Fill ? next.Width: Math.Min(760, next.Width - 48)
        chartWidth = width - AppTheme.GetPagePadding(next.Width, next.Height) * 2
        if lifetime == nil {
            if let window = next.Ui.Actions.window {
                lifetime = CancellationTokenSource.CreateLinkedTokenSource(window.Closed)
            }
        }
        if !accepted ||
            state.Network != value.Network ||
            state.Endpoint != value.Endpoint ||
            state.Step != value.Step ||
            state.ExecutedPhases != value.ExecutedPhases {
            updateTimer?.Dispose()
            updateTimer = nil
            Apply(value)
        } else if state != value {
            pending = value
            if updateTimer == nil {
                let current = generation
                updateTimer = input
                    .Ui
                    .Actions
                    .Delay(
                    100,
                    () -> {
                        if current == generation && lifetime?.IsCancellationRequested != true {
                            updateTimer = nil
                            Apply(pending)
                        }
                    }
                )
            }
        } else {
            pending = value
        }
        if layoutChanged {
            Rebuild()
        }
    }

    private func Apply(value SyncState) {
        if accepted && state == value {
            return
        }
        let restarted = accepted &&
            (
            state.Network != value.Network ||
                state.Endpoint != value.Endpoint ||
                value.Step <= 2 &&
                value.Step < state.Step
        )
        if restarted {
            connectedAt = 0
            peerSamples.Clear()
            rateSamples.Clear()
        }
        now = Stopwatch.GetElapsedTime(started).TotalSeconds
        let progressChanged = !accepted || restarted || state.Progress != value.Progress || state.Step != value.Step
        state = value
        accepted = true
        if state.Step != 3 {
            connectedAt = 0
        } else if connectedAt == 0 {
            connectedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
        }
        if progressChanged {
            progressAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            stalled = false
            stallTimer?.Dispose()
            stallTimer = nil
            generation++
            if state.Step == 4 {
                let current = generation
                stallTimer = input
                    .Ui
                    .Actions
                    .Delay(
                    60000,
                    () -> {
                        if current == generation && lifetime?.IsCancellationRequested != true {
                            stallTimer = nil
                            stalled = true
                            Rebuild()
                        }
                    }
                )
            }
        }
        peerSamples.Add(SyncSample{Seconds: now, Value: float64(state.Peers)})
        peerSamples.RemoveAll(sample -> sample.Seconds < now - 15)
        if state.Step == 4 {
            rateSamples.Add(SyncSample{Seconds: now, Value: stalled ? 0.0: state.Rate})
            rateSamples.RemoveAll(sample -> sample.Seconds < now - 120)
        }
        samples = (state.Step == 3 ? peerSamples: rateSamples).ToArray()
        peak = state.Step == 3 ? float64(state.Limit): 1.0
        if state.Step == 4 {
            for sample in samples {
                peak = Math.Max(peak, sample.Value * 1.25)
            }
        }
        Rebuild()
    }

    public func Dispose() {
        generation++
        lifetime?.Cancel()
        stallTimer?.Dispose()
        updateTimer?.Dispose()
        lifetime?.Dispose()
    }

    override func Build() Blob {
        let ui = input.Ui
        let node = state
        let step = node.Step
        let width = input.Fill ? input.Width: Math.Min(760, input.Width - 48)
        let card = WalletParts.PageCard(ui, input.Width, input.Height, width, input.Fill)
        card.MinHeight = input.Fill ? 0.0: Math.Min(420, input.Height - 100)
        if input.Fill {
            card.FlexGrow = 1
            card.FlexBasis = 0
        }
        card.Accessibility = Accessibility{Live: AccessibilityLive.Polite}
        card.Add(
            Cell.Mount[SyncStepsInput, SyncSteps](
                "sync-steps",
                SyncStepsInput{
                    Ui: ui,
                    Language: input.Language,
                    Step: step,
                    ExecutedPhases: node.ExecutedPhases,
                    CheckpointHeight: node.CheckpointHeight,
                    Peers: node.Peers
                }
            )
        )
        card.Add(
            Cell.Mount[SyncReadingsInput, SyncReadings](
                "sync-readings",
                SyncReadingsInput{
                    Ui: ui,
                    Language: input.Language,
                    Step: step,
                    DownloadPercent: node.DownloadPercent,
                    LocalHeight: node.LocalHeight,
                    Peers: node.Peers,
                    Limit: node.Limit,
                    Progress: node.Progress,
                    ChainHeight: node.ChainHeight,
                    Rate: node.Rate,
                    Listen: node.Listen,
                    Since: connectedAt,
                    Stalled: stalled,
                    Width: input.Width,
                    Height: input.Height,
                    Fill: input.Fill
                }
            )
        )
        if step < 2 {
            let percent = node.DownloadPercent
            card.Add(Track(ui, percent / 100.0, 0, AppTheme.Lime))
        } else if step == 3 {
            let limit = node.Limit
            card.Add(Cell.Mount[SyncChart]("sync-chart", configureChart))
            card.Add(Slots(ui, node.Peers, limit))
        } else if step == 4 {
            let done = node.Progress
            let share = node.ChainHeight > 0 ? Math.Min(1.0, float64(done) / node.ChainHeight): 0.0
            let color = stalled ? AppTheme.Orange: AppTheme.Lime
            card.Add(Cell.Mount[SyncChart]("sync-chart", configureChart))
            let checkpoint = node.ChainHeight > 0 ? Math.Min(
                1.0,
                float64(node.CheckpointHeight) / node.ChainHeight
            ): 0.0
            let track = Track(ui, share, checkpoint, color)
            track.Padding = Edges{Bottom: AppTheme.Space22}
            track.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Top: 20,
                    Label(ui, "#0", AppTheme.Type12, AppTheme.Dim, "")
                }
            )
            if node.CheckpointHeight > 0 {
                track.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Right: 0,
                        Top: 20,
                        FlexDirection: FlexDirection.Row,
                        Gap: AppTheme.Space6,
                        Label(ui, ui.Strings.Get("checkpoint"), AppTheme.Type12, AppTheme.Body, ""),
                        Label(ui, Count(node.CheckpointHeight), AppTheme.Type12, AppTheme.Blue, "")
                    }
                )
            }
            card.Add(track)
        }
        let foot = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: AppTheme.Space12}
        foot.Add(
            Grow(
                if stalled {
                    Label(
                        ui,
                        String.Format(ui.Strings.Get("no new blocks since {0}"), Clock(progressAt)),
                        AppTheme.Type12,
                        AppTheme.Orange,
                        ""
                    )
                } else {
                    Label(ui, ui.Strings.Get(node.Network), AppTheme.Type12, AppTheme.Dim, "")
                }
            )
        )
        foot.Add(
            Cell.Mount[InfoTipInput, InfoTip](
                "sync",
                InfoTipInput{
                    Ui: ui,
                    Topic: "About sync",
                    Lines: []string{
                        "Up to the checkpoint, blocks must match known hashes, so the node skips proof-of-work and signature checks. After it, every block is fully verified and speed drops. Speed and time left are measured by Gyroid."
                    },
                    Language: input.Language,
                    Width: 300
                }
            )
        )
        card.Add(foot)
        return card
    }

    private func Step(node NodeStatus) int32 -> switch node.Phase {
        case NodePhase.Core: 0
        case NodePhase.Checkpoints: 1
        case NodePhase.Starting, NodePhase.Detecting: 2
        case NodePhase.None, NodePhase.Connecting, NodePhase.ChainSync:
        node.Syncing && node.ChainHeight > node.Height + 2 ? 4: node.Peers == 0 ? 3: 4
    }

    private func Track(ui Presentation, share float64, checkpoint float64, color Color) Container {
        let bar = Container{BasedOn: AppTheme.TrackStyle, Height: AppTheme.Track10, BorderRadius: AppTheme.Radius3}
        if checkpoint > 0 {
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Top: 4,
                    Height: 2,
                    Width: Percent(checkpoint * 100),
                    BackgroundColor: AppTheme.LimeSoft
                }
            )
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: Percent(checkpoint * 100),
                    Top: -7,
                    Bottom: -7,
                    Width: 2,
                    BackgroundColor: AppTheme.Blue
                }
            )
        }
        bar.Add(
            Progress(
                ui.Strings.Get("syncing"),
                share,
                color,
                0,
                AppTheme.Track10,
                Color.Transparent,
                widthLength: Percent(100)
            )
        )
        return Container{FlexShrink: 0, bar}
    }

    private func Slots(ui Presentation, peers uint64, limit uint64) Blob {
        let row = SegmentGrid(
            1,
            int32(limit),
            index -> Container{
                BasedOn: AppTheme.TrackStyle,
                FlexGrow: 1,
                FlexBasis: 0,
                BorderRadius: AppTheme.Radius3,
                BackgroundColor: uint64(index) < peers ? AppTheme.Lime: AppTheme.FaintRule
            },
            minHeight: AppTheme.Track10,
            maxHeight: AppTheme.Track10
        )
        return Container{
            FlexShrink: 0,
            Gap: AppTheme.Space10,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: ui.Strings.Get("outbound slots") + " " + peers.ToString() + " / " + limit.ToString()
            },
            row,
            Container{
                FlexDirection: FlexDirection.Row,
                Grow(Label(ui, ui.Strings.Get("outbound slots"), AppTheme.Type13, AppTheme.Body, "")),
                Label(ui, Math.Min(peers, limit).ToString(), AppTheme.Type12, AppTheme.Lime, ""),
                Label(ui, " / " + limit.ToString(), AppTheme.Type12, AppTheme.Dim, "")
            }
        }
    }
}

data struct SyncStepsInput {
    var Ui Presentation
    var Language string
    var Step int32
    var ExecutedPhases int32
    var CheckpointHeight uint64
    var Peers uint64
}

class SyncSteps : Cell[SyncStepsInput] {
    protected override func Build(input SyncStepsInput) Blob -> Steps(input.Ui, input, input.Step)

    private func StepName(step int32) string -> switch step {
        case 0: "core download"
        case 1: "checkpoints"
        case 2: "starting"
        case 3: "connecting"
        default: "syncing"
    }

    private func Steps(ui Presentation, node SyncStepsInput, step int32) Blob ->
    Stepper{
        Labels: []string{
            ui.Strings.Get(StepName(0)),
            ui.Strings.Get(StepName(1)),
            ui.Strings.Get(StepName(2)),
            ui.Strings.Get(StepName(3)),
            ui.Strings.Get(StepName(4))
        },
        CurrentIndex: step,
        AccessibilityName: ui.Strings.Get("syncing"),
        Gap: AppTheme.Space8,
        FontSize: AppTheme.Type13,
        CreateStep: (state, index, label) -> {
            let current = index == state.CurrentIndex
            let skipped = index < state.CurrentIndex &&
                (node.ExecutedPhases & (1 << (index + int32(NodePhase.Core)))) == 0
            let done = index < state.CurrentIndex && !skipped
            let detail = if done && index == 1 && node.CheckpointHeight > 0 {
                Count(node.CheckpointHeight)
            } else if done && index == 3 {
                node.Peers.ToString() + " " + ui.Strings.Get("peers")
            } else {
                ""
            }
            label.Color = current ? AppTheme.Lime: done ? AppTheme.Ink: AppTheme.Dim
            return Container{
                MinWidth: 0,
                Gap: AppTheme.Space6,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.ListItem,
                    Name: ui.Strings.Get(StepName(index)) + " " + ui.Strings.Get(
                        done ? "completed": current ? "current": skipped ? "skipped": "upcoming"
                    ) +
                        (detail.Length > 0 ? " " + detail: "")
                },
                Container{
                    Height: AppTheme.ControlCompact,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    BorderRadius: AppTheme.Radius8,
                    BackgroundColor: current ? AppTheme.LimeQuiet: done ? AppTheme.Rule: Color.Transparent,
                    label
                },
                Container{
                    Height: AppTheme.Type12 + AppTheme.Space2,
                    Label(ui, detail, AppTheme.Type12, AppTheme.Dim, "")
                }
            }
        }
    }.Build()
}

data struct SyncChartInput {
    var Ui Presentation
    var Language string
    var Samples[]SyncSample
    var Now float64
    var Step int32
    var Peak float64
    var Stalled bool
    var Width float64
    var Height float64
    var Fill bool
}

class SyncChart : Cell {
    private let spark ElementHandle = ElementHandle()
    private var input SyncChartInput
    private var accepted bool
    private var chart Blob = Container{}
    private var measuredHeight float64

    init() {
        spark.MetricsChanged += _ -> {
            if input.Fill && measuredHeight != spark.BorderBox.Height {
                measuredHeight = spark.BorderBox.Height
                Prepare()
            }
        }
    }

    func Accept(next SyncChartInput) {
        if !accepted || input != next {
            input = next
            accepted = true
            Prepare()
        }
    }

    private func Prepare() {
        chart = Spark(
            input.Ui,
            input.Samples,
            input.Now,
            input.Step == 3 ? 15.0: 120.0,
            input.Peak,
            input.Stalled ? AppTheme.Orange: AppTheme.Lime,
            input.Stalled ? AppTheme.OrangeQuiet: AppTheme.LimeQuiet,
            input.Step == 3 ? "peers · 15 s": "blk/s · 2 min",
            input.Width,
            input.Height,
            input.Fill
        )
        Rebuild()
    }

    override func Build() Blob -> chart

    private func Spark(
        ui Presentation,
        samples[]SyncSample,
        now float64,
        span float64,
        top float64,
        color Color,
        fill Color,
        label string,
        width float64,
        windowHeight float64,
        stretch bool
    ) Blob {
        let height = stretch ? Math.Max(1.0, spark.BorderBox.Height): Math.Clamp(windowHeight * 0.08, 44, 70)
        let plot = Math.Max(1.0, width - 40)
        let line = PathBuilder(0, 0, plot, height)
        let area = PathBuilder(0, 0, plot, height)
        var first = true
        var lastY = height - 2
        for sample in samples {
            let x = Math.Clamp((sample.Seconds - now + span) / span * plot, 0, plot)
            let y = height - 2 - (height - 14) * Math.Min(sample.Value, top) / top
            if first {
                line.MoveTo(x, y)
                area.MoveTo(x, height - 2).LineTo(x, y)
                first = false
            } else {
                line.LineTo(x, y)
                area.LineTo(x, y)
            }
            lastY = y
        }
        let chart = Container{
            Height: height,
            FlexShrink: 0,
            Accessibility: Accessibility{Role: AccessibilityRole.Image, Name: ui.Strings.Get(label)},
            Container{
                Position: PositionType.Absolute,
                Left: 0,
                Bottom: 1,
                Width: plot,
                Height: 1,
                BackgroundColor: AppTheme.Edge
            },
            Container{
                Position: PositionType.Absolute,
                Left: 0,
                Top: -4,
                Label(ui, ui.Strings.Get(label), AppTheme.Type11, AppTheme.Dim, "")
            }
        }
        if stretch {
            chart.Handle = spark
            chart.Height = Length.Auto
            chart.FlexGrow = 1
            chart.FlexBasis = 0
            chart.MinHeight = 0
        }
        if samples.Length > 0 {
            line.LineTo(plot, lastY)
            area.LineTo(plot, lastY).LineTo(plot, height - 2).Close()
            chart.Add(
                Shape{
                    Position: PositionType.Absolute,
                    Width: plot,
                    Height: height,
                    Path: area.Build(),
                    Fit: ShapeFit.Fill,
                    BackgroundColor: fill
                }
            )
            chart.Add(
                Shape{
                    Position: PositionType.Absolute,
                    Width: plot,
                    Height: height,
                    Path: line.Build(),
                    Fit: ShapeFit.Fill,
                    BorderWidth: 1.6,
                    BorderColor: color
                }
            )
            chart.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: plot + 6,
                    Top: lastY - 8,
                    Label(
                        ui,
                        Math.Round(samples[samples.Length - 1].Value).ToString(CultureInfo.InvariantCulture),
                        AppTheme.Type12,
                        color,
                        ""
                    )
                }
            )
        }
        return chart
    }
}

data struct SyncReadingsInput {
    var Ui Presentation
    var Language string
    var Step int32
    var DownloadPercent int32
    var Peers uint64
    var Limit uint64
    var Progress uint64
    var LocalHeight uint64
    var ChainHeight uint64
    var Rate float64
    var Listen string
    var Since int64
    var Stalled bool
    var Width float64
    var Height float64
    var Fill bool
}

class SyncReadings : Cell[SyncReadingsInput] {
    protected override func Build(input SyncReadingsInput) Blob {
        let ui = input.Ui
        let node = input
        let step = input.Step
        let stalled = input.Stalled
        let size = AppTheme.GetStatusFigureSize(input.Height, input.Fill)
        let mid = Container{
            FlexGrow: input.Fill ? 0.0: 1.0,
            FlexDirection: FlexDirection.Row,
            FlexWrap: FlexWrap.Wrap,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.GetFigureGap(input.Width)
        }
        if step < 2 {
            let percent = node.DownloadPercent
            mid.Add(
                Figure(
                    ui,
                    percent.ToString(),
                    "%",
                    ui.Strings.Get(StepName(step)) + " " + percent.ToString() + "%",
                    AppTheme.Lime,
                    size
                )
            )
        } else if step == 2 {
            mid.Add(Label(ui, ui.Strings.Get("starting"), AppTheme.Type18, AppTheme.Body, ""))
        } else if step == 3 {
            let limit = node.Limit
            mid.Add(
                Figure(
                    ui,
                    node.Peers.ToString(),
                    "/ " + limit.ToString() + " " + ui.Strings.Get("peers"),
                    node.Peers.ToString() + " / " + limit.ToString() + " " + ui.Strings.Get("peers"),
                    AppTheme.Lime,
                    size
                )
            )
            let port = node.Listen.Split('/')
            mid.Add(
                Readings(
                    ui,
                    []string{
                        "Since",
                        Clock(input.Since),
                        "Port",
                        if port.Length > 4 {
                            port[3] + " " + port[4]
                        } else {
                            "-"
                        },
                        "Local height",
                        Count(node.LocalHeight)
                    }
                )
            )
        } else {
            let done = node.Progress
            let share = node.ChainHeight > 0 ? Math.Min(1.0, float64(done) / node.ChainHeight): 0.0
            let percent = (Math.Floor(share * 1000) / 10).ToString("0.0", CultureInfo.InvariantCulture)
            mid.Add(
                Figure(
                    ui,
                    percent,
                    "%",
                    ui.Strings.Get("syncing") + " " + percent + "%",
                    stalled ? AppTheme.Ink: AppTheme.Lime,
                    size
                )
            )
            let rate = stalled ? 0.0: node.Rate
            mid.Add(
                Readings(
                    ui,
                    []string{
                        "Height",
                        Count(done) + " / " + Count(node.ChainHeight),
                        "Speed",
                        String.Format(ui.Strings.Get("{0} blk/s"), Math.Round(rate)),
                        "Remaining",
                        if rate > 0 {
                            String.Format(
                                ui.Strings.Get("~{0} min"),
                                Math.Max(1.0, Math.Ceiling(float64(node.ChainHeight - done) / rate / 60))
                            )
                        } else {
                            "-"
                        },
                        "Peers",
                        node.Peers.ToString()
                    },
                    stalled
                )
            )
        }
        return mid
    }

    private func StepName(step int32) string -> switch step {
        case 0: "core download"
        case 1: "checkpoints"
        case 2: "starting"
        case 3: "connecting"
        default: "syncing"
    }

    private func Figure(
        ui Presentation,
        value string,
        unit string,
        name string,
        color Color,
        size float64
    ) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Baseline,
        Gap: AppTheme.Space4,
        FlexShrink: 0,
        Value(ui, "figure", name, value, size, color),
        Label(ui, unit, AppTheme.GetInsetTextSize(size), AppTheme.Body, "")
    }

    private func Readings(ui Presentation, pairs[]string, stalled bool = false) Blob {
        let grid = Container{Gap: AppTheme.Space10, FlexShrink: 0}
        for index in 0 ... pairs.Length / 2 {
            let label = pairs[index * 2]
            let value = pairs[index * 2 + 1]
            if label == "Height" {
                let split = value.IndexOf(" / ")
                grid.Add(
                    KeyValue(
                        ui,
                        ui.Strings.Get(label),
                        Container{
                            FlexDirection: FlexDirection.Row,
                            Label(ui, value.Substring(0, split), AppTheme.Type12, AppTheme.Lime, ""),
                            Label(ui, value.Substring(split), AppTheme.Type12, AppTheme.Dim, "")
                        },
                        labelWidth: 100
                    )
                )
            } else {
                grid.Add(
                    KeyValue(
                        ui,
                        ui.Strings.Get(label),
                        value,
                        valueColor: stalled && label == "Speed" ? AppTheme.Orange: AppTheme.Ink,
                        labelWidth: 100
                    )
                )
            }
        }
        return grid
    }
}
