package Gyroid.Views

import Goo
import Goo.Widgets
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
    var Height float64
    var Visible bool
    var NodeRunning bool
    var Network string
}

data struct MiningCommandInput {
    var Ui Presentation
    var Language string
    var Running bool
    var Toggle Action
}

data struct MiningSetupInput {
    var Ui Presentation
    var Language string
    var Wallet string
    var Height float64
    var Threads int32
    var SetThreads Action[int32]
}

data struct MiningRateInput {
    var Ui Presentation
    var Language string
    var Height float64
    var Rate float64
}

data struct MiningReadingsInput {
    var Ui Presentation
    var Language string
    var Status MiningStatus
    var Height float64
}

data struct MiningChartInput {
    var Ui Presentation
    var Language string
    var Samples[]MiningSample
}

class MiningPage : Cell, IDisposable {
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private let toggle Action
    private let setThreads Action[int32]
    private var source MiningPageInput
    private var request CancellationTokenSource?
    private var timer WindowTimer?
    private var generation int32
    private var opened bool
    private var disposed bool
    private var unavailable bool
    private var loading bool
    private var refreshPending bool
    private var samples[]MiningSample = []MiningSample{}

    init() {
        toggle = () -> Toggle()
        setThreads = value -> SetThreads(value)
    }

    func Accept(input MiningPageInput) {
        let replaced = !opened ||
            source.Session != input.Session ||
            source.Window != input.Window ||
            source.Wallet != input.Wallet ||
            source.Network != input.Network ||
            source.Visible != input.Visible ||
            source.NodeRunning != input.NodeRunning
        let changed = !opened || source != input
        source = input
        if replaced {
            opened = true
            generation++
            request?.Cancel()
            request?.Dispose()
            timer?.Dispose()
            timer = nil
            loading = false
            refreshPending = false
            if input.Visible && input.NodeRunning {
                guard let window = input.Window else {
                    return
                }
                request = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, window.Closed)
                Refresh()
            }
        }
        if changed {
            Rebuild()
        }
    }

    override func Build() Blob {
        let input = source
        let ui = input.Ui
        let status = input.History.Status
        let card = WalletParts.PageCard(ui, height: input.Height, maxWidth: status.Running ? 1180.0: 620.0, fill: true)
        let head = WalletParts.Header(
            Label(ui, ui.Strings.Get("mining"), AppTheme.Type17, AppTheme.Ink, ""),
            AppTheme.Space10,
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
        )
        head.MinHeight = 34
        head.Add(
            Cell.Mount[MiningCommandInput, MiningCommand](
                "command",
                MiningCommandInput{Ui: ui, Language: input.Language, Running: status.Running, Toggle: toggle}
            )
        )
        card.Add(head)
        if unavailable || !input.NodeRunning {
            card.MaxWidth = 620
            card.Add(Label(ui, ui.Strings.Get("Node unavailable"), AppTheme.Type14, AppTheme.Body, ""))
        } else if !status.Running {
            card.Add(
                Cell.Mount[MiningSetupInput, MiningSetup](
                    "setup",
                    MiningSetupInput{
                        Ui: ui,
                        Language: input.Language,
                        Wallet: input.Wallet,
                        Height: input.Height,
                        Threads: status.Threads,
                        SetThreads: setThreads
                    }
                )
            )
        } else {
            card.FlexGrow = 1
            let rate = samples.Length > 0 ? samples[samples.Length - 1].Rate: status.Hashrate
            card.Add(
                Cell.Mount[MiningRateInput, MiningRate](
                    "rate",
                    MiningRateInput{Ui: ui, Language: input.Language, Height: input.Height, Rate: rate}
                )
            )
            card.Add(
                Cell.Mount[MiningChartInput, MiningChart](
                    "chart",
                    MiningChartInput{Ui: ui, Language: input.Language, Samples: samples}
                )
            )
            card.Add(
                Cell.Mount[MiningReadingsInput, MiningReadings](
                    "readings",
                    MiningReadingsInput{Ui: ui, Language: input.Language, Status: status, Height: input.Height}
                )
            )
        }
        return Container{
            FlexGrow: 1,
            MinHeight: 0,
            AlignItems: AlignItems.Center,
            JustifyContent: status.Running ? JustifyContent.FlexStart: JustifyContent.Center,
            card
        }
    }

    func Dispose() {
        disposed = true
        generation++
        timer?.Dispose()
        lifetime.Cancel()
        request?.Cancel()
        request?.Dispose()
        lifetime.Dispose()
    }

    private func Toggle() {
        if disposed || unavailable || !source.NodeRunning || source.Ui.Working() {
            return
        }
        let mining = source.Session.Mining
        if source.History.Status.Running {
            Act(ct -> mining.StopAsync(ct))
        } else {
            Act(ct -> mining.StartAsync(ct))
        }
    }

    private func SetThreads(value int32) {
        if disposed || source.Ui.Working() || value < 1 || value > Environment.ProcessorCount {
            return
        }
        let mining = source.Session.Mining
        Act(ct -> mining.SetThreadsAsync(value, ct))
    }

    private func Act(action Func[CancellationToken, Task]) {
        let id = generation
        source
            .Ui
            .Actions
            .Run(
            action,
            () -> {
                if !disposed && id == generation {
                    Refresh()
                }
            }
        )
    }

    private func Refresh() {
        if disposed || !source.Visible || !source.NodeRunning {
            return
        }
        if loading {
            refreshPending = true
            return
        }
        guard let current = request else {
            return
        }
        timer?.Dispose()
        timer = nil
        loading = true
        let input = source
        let id = generation
        let token = current.Token
        go Load(input, id, token)
    }

    private func Load(input MiningPageInput, id int32, token CancellationToken) {
        var status MiningStatus? = nil
        try {
            status = await input.Session.Mining.StatusAsync(token)
        } catch (failure OperationCanceledException) when token.IsCancellationRequested {
            return
        } catch (failure Exception) { }
        input.Window?.TryPost(
            () -> {
                if disposed || id != generation {
                    return
                }
                loading = false
                let previous = input.History.Status
                let recovered = unavailable
                unavailable = status == nil
                if let value = status {
                    Record(input.History, value)
                    if value.Running {
                        samples = input.History.Samples.ToArray()
                    }
                    if value != previous || recovered {
                        Rebuild()
                    }
                } else if !recovered {
                    input.History.Samples.Clear()
                    samples = []MiningSample{}
                    Rebuild()
                }
                if refreshPending {
                    refreshPending = false
                    Refresh()
                } else if input.History.Status.Running {
                    timer = input.Window?.SetTimeout(() -> Refresh(), 5000)
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
}

class MiningCommand : Cell[MiningCommandInput] {
    protected override func Build(input MiningCommandInput) Blob {
        let color = input.Running ? AppTheme.Ink: AppTheme.Lime
        return ControlParts.Button(
            input.Ui,
            input.Running ? "Stop": "Start mining",
            input.Toggle,
            appearance: AppTheme.Button with{
                FontSize = AppTheme.Type13,
                BorderColor = input.Running ? AppTheme.Edge: AppTheme.Lime,
                TextColor = color,
                HoverBackgroundColor = AppTheme.Rule,
                Leading = MaterialIcons.Create(input.Running ? "stop": "play_arrow", AppTheme.Icon14, color)
            }
        )
    }
}

class MiningSetup : Cell[MiningSetupInput] {
    private let fewer ElementHandle = ElementHandle()
    private let more ElementHandle = ElementHandle()

    protected override func Build(input MiningSetupInput) Blob {
        let ui = input.Ui
        let threads = input.Threads
        let cores = Environment.ProcessorCount
        let total = Math.Max(1.0, Math.Round(float64(GC.GetGCMemoryInfo().TotalAvailableMemoryBytes) / 1073741824))
        let share = Math.Min(1.0, float64(threads) * 2 / total)
        let wide = input.Height >= 700
        let fewerButton = ControlParts.Icon(
            ui,
            MaterialIcons.Create("chevron_left", AppTheme.Icon14, threads > 1 ? AppTheme.Ink: AppTheme.Dim),
            ui.Strings.Get("Fewer threads"),
            () -> {
                if threads == 2 {
                    more.Focus()
                }
                input.SetThreads(threads - 1)
            },
            threads <= 1,
            size: AppTheme.ControlCompact
        )
        fewerButton.Handle = fewer
        let moreButton = ControlParts.Icon(
            ui,
            MaterialIcons.Create(
                "chevron_right",
                AppTheme.Icon14,
                threads > 0 && threads < cores ? AppTheme.Ink: AppTheme.Dim
            ),
            ui.Strings.Get("More threads"),
            () -> {
                if threads == cores - 1 {
                    fewer.Focus()
                }
                input.SetThreads(threads + 1)
            },
            threads <= 0 || threads >= cores,
            size: AppTheme.ControlCompact
        )
        moreButton.Handle = more
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
                        fewerButton,
                        Container{
                            MinWidth: 22,
                            AlignItems: AlignItems.Center,
                            Accessibility: Accessibility{Name: ui.Strings.Get("threads") + " " + threads.ToString()},
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
                        moreButton
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
            },
        }
    }

    private func Row(ui Presentation, wide bool, label string, value Blob) Blob ->
    TextParts.KeyValue(ui, ui.Strings.Get(label), value, labelWidth: wide ? 110.0: 90.0)
}

class MiningRate : Cell[MiningRateInput] {
    protected override func Build(input MiningRateInput) Blob {
        let ui = input.Ui
        let text = input.Rate.ToString("F1", CultureInfo.InvariantCulture)
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexEnd,
            Gap: AppTheme.Space8,
            FlexShrink: 0,
            TextParts.Value(
                ui,
                "rate",
                ui.Strings.Get("hashrate") + " " + text + " H/s",
                text,
                AppTheme.GetMajorFigureSize(input.Height),
                AppTheme.Ink
            ),
            Container{Padding: Edges{Bottom: AppTheme.Space4}, Label(ui, "H/s", AppTheme.Type16, AppTheme.Body, "")}
        }
    }
}

class MiningReadings : Cell[MiningReadingsInput] {
    protected override func Build(input MiningReadingsInput) Blob {
        let ui = input.Ui
        let status = input.Status
        let compact = input.Height < 700
        let stats = Container{
            FlexDirection: FlexDirection.Row,
            Gap: compact ? AppTheme.Space8: AppTheme.Space12,
            Padding: Edges{Top: AppTheme.Space12},
            BorderWidth: Edges{Top: AppTheme.Border1},
            BorderColor: AppTheme.Rule,
            FlexShrink: 0
        }
        let size = compact ? AppTheme.Type14: AppTheme.Type16
        stats.Add(TextParts.Figure(ui, "threads", status.Threads.ToString(), "", size, AppTheme.Ink))
        stats.Add(TextParts.Figure(ui, "hashes", Count(status.Hashes), "", size, AppTheme.Ink))
        stats.Add(TextParts.Figure(ui, "blocks found", Count(status.Blocks), "", size, AppTheme.Ink))
        stats.Add(
            TextParts.Figure(
                ui,
                "since",
                status.Started.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture),
                "",
                size,
                AppTheme.Ink
            )
        )
        return stats
    }
}

class MiningChart : Cell[MiningChartInput] {
    private let plot ElementHandle = ElementHandle()
    private var hover int32 = -1

    protected override func Build(input MiningChartInput) Blob {
        let ui = input.Ui
        let samples = input.Samples
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
        if samples.Length > 1 {
            let first = samples[0].Time
            let span = Math.Max(1.0, (samples[samples.Length - 1].Time - first).TotalSeconds)
            let format = span >= 300 ? "HH:mm": "HH:mm:ss"
            let line = PathBuilder(0, 0, 1000, 1000)
            let fill = PathBuilder(0, 0, 1000, 1000)
            fill.MoveTo(0, 1000)
            for index in 0 ... samples.Length {
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
                    BackgroundGradient: LinearGradient(AppTheme.LimeSoft, AppTheme.Surface)
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
                    BorderWidth: 1.6,
                    BorderColor: AppTheme.Lime,
                    StrokeJoin: StrokeJoin.Round,
                    VectorEffect: VectorEffect.NonScalingStroke
                }
            )
            area.Add(
                ChartParts.Point(
                    Percent(100),
                    Percent((1 - samples[samples.Length - 1].Rate / top) * 100),
                    AppTheme.Lime
                )
            )
            if hover >= 0 && hover < samples.Length {
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
                area.Add(ChartParts.Point(Percent(x * 100), Percent(y * 100), AppTheme.Ink))
                area.Add(
                    ChartParts.Tooltip(
                        Percent(x * 100),
                        Percent(y * 100),
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
                        ),
                        right: x > 0.75 ? Percent((1 - x) * 100): nil,
                        margin: x > 0.75
                        ? Edges{Top: -44, Right: AppTheme.Space12}
                        : Edges{Top: -44, Left: AppTheme.Space12}
                    )
                )
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

    private func Track(samples[]MiningSample, position float64) {
        var nearest = -1
        if position >= 0 && samples.Length > 1 {
            let first = samples[0].Time
            let span = Math.Max(1.0, (samples[samples.Length - 1].Time - first).TotalSeconds)
            var distance = 2.0
            for index in 0 ... samples.Length {
                let gap = Math.Abs((samples[index].Time - first).TotalSeconds / span - position)
                if gap < distance {
                    distance = gap
                    nearest = index
                }
            }
        }
        if nearest != hover {
            hover = nearest
        }
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
