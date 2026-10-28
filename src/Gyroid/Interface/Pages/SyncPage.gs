package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Gyroid.Node
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
        let padX = Math.Clamp(input.Width * 0.03, 20, 32)
        let width = Math.Min(760, input.Width - 48)
        let inner = width - padX * 2
        let card = ui.Glass()
        card.Width = width
        card.MinHeight = Math.Min(420, input.Height - 100)
        card.BorderRadius = 14
        card.Padding = Edges{
            Left: padX,
            Right: padX,
            Top: Math.Clamp(input.Height * 0.034, 18, 30),
            Bottom: Math.Clamp(input.Height * 0.034, 18, 30)
        }
        card.Gap = Math.Clamp(input.Height * 0.032, 16, 28)
        card.Accessibility = Accessibility{Live: AccessibilityLive.Polite}
        card.Add(Steps(ui, node, step))
        let size = Math.Clamp(input.Height * 0.11, 48, 92)
        let mid = Container{
            FlexGrow: 1,
            FlexDirection: FlexDirection.Row,
            FlexWrap: FlexWrap.Wrap,
            AlignItems: AlignItems.Center,
            Gap: Math.Clamp(input.Width * 0.04, 20, 52)
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
                    ui.Lime,
                    size
                )
            )
            card.Add(Track(ui, percent / 100.0, 0, ui.Lime))
        } else if step == 2 {
            mid.Add(ui.Label(ui.Strings.Get("starting"), 18, ui.Body, ""))
        } else if step == 3 {
            let limit = Math.Max(node.MaxOutbound, uint64(1))
            mid.Add(
                Figure(
                    ui,
                    node.Peers.ToString(),
                    "/ " + limit.ToString() + " " + ui.Strings.Get("peers"),
                    node.Peers.ToString() + " / " + limit.ToString() + " " + ui.Strings.Get("peers"),
                    ui.Lime,
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
                        ui.Clock(since.ToUnixTimeSeconds()),
                        "Port",
                        if port.Length > 4 {
                            port[3] + " " + port[4]
                        } else {
                            "-"
                        },
                        "Local height",
                        ui.Count(node.Height)
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
                    ui.Lime,
                    Color.Parse("#1b2609"),
                    "peers · 15 s",
                    inner,
                    input.Height
                )
            )
            card.Add(Slots(ui, node.Peers, limit))
        } else {
            let done = node.SyncProgress ?? node.Height
            let share = node.ChainHeight > 0 ? Math.Min(1.0, float64(done) / node.ChainHeight): 0.0
            let percent = (Math.Floor(share * 1000) / 10).ToString("0.0", CultureInfo.InvariantCulture)
            let color = stalled ? ui.Orange: ui.Lime
            mid.Add(
                Figure(
                    ui,
                    percent,
                    "%",
                    ui.Strings.Get("syncing") + " " + percent + "%",
                    stalled ? ui.Ink: ui.Lime,
                    size
                )
            )
            let rate = stalled ? 0.0: node.SyncRate
            mid.Add(
                Readings(
                    ui,
                    []string{
                        "Height",
                        ui.Count(done) + " / " + ui.Count(node.ChainHeight),
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
                    stalled ? Color.Parse("#261c09"): Color.Parse("#1b2609"),
                    "blk/s · 2 min",
                    inner,
                    input.Height
                )
            )
            let checkpoint = node.ChainHeight > 0 ? Math.Min(
                1.0,
                float64(node.CheckpointHeight) / node.ChainHeight
            ): 0.0
            let track = Track(ui, share, checkpoint, color)
            track.Padding = Edges{Bottom: 22}
            track.Add(Container{Position: PositionType.Absolute, Left: 0, Top: 20, ui.Label("#0", 12, ui.Dim, "")})
            if node.CheckpointHeight > 0 {
                track.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Right: 0,
                        Top: 20,
                        FlexDirection: FlexDirection.Row,
                        Gap: 6,
                        ui.Label(ui.Strings.Get("checkpoint"), 12, ui.Body, ""),
                        ui.Label(ui.Count(node.CheckpointHeight), 12, ui.Blue, "")
                    }
                )
            }
            card.Add(track)
        }
        let foot = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 12}
        foot.Add(
            ui.Grow(
                if stalled {
                    ui.Label(
                        String.Format(
                            ui.Strings.Get("no new blocks since {0}"),
                            ui.Clock(DateTimeOffset.UtcNow.AddSeconds(heightSince - now).ToUnixTimeSeconds())
                        ),
                        12,
                        ui.Orange,
                        ""
                    )
                } else {
                    ui.Label(ui.Strings.Get(node.Network) + " · v" + CoreRelease.Version, 12, ui.Dim, "")
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
        if node.Height != lastHeight || heightSince == 0 || step == 4 && stallTimer == nil {
            lastHeight = node.Height
            heightSince = now
            stallTimer?.Dispose()
            stallTimer = step == 4 ? input.Ui.Delay(60000, () -> Rebuild()): nil
        }
        peerSamples.Add(SyncSample{Seconds: now, Value: float64(node.Peers)})
        peerSamples.RemoveAll(sample -> sample.Seconds < now - 15)
        if step == 4 {
            rateSamples.Add(SyncSample{Seconds: now, Value: now - heightSince >= 60 ? 0.0: node.SyncRate})
            rateSamples.RemoveAll(sample -> sample.Seconds < now - 120)
        }
    }

    private func Step(node NodeStatus) int32 -> switch node.Phase {
        case "Core": 0
        case "Checkpoints": 1
        case "Starting": 2
        case "Detecting": 2
        default: node.Syncing && node.ChainHeight > node.Height + 2 ? 4: node.Peers == 0 ? 3: 4
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
            Gap: 8,
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
                BorderRadius: 10,
                BorderWidth: index == step ? 0.0: 1.0,
                BorderColor: done ? ui.Lime: ui.Edge
            }
            if done {
                marker.Add(MaterialIcons.Create("check", 13, ui.Lime))
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
                        BorderWidth: 2,
                        BorderColor: ui.Lime,
                        StrokeEnd: 0.75
                    }
                )
            }
            let line = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, marker}
            line.Add(
                ui.Label(
                    ui.Strings.Get(StepName(index)),
                    12.5,
                    if index == step {
                        ui.Lime
                    } else if done {
                        ui.Ink
                    } else {
                        ui.Dim
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
                        Margin: Edges{Right: 6},
                        BackgroundColor: done ? Color.Parse("#4d7300"): ui.Edge
                    }
                )
            }
            let value = if !done {
                ""
            } else if index == 1 && node.CheckpointHeight > 0 {
                ui.Count(node.CheckpointHeight)
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
                    Gap: 6,
                    Accessibility: Accessibility{
                        Role: AccessibilityRole.ListItem,
                        Name: ui.Strings.Get(StepName(index)) + " " + value
                    },
                    line,
                    Container{Height: 15, Padding: Edges{Left: 28}, ui.Label(value, 12, ui.Dim, "")}
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
        Gap: 4,
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
        ui.Label(unit, Math.Round(size * 0.36), ui.Body, "")
    }

    private func Readings(ui Presentation, pairs[]string, stalled bool = false) Blob {
        let grid = Container{Gap: 10, FlexShrink: 0}
        for index in 0 ... pairs.Length / 2 {
            let label = pairs[index * 2]
            let value = pairs[index * 2 + 1]
            let row = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Baseline,
                Gap: 22,
                Accessibility: Accessibility{Name: ui.Strings.Get(label) + " " + value},
                ui.Grow(ui.Label(ui.Strings.Get(label), 13, ui.Body, ""))
            }
            if label == "Height" {
                let split = value.IndexOf(" / ")
                row.Add(
                    Container{
                        FlexDirection: FlexDirection.Row,
                        ui.Label(value.Substring(0, split), 14, ui.Lime, ""),
                        ui.Label(value.Substring(split), 14, ui.Dim, "")
                    }
                )
            } else {
                row.Add(ui.Label(value, 14, stalled && label == "Speed" ? ui.Orange: ui.Ink, ""))
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
        windowHeight float64
    ) Blob {
        let height = Math.Clamp(windowHeight * 0.08, 44, 70)
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
                BackgroundColor: ui.Edge
            },
            Container{
                Position: PositionType.Absolute,
                Left: 0,
                Top: -4,
                ui.Label(ui.Strings.Get(label), 11, ui.Dim, "")
            }
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
                    ui.Label(
                        Math.Round(samples[samples.Count - 1].Value).ToString(CultureInfo.InvariantCulture),
                        12,
                        color,
                        ""
                    )
                }
            )
        }
        return chart
    }

    private func Track(ui Presentation, share float64, checkpoint float64, color Color) Container {
        let bar = Container{Height: 10, BorderRadius: 3, BackgroundColor: Color.Parse("#141414")}
        if checkpoint > 0 {
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Top: 4,
                    Height: 2,
                    Width: Percent(checkpoint * 100),
                    BackgroundColor: Color.Parse("#253807")
                }
            )
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: Percent(checkpoint * 100),
                    Top: -7,
                    Bottom: -7,
                    Width: 2,
                    BackgroundColor: ui.Blue
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
                BorderRadius: 3,
                BackgroundColor: color
            }
        )
        return Container{FlexShrink: 0, bar}
    }

    private func Slots(ui Presentation, peers uint64, limit uint64) Blob {
        let row = Container{FlexDirection: FlexDirection.Row, Gap: 4}
        for index in 0 ... int32(limit) {
            row.Add(
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    Height: 10,
                    BorderRadius: 3,
                    BackgroundColor: uint64(index) < peers ? ui.Lime: Color.Parse("#141414")
                }
            )
        }
        return Container{
            FlexShrink: 0,
            Gap: 10,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: ui.Strings.Get("outbound slots") + " " + peers.ToString() + " / " + limit.ToString()
            },
            row,
            Container{
                FlexDirection: FlexDirection.Row,
                ui.Grow(ui.Label(ui.Strings.Get("outbound slots"), 13, ui.Body, "")),
                ui.Label(Math.Min(peers, limit).ToString(), 12, ui.Lime, ""),
                ui.Label(" / " + limit.ToString(), 12, ui.Dim, "")
            }
        }
    }
}
