package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Gyroid.Components
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Globalization
import System.Threading
import System.Threading.Tasks

data struct MiningSample {
    var Time DateTimeOffset
    var Hashes uint64
    var Rate float64
}

class MiningHistory {
    var Status MiningStatus
    let Samples List[MiningSample] = List[MiningSample]()
}

data struct MiningPageInput {
    var Ui Presentation
    var Session WalletSession
    var Window Window?
    var History MiningHistory
    var Wallet string
    var Language string
    var Busy bool
    var Height float64
    var Visible bool
    var NodeRunning bool
}

class MiningPage : Cell[MiningPageInput], IDisposable {
    private let plot ElementHandle = ElementHandle()

    private let shutdown CancellationTokenSource = CancellationTokenSource()
    private let refreshRequested chan[bool] = chan[bool](1)
    private var worker Task? = nil

    private var opened bool

    private var disposed bool
    private var visible bool
    private var unavailable bool
    private var running bool
    private var nodeRunning bool

    private var hover int32 = -1

    protected override func Build(input MiningPageInput) Blob {
        let shown = input.Visible
        let connected = input.NodeRunning
        if nodeRunning != connected {
            nodeRunning = connected
            if opened && connected {
                refreshRequested.Writer.TryWrite(true)
            }
        }
        if visible != shown {
            visible = shown
            if opened && shown {
                refreshRequested.Writer.TryWrite(true)
            }
        }
        if !opened {
            opened = true
            worker = RunWorkerAsync(input, Context.FromToken(shutdown.Token))
        }
        let ui = input.Ui
        let status = input.History.Status
        let compact = input.Height < 700
        let card = WalletParts.Card(ui)
        card.Width = Percent(100)
        card.BorderRadius = AppTheme.Radius14
        card.Padding = if compact {
            Edges{Top: AppTheme.Space14, Bottom: AppTheme.Space14, Left: AppTheme.Space16, Right: AppTheme.Space16}
        } else {
            Edges{Top: AppTheme.Space16, Bottom: AppTheme.Space16, Left: AppTheme.Space22, Right: AppTheme.Space22}
        }
        card.Gap = compact ? AppTheme.Space10: AppTheme.Space12
        let head = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            MinHeight: 34,
            FlexShrink: 0,
            Label(ui, ui.Strings.Get("mining"), AppTheme.Type17, AppTheme.Ink, ""),
            Container{FlexGrow: 1},
            Cell.Mount[InfoTipInput, InfoTip](
                "about",
                InfoTipInput{
                    Ui: ui,
                    Topic: "About mining",
                    Lines: []string{
                        "The node mines with this computer's CPU. Each thread uses about 2 GiB of memory",
                        "Rewards go to the wallet that is open when mining starts",
                        "Mining waits for at least one peer"
                    },
                    Language: input.Language,
                    Width: 300
                }
            )
        }
        card.Add(head)
        if unavailable || !input.Session.Node.Status.Running {
            card.MaxWidth = 620
            card.Add(Label(ui, ui.Strings.Get("Node unavailable"), AppTheme.Type14, AppTheme.Body, ""))
            return Container{FlexGrow: 1, AlignItems: AlignItems.Center, JustifyContent: JustifyContent.Center, card}
        }
        if !status.Running {
            card.MaxWidth = 620
            card.Add(Setup(input))
            return Container{
                FlexGrow: 1,
                MinHeight: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                card
            }
        }
        head.Add(
            Command(
                input,
                "stop",
                "Stop",
                AppTheme.Ink,
                AppTheme.Edge,
                () -> Act(input, ct -> input.Session.Mining.StopAsync(ct))
            )
        )
        card.MaxWidth = 1180
        card.FlexGrow = 1
        let samples = input.History.Samples
        let rate = if samples.Count > 0 {
            samples[samples.Count - 1].Rate
        } else {
            status.Hashrate
        }
        let text = rate.ToString("F1", CultureInfo.InvariantCulture)
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexEnd,
                Gap: AppTheme.Space8,
                FlexShrink: 0,
                Cell.Mount[DecodeValueInput, DecodeValue](
                    "rate",
                    DecodeValueInput{
                        Value: text,
                        Name: ui.Strings.Get("hashrate") + " " + text + " H/s",
                        Size: AppTheme.GetMajorFigureSize(input.Height),
                        Color: AppTheme.Ink,
                        FractionColor: AppTheme.Ink,
                        Live: AccessibilityLive.Off,
                        Ui: ui
                    }
                ),
                Container{Padding: Edges{Bottom: AppTheme.Space4}, Label(ui, "H/s", AppTheme.Type16, AppTheme.Body, "")}
            }
        )
        card.Add(Chart(input))
        let stats = Container{
            FlexDirection: FlexDirection.Row,
            Gap: compact ? AppTheme.Space8: AppTheme.Space12,
            Padding: Edges{Top: AppTheme.Space12},
            BorderWidth: Edges{Top: AppTheme.Border1},
            BorderColor: AppTheme.Rule,
            FlexShrink: 0
        }
        let size = compact ? AppTheme.Type14: AppTheme.Type16
        stats.Add(Reading(ui, "threads", status.Threads.ToString(), size))
        stats.Add(Reading(ui, "hashes", Count(status.Hashes), size))
        stats.Add(Reading(ui, "blocks found", Count(status.Blocks), size))
        stats.Add(
            Reading(ui, "since", status.Started.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture), size)
        )
        card.Add(stats)
        return Container{FlexGrow: 1, MinHeight: 0, AlignItems: AlignItems.Center, card}
    }

    func Dispose() {
        disposed = true
        shutdown.Cancel()
        worker?.GetAwaiter().GetResult()
        shutdown.Dispose()
        refreshRequested.Writer.TryComplete()
    }

    private func Act(input MiningPageInput, action Func[CancellationToken, Task]) {
        input.Ui.Actions.Run(action, () -> refreshRequested.Writer.TryWrite(true))
    }

    private async func RunWorkerAsync(input MiningPageInput, parentContext Context) {
        try {
            scope {
                go Poll(input, ctx)
            }
        } catch (failure OperationCanceledException) when disposed { } catch (failure Exception) {
            Console.Error.WriteLine("Mining background task failed: " + failure.GetType().Name)
            input.Window?.TryPost(() -> input.Ui.Actions.Report("Mining background task failed"))
        }
    }

    private func Poll(input MiningPageInput, pageContext Context) {
        while !pageContext.IsCancelled {
            if visible {
                await Load(input, pageContext)
            }
            if visible && running {
                select {
                    case <- refreshRequested { }
                    case <- after(TimeSpan.FromSeconds(5)) { }
                }
            } else {
                select {
                    case <- refreshRequested { }
                }
            }
        }
    }

    private async func Load(input MiningPageInput, pageContext Context) {
        var status MiningStatus? = nil
        try {
            status = await input.Session.Mining.StatusAsync(pageContext.Token)
        } catch (failure OperationCanceledException) when pageContext.IsCancelled {
            return
        } catch (failure Exception) { }
        running = status?.Running == true
        input.Window?.TryPost(
            () -> {
                if disposed {
                    return
                }
                guard let value = status else {
                    unavailable = true
                    input.History.Samples.Clear()
                    Rebuild()
                    return
                }
                let recovered = unavailable
                unavailable = false
                let changed = value.Running ||
                    value.Running != input
                    .History
                    .Status
                    .Running ||
                    value.Threads != input
                    .History
                    .Status
                    .Threads
                Record(input.History, value)
                if changed || recovered {
                    Rebuild()
                }
            }
        )
    }

    private func Record(history MiningHistory, status MiningStatus) {
        let samples = history.Samples
        if !status.Running || status.Started != history.Status.Started {
            samples.Clear()
        }
        history.Status = status
        if !status.Running || status.Hashes == 0 {
            return
        }
        let now = DateTimeOffset.Now
        var rate = status.Hashrate
        for sample in samples {
            let seconds = (now - sample.Time).TotalSeconds
            if seconds <= 30 {
                if seconds >= 4 && status.Hashes >= sample.Hashes {
                    rate = float64(status.Hashes - sample.Hashes) / seconds
                }
                break
            }
        }
        samples.Add(MiningSample{Time: now, Hashes: status.Hashes, Rate: rate})
        if samples.Count > 720 {
            samples.RemoveAt(0)
        }
    }

    private func Setup(input MiningPageInput) Blob {
        let ui = input.Ui
        let threads = input.History.Status.Threads
        let cores = Environment.ProcessorCount
        let total = Math.Max(1.0, Math.Round(float64(GC.GetGCMemoryInfo().TotalAvailableMemoryBytes) / 1073741824))
        let share = Math.Min(1.0, float64(threads) * 2 / total)
        let wide = input.Height >= 700
        return Container{
            Gap: AppTheme.Space16,
            FlexShrink: 0,
            Container{
                Gap: AppTheme.Space10,
                Row(
                    ui,
                    wide,
                    "pays to",
                    Label(ui, ui.Strings.Get("this wallet") + " · " + input.Wallet, AppTheme.Type13, AppTheme.Ink, "")
                ),
                Row(
                    ui,
                    wide,
                    "CPU",
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        Gap: AppTheme.Space10,
                        Grow(
                            Label(
                                ui,
                                String.Format(ui.Strings.Get("{0} cores"), cores),
                                AppTheme.Type13,
                                AppTheme.Ink,
                                ""
                            )
                        ),
                        WalletParts.Square(
                            ui,
                            "chevron_left",
                            ui.Strings.Get("Fewer threads"),
                            false,
                            threads <= 1 || input.Busy,
                            () -> Act(input, ct -> input.Session.Mining.SetThreadsAsync(threads - 1, ct)),
                            AppTheme.ControlCompact,
                            radius: AppTheme.Radius8,
                            iconSize: AppTheme.Icon14,
                            iconColor: threads > 1 ? AppTheme.Ink: AppTheme.Dim,
                            shrink: 1
                        ),
                        Container{
                            MinWidth: 22,
                            AlignItems: AlignItems.Center,
                            Label(
                                ui,
                                if threads > 0 {
                                    threads.ToString()
                                } else {
                                    "–"
                                },
                                AppTheme.Type13,
                                AppTheme.Ink,
                                ""
                            )
                        },
                        WalletParts.Square(
                            ui,
                            "chevron_right",
                            ui.Strings.Get("More threads"),
                            false,
                            threads <= 0 || threads >= cores || input.Busy,
                            () -> Act(input, ct -> input.Session.Mining.SetThreadsAsync(threads + 1, ct)),
                            AppTheme.ControlCompact,
                            radius: AppTheme.Radius8,
                            iconSize: AppTheme.Icon14,
                            iconColor: threads > 0 && threads < cores ? AppTheme.Ink: AppTheme.Dim,
                            shrink: 1
                        )
                    }
                ),
                Row(
                    ui,
                    wide,
                    "memory",
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        Gap: AppTheme.Space10,
                        Grow(
                            Container{
                                BasedOn: AppTheme.TrackStyle,
                                Height: AppTheme.Space4,
                                Overflow: Overflow.Hidden,
                                BackgroundColor: AppTheme.Rule,
                                Container{
                                    Width: Percent(share * 100),
                                    Height: Percent(100),
                                    BackgroundColor: share > 0.75 ? AppTheme.Orange: AppTheme.Lime
                                }
                            }
                        ),
                        Label(
                            ui,
                            (threads * 2).ToString() + " / " + total.ToString() + " GiB",
                            AppTheme.Type13,
                            AppTheme.Dim,
                            ""
                        )
                    }
                ),
                Row(ui, wide, "miner", Label(ui, "blocknet-core", AppTheme.Type13, AppTheme.Ink, ""))
            },
            Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.FlexEnd,
                Command(
                    input,
                    "play_arrow",
                    "Start mining",
                    AppTheme.Lime,
                    AppTheme.Lime,
                    () -> Act(input, ct -> input.Session.Mining.StartAsync(ct))
                )
            }
        }
    }

    private func Row(ui Presentation, wide bool, label string, value Blob) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: AppTheme.Space14,
        MinHeight: 26,
        Container{
            Width: wide ? 110.0: 90.0,
            FlexShrink: 0,
            Label(ui, ui.Strings.Get(label), AppTheme.Type13, AppTheme.Dim, "")
        },
        Grow(value)
    }

    private func Command(
        input MiningPageInput,
        icon string,
        label string,
        color Color,
        border Color,
        action Action
    ) Blob {
        let ui = input.Ui
        let tint = input.Busy ? Color.Transparent: color
        let button = Goo
            .Button{
            BasedOn: AppTheme.ButtonStyle,
            FlexShrink: 0,
            FontSize: AppTheme.Type13,
            BorderColor: border,
            Disabled: input.Busy,
            Hover: Style{BackgroundColor: AppTheme.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get(label)},
            OnClick: action,
            MaterialIcons.Create(icon, AppTheme.Icon14, tint),
            Label(ui, ui.Strings.Get(label), AppTheme.Type13, tint, "")
        }
        WidgetKeyBindings.BindActivation(button)
        if input.Busy {
            button.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Right: 0,
                    Top: 0,
                    Bottom: 0,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Cell.Mount[SpinnerInput, Spinner](
                        "busy",
                        SpinnerInput{Size: 20, StrokeWidth: AppTheme.Stroke3, Color: color}
                    )
                }
            )
        }
        return button
    }

    private func Reading(ui Presentation, label string, value string, size float64) Blob -> Container{
        FlexGrow: 1,
        FlexBasis: 0,
        MinWidth: 0,
        Gap: AppTheme.Space4,
        Label(ui, ui.Strings.Get(label), AppTheme.Type12, AppTheme.Dim, ""),
        Label(ui, value, size, AppTheme.Ink, "")
    }

    private func Chart(input MiningPageInput) Blob {
        let ui = input.Ui
        let samples = input.History.Samples
        var peak = 0.0
        for sample in samples {
            peak = Math.Max(peak, sample.Rate)
        }
        let raw = Math.Max(peak, 0.1) * 1.3 / 4
        let magnitude = Math.Pow(10, Math.Floor(Math.Log10(raw)))
        let top = Math.Ceiling(raw / magnitude) * magnitude * 4
        let axis = Container{FlexGrow: 1, JustifyContent: JustifyContent.SpaceBetween, AlignItems: AlignItems.FlexEnd}
        for step in 0 ... 5 {
            axis.Add(Tick(ui, (top * (4 - step) / 4).ToString("0.##", CultureInfo.InvariantCulture)))
        }
        let area = Container{
            Handle: plot,
            FlexGrow: 1,
            Accessibility: Accessibility{Role: AccessibilityRole.Image, Name: ui.Strings.Get("hashrate chart")},
            OnPointerMove: (event PointerEvent) -> Track(samples, event.Position.X / plot.BorderBox.Width),
            OnPointerLeave: (event PointerEvent) -> Track(samples, -1)
        }
        for step in 0 ... 5 {
            area.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Right: 0,
                    Top: Percent(step * 25),
                    Margin: Edges{Top: step == 4 ? -1.0: AppTheme.Space0},
                    Height: 1,
                    BackgroundColor: AppTheme.Rule
                }
            )
        }
        let labels = Container{
            FlexDirection: FlexDirection.Row,
            JustifyContent: JustifyContent.SpaceBetween,
            Height: 14,
            FlexShrink: 0
        }
        if samples.Count > 1 {
            let first = samples[0].Time
            let span = Math.Max(1.0, (samples[samples.Count - 1].Time - first).TotalSeconds)
            let format = span >= 300 ? "HH:mm": "HH:mm:ss"
            let line = PathBuilder(0, 0, 1000, 1000)
            let fill = PathBuilder(0, 0, 1000, 1000)
            fill.MoveTo(0, 1000)
            for index in 0 ... samples.Count {
                let x = (samples[index].Time - first).TotalSeconds / span * 1000
                let y = 1000 - samples[index].Rate / top * 1000
                if index == 0 {
                    line.MoveTo(x, y)
                } else {
                    line.LineTo(x, y)
                }
                fill.LineTo(x, y)
            }
            fill.LineTo(1000, 1000).Close()
            area.Add(
                Shape{
                    Position: PositionType.Absolute,
                    Width: Percent(100),
                    Height: Percent(100),
                    Path: fill.Build(),
                    Fit: ShapeFit.Fill,
                    BackgroundGradient: LinearGradient(
                        AppTheme.ChartAccentGradientStart,
                        AppTheme.ChartAccentGradientEnd
                    )
                }
            )
            area.Add(
                Shape{
                    Position: PositionType.Absolute,
                    Width: Percent(100),
                    Height: Percent(100),
                    Path: line.Build(),
                    Fit: ShapeFit.Fill,
                    BackgroundColor: Color.Transparent,
                    BorderWidth: AppTheme.Border1_6,
                    BorderColor: AppTheme.Lime,
                    StrokeJoin: StrokeJoin.Round,
                    VectorEffect: VectorEffect.NonScalingStroke
                }
            )
            area.Add(Dot(1, 1 - samples[samples.Count - 1].Rate / top, AppTheme.Lime))
            if hover >= 0 && hover < samples.Count {
                let sample = samples[hover]
                let x = (sample.Time - first).TotalSeconds / span
                let y = 1 - sample.Rate / top
                area.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Left: Percent(x * 100),
                        Top: 0,
                        Bottom: 0,
                        Width: 1,
                        BackgroundColor: AppTheme.StrongRule
                    }
                )
                area.Add(Dot(x, y, AppTheme.Ink))
                let tip = Container{
                    BasedOn: AppTheme.PassiveTooltipStyle,
                    Position: PositionType.Absolute,
                    Top: Percent(y * 100),
                    Margin: Edges{Top: -AppTheme.Space44},
                    Label(
                        ui,
                        sample.Time.ToString(format, CultureInfo.InvariantCulture) + " · " + sample.Rate.ToString(
                            "F1",
                            CultureInfo.InvariantCulture
                        ) +
                            " H/s",
                        AppTheme.Type12,
                        AppTheme.Ink,
                        ""
                    )
                }
                if x > 0.75 {
                    tip.Right = Percent((1 - x) * 100)
                    tip.Margin = Edges{Top: -AppTheme.Space44, Right: AppTheme.Space12}
                } else {
                    tip.Left = Percent(x * 100)
                    tip.Margin = Edges{Top: -AppTheme.Space44, Left: AppTheme.Space12}
                }
                area.Add(tip)
            }
            for step in 0 ... 5 {
                labels.Add(Tick(ui, first.AddSeconds(span * step / 4).ToString(format, CultureInfo.InvariantCulture)))
            }
        }
        return Container{
            FlexDirection: FlexDirection.Row,
            FlexGrow: 1,
            MinHeight: 120,
            Gap: AppTheme.Space8,
            Container{Gap: AppTheme.Space4, axis, Container{Height: 14, FlexShrink: 0}},
            Container{
                FlexGrow: 1,
                MinWidth: 0,
                Gap: AppTheme.Space4,
                Container{FlexGrow: 1, Padding: Edges{Top: AppTheme.Space8, Bottom: AppTheme.Space8}, area},
                labels
            }
        }
    }

    private func Track(samples List[MiningSample], position float64) {
        var nearest = -1
        if position >= 0 && samples.Count > 1 {
            let first = samples[0].Time
            let span = Math.Max(1.0, (samples[samples.Count - 1].Time - first).TotalSeconds)
            var distance = 2.0
            for index in 0 ... samples.Count {
                let gap = Math.Abs((samples[index].Time - first).TotalSeconds / span - position)
                if gap < distance {
                    distance = gap
                    nearest = index
                }
            }
        }
        if nearest != hover {
            hover = nearest
            Rebuild()
        }
    }

    private func Dot(x float64, y float64, color Color) Blob -> Container{
        BasedOn: AppTheme.MarkerStyle,
        Position: PositionType.Absolute,
        Left: Percent(x * 100),
        Top: Percent(y * 100),
        Margin: Edges{Left: -4, Top: -4},
        BorderRadius: AppTheme.Radius4,
        BackgroundColor: color
    }

    private func Tick(ui Presentation, text string) Blob -> Text{
        Content: text,
        FontFamily: AppTheme.Font,
        FontSize: AppTheme.Type11,
        LineHeight: 14 / 11.0,
        Color: AppTheme.Dim,
        TextWrap: TextWrap.NoWrap
    }
}
