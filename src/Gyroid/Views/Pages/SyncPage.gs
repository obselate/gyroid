package Gyroid.Views

import Goo
import Goo.Widgets.Icons
import Gyroid.Components
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization

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

class SyncPage : Cell[SyncInput] {
    private let started int64 = Stopwatch.GetTimestamp()
    private let peerSamples List[SyncSample] = List[SyncSample]()
    private let rateSamples List[SyncSample] = List[SyncSample]()
    private var seen NodeStatus? = nil
    private var connectingSince int64
    private var heightSince float64
    private var lastHeight uint64
    private var stallTimer WindowTimer?
    private let spark ElementHandle = ElementHandle()

    init() {
        spark.MetricsChanged += _ -> Rebuild()
    }

    protected override func Build(input SyncInput) Blob {
        let ui = input.Ui
        let node = input.Node
        let now = Stopwatch.GetElapsedTime(started).TotalSeconds
        let step = Step(node)
        if seen != node {
            seen = node
            Record(input, step, now)
        }
        let stalled = step == 4 && now - heightSince >= 60
        let padX = AppTheme.GetPanelPadding(input.Width)
        let width = input.Fill ? input.Width: Math.Min(760, input.Width - 48)
        let inner = width - padX * 2
        let card = WalletParts.Card(ui)
        card.Width = width
        card.MinHeight = input.Fill ? 0.0: Math.Min(420, input.Height - 100)
        if input.Fill {
            card.Width = Percent(100)
            card.FlexGrow = 1
            card.FlexBasis = 0
        }
        card.BorderRadius = AppTheme.Radius14
        card.Padding = Edges{
            Left: padX,
            Right: padX,
            Top: AppTheme.GetPanelBlockPadding(input.Height),
            Bottom: AppTheme.GetPanelBlockPadding(input.Height)
        }
        card.Gap = AppTheme.GetPanelGap(input.Height)
        card.Accessibility = Accessibility{Live: AccessibilityLive.Polite}
        card.Add(Steps(ui, node, step))
        let size = AppTheme.GetStatusFigureSize(input.Height, input.Fill)
        let mid = Container{
            FlexGrow: input.Fill ? 0.0: 1.0,
            FlexDirection: FlexDirection.Row,
            FlexWrap: FlexWrap.Wrap,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.GetFigureGap(input.Width)
        }
        card.Add(mid)
        if step < 2 {
            let percent = node.DownloadPercent ?? 0
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
            card.Add(Track(ui, percent / 100.0, 0, AppTheme.Lime))
        } else if step == 2 {
            mid.Add(Label(ui, ui.Strings.Get("starting"), AppTheme.Type18, AppTheme.Body, ""))
        } else if step == 3 {
            let limit = Math.Max(node.MaxOutbound, uint64(1))
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
            let since = DateTimeOffset.UtcNow.AddSeconds(-Stopwatch.GetElapsedTime(connectingSince).TotalSeconds)
            let port = node.Listen.Split('/')
            mid.Add(
                Readings(
                    ui,
                    []string{
                        "Since",
                        Clock(since.ToUnixTimeSeconds()),
                        "Port",
                        if port.Length > 4 {
                            port[3] + " " + port[4]
                        } else {
                            "-"
                        },
                        "Local height",
                        Count(node.Height)
                    }
                )
            )
            card.Add(
                Spark(
                    ui,
                    peerSamples,
                    now,
                    15,
                    limit,
                    AppTheme.Lime,
                    AppTheme.LimeQuiet,
                    "peers · 15 s",
                    inner,
                    input.Height,
                    input.Fill
                )
            )
            card.Add(Slots(ui, node.Peers, limit))
        } else {
            let done = node.SyncProgress ?? node.Height
            let share = node.ChainHeight > 0 ? Math.Min(1.0, float64(done) / node.ChainHeight): 0.0
            let percent = (Math.Floor(share * 1000) / 10).ToString("0.0", CultureInfo.InvariantCulture)
            let color = stalled ? AppTheme.Orange: AppTheme.Lime
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
            let rate = stalled ? 0.0: node.SyncRate
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
            var top = 1.0
            for sample in rateSamples {
                top = Math.Max(top, sample.Value * 1.25)
            }
            card.Add(
                Spark(
                    ui,
                    rateSamples,
                    now,
                    120,
                    top,
                    color,
                    stalled ? AppTheme.OrangeQuiet: AppTheme.LimeQuiet,
                    "blk/s · 2 min",
                    inner,
                    input.Height,
                    input.Fill
                )
            )
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
                        String.Format(
                            ui.Strings.Get("no new blocks since {0}"),
                            Clock(DateTimeOffset.UtcNow.AddSeconds(heightSince - now).ToUnixTimeSeconds())
                        ),
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

    private func Record(input SyncInput, step int32, now float64) {
        let node = input.Node
        if step != 3 {
            connectingSince = 0
        } else if connectingSince == 0 {
            connectingSince = Stopwatch.GetTimestamp()
        }
        let progress = node.SyncProgress ?? node.Height
        if progress != lastHeight || heightSince == 0 || step == 4 && stallTimer == nil {
            lastHeight = progress
            heightSince = now
            stallTimer?.Dispose()
            stallTimer = step == 4 ? input.Ui.Actions.Delay(60000, () -> Rebuild()): nil
        }
        peerSamples.Add(SyncSample{Seconds: now, Value: float64(node.Peers)})
        peerSamples.RemoveAll(sample -> sample.Seconds < now - 15)
        if step == 4 {
            rateSamples.Add(SyncSample{Seconds: now, Value: now - heightSince >= 60 ? 0.0: node.SyncRate})
            rateSamples.RemoveAll(sample -> sample.Seconds < now - 120)
        }
    }

    private func Step(node NodeStatus) int32 -> switch node.Phase {
        case NodePhase.Core: 0
        case NodePhase.Checkpoints: 1
        case NodePhase.Starting, NodePhase.Detecting: 2
        case NodePhase.None, NodePhase.Connecting, NodePhase.ChainSync:
        node.Syncing && node.ChainHeight > node.Height + 2 ? 4: node.Peers == 0 ? 3: 4
    }

    private func StepName(step int32) string -> switch step {
        case 0: "core download"
        case 1: "checkpoints"
        case 2: "starting"
        case 3: "connecting"
        default: "syncing"
    }

    private func Steps(ui Presentation, node NodeStatus, step int32) Blob {
        let row = Container{
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space8,
            Accessibility: Accessibility{Role: AccessibilityRole.List}
        }
        for index in 0 ... 5 {
            let done = index < step
            let marker = Container{
                Width: 20,
                Height: 20,
                FlexShrink: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                BorderRadius: AppTheme.Radius10,
                BorderWidth: index == step ? AppTheme.Border0: AppTheme.Border1,
                BorderColor: done ? AppTheme.Lime: AppTheme.Edge
            }
            if done {
                marker.Add(MaterialIcons.Create("check", AppTheme.Icon16, AppTheme.Lime))
            } else if index == step {
                marker.Add(
                    Shape{
                        Width: 20,
                        Height: 20,
                        Path: PathBuilder(0, 0, 20, 20)
                            .MoveTo(10, 1)
                            .ArcTo(9, 9, 0, false, true, 10, 19)
                            .ArcTo(9, 9, 0, false, true, 10, 1)
                            .Build(),
                        Fit: ShapeFit.Fill,
                        BorderWidth: AppTheme.Border2,
                        BorderColor: AppTheme.Lime,
                        StrokeEnd: 0.75
                    }
                )
            }
            let line = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                marker
            }
            line.Add(
                Label(
                    ui,
                    ui.Strings.Get(StepName(index)),
                    AppTheme.Type13,
                    if index == step {
                        AppTheme.Lime
                    } else if done {
                        AppTheme.Ink
                    } else {
                        AppTheme.Dim
                    },
                    ""
                )
            )
            if index < 4 {
                line.Add(
                    Container{
                        FlexGrow: 1,
                        Height: 1,
                        MinWidth: 6,
                        Margin: Edges{Right: AppTheme.Space6},
                        BackgroundColor: done ? AppTheme.LimeMuted: AppTheme.Edge
                    }
                )
            }
            let value = if !done {
                ""
            } else if index == 1 && node.CheckpointHeight > 0 {
                Count(node.CheckpointHeight)
            } else if index == 3 {
                node.Peers.ToString() + " " + ui.Strings.Get("peers")
            } else {
                ""
            }
            row.Add(
                Container{
                    FlexGrow: index < 4 ? 1.0: 0.0,
                    FlexShrink: index < 4 ? 1.0: 0.0,
                    MinWidth: 0,
                    Gap: AppTheme.Space6,
                    Accessibility: Accessibility{
                        Role: AccessibilityRole.ListItem,
                        Name: ui.Strings.Get(StepName(index)) + " " + value
                    },
                    line,
                    Container{
                        Height: 15,
                        Padding: Edges{Left: AppTheme.Space28},
                        Label(ui, value, AppTheme.Type12, AppTheme.Dim, "")
                    }
                }
            )
        }
        return row
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
        Cell.Mount[DecodeValueInput, DecodeValue](
            "figure",
            DecodeValueInput{
                Value: value,
                Name: name,
                Size: size,
                Color: color,
                FractionColor: color,
                Live: AccessibilityLive.Off,
                Ui: ui
            }
        ),
        Label(ui, unit, AppTheme.GetInsetTextSize(size), AppTheme.Body, "")
    }

    private func Readings(ui Presentation, pairs[]string, stalled bool = false) Blob {
        let grid = Container{Gap: AppTheme.Space10, FlexShrink: 0}
        for index in 0 ... pairs.Length / 2 {
            let label = pairs[index * 2]
            let value = pairs[index * 2 + 1]
            let row = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Baseline,
                Gap: AppTheme.Space22,
                Accessibility: Accessibility{Name: ui.Strings.Get(label) + " " + value},
                Container{
                    Width: 100,
                    FlexShrink: 0,
                    Label(ui, ui.Strings.Get(label), AppTheme.Type13, AppTheme.Body, "")
                }
            }
            if label == "Height" {
                let split = value.IndexOf(" / ")
                row.Add(
                    Container{
                        FlexDirection: FlexDirection.Row,
                        Label(ui, value.Substring(0, split), AppTheme.Type14, AppTheme.Lime, ""),
                        Label(ui, value.Substring(split), AppTheme.Type14, AppTheme.Dim, "")
                    }
                )
            } else {
                row.Add(
                    Label(ui, value, AppTheme.Type14, stalled && label == "Speed" ? AppTheme.Orange: AppTheme.Ink, "")
                )
            }
            grid.Add(row)
        }
        return grid
    }

    private func Spark(
        ui Presentation,
        samples List[SyncSample],
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
        var lastX = 0.0
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
            lastX = x
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
        if samples.Count > 0 {
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
                        Math.Round(samples[samples.Count - 1].Value).ToString(CultureInfo.InvariantCulture),
                        AppTheme.Type12,
                        color,
                        ""
                    )
                }
            )
        }
        return chart
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
            Container{
                Position: PositionType.Absolute,
                Left: 0,
                Top: 0,
                Bottom: 0,
                Width: Percent(share * 100),
                BorderRadius: AppTheme.Radius3,
                BackgroundColor: color
            }
        )
        return Container{FlexShrink: 0, bar}
    }

    private func Slots(ui Presentation, peers uint64, limit uint64) Blob {
        let row = Container{FlexDirection: FlexDirection.Row, Gap: AppTheme.Space4}
        for index in 0 ... int32(limit) {
            row.Add(
                Container{
                    BasedOn: AppTheme.TrackStyle,
                    FlexGrow: 1,
                    FlexBasis: 0,
                    Height: AppTheme.Track10,
                    BorderRadius: AppTheme.Radius3,
                    BackgroundColor: uint64(index) < peers ? AppTheme.Lime: AppTheme.FaintRule
                }
            )
        }
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
