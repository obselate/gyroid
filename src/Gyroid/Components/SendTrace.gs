package Gyroid.Components

import Goo
import Goo.Widgets.Icons
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services.WalletText
import Gyroid.Views
import System
import System.Collections.Generic
import System.Text

class SendCue(Delay float64, From float64, Target float64, Wobble float64) : Simulation {
    override func Position(elapsed float64) float64 {
        let t = Math.Clamp((elapsed - Delay) / 0.25, 0.0, 1.0)
        return Target + (From - Target) * Math.Pow(1 - t, 3) + Wobble * Math.Sin(t * Math.PI * 3) * (1 - t)
    }

    override func Velocity(elapsed float64) float64 -> 0

    override func Done(elapsed float64) bool -> elapsed >= Delay + 0.25
}

data struct SendTraceInput {
    var Ui Presentation
    var Estimate SendEstimate
    var Result SendResult
    var Sends[]WalletSend
    var Animate bool
    var Privacy bool
    var Language string
    var OnClose Action
}

class SendTrace : Cell[SendTraceInput], IDisposable {
    private let fades[]Anim[float64] = [6]Anim[float64]

    private let shifts[]Anim[Point] = [6]Anim[Point]

    private let seal Anim[float64]

    private var traced SendResult?

    private var compact bool

    private var timer WindowTimer?

    init() {
        for index in 0 ... 6 {
            fades[index] = AnimateValue(1.0)
            shifts[index] = AnimateValue(Point{X: 0, Y: 0})
        }
        seal = AnimateValue(1.0)
    }

    func Dispose() {
        timer?.Dispose()
        timer = nil
    }

    private func Start(input SendTraceInput) {
        traced = input.Result
        compact = false
        timer?.Dispose()
        timer = input
            .Ui
            .Actions
            .Delay(
            6000,
            () -> {
                compact = true
                Rebuild()
            }
        )
        let still = Point{X: 0, Y: 0}
        for index in 0 ... 6 {
            let delay = index * 0.35
            let from = if index == 3 {
                Point{X: -12, Y: -16}
            } else {
                Point{X: -14, Y: 0}
            }
            let wobble = if index == 1 {
                6.0
            } else {
                0.0
            }
            if input.Animate {
                fades[index].Snap(0)
                fades[index].To(1, (start, end, velocity) -> SendCue(delay, start, end, 0))
                shifts[index].Snap(from)
                shifts[index].To(
                    still,
                    (start float64, end float64, velocity float64) -> SendCue(delay, start, end, wobble),
                    (start float64, end float64, velocity float64) -> SendCue(delay, start, end, 0)
                )
            } else {
                fades[index].Snap(1)
                shifts[index].Snap(still)
            }
        }
        if input.Animate {
            seal.Snap(1.8)
            seal.To(1, (start, end, velocity) -> SendCue(1.4, start, end, 0))
        } else {
            seal.Snap(1)
        }
    }

    protected override func Build(input SendTraceInput) Blob {
        if !Object.ReferenceEquals(traced, input.Result) {
            Start(input)
        }
        let ui = input.Ui
        let result = input.Result
        let estimate = input.Estimate
        var state = "mempool"
        var confirmations uint64 = 0
        for send in input.Sends {
            if send.TxId == result.TxId {
                state = send.Status
                confirmations = send.Confirmations
            }
        }
        if confirmations >= 10 {
            return Container{}
        }
        let status = ChainState(ui, state, confirmations)
        let filled = int32(confirmations)
        let ticks = Text{
            Content: String('●', filled) + String('○', 10 - filled),
            StyleRanges: []TextStyleRange{TextStyleRange(TextRange(0, filled), Style{Color: AppTheme.Lime})},
            FontFamily: AppTheme.Font,
            FontSize: AppTheme.Type13,
            Color: AppTheme.Dim,
            TextWrap: TextWrap.NoWrap
        }
        let chain = Label(
            ui,
            status,
            AppTheme.Type12,
            if state == "confirmed" {
                AppTheme.Lime
            } else {
                AppTheme.Orange
            },
            ""
        )
        let txid = Label(ui, Hidden(ui.Privacy, result.TxId.Substring(0, 8)), AppTheme.Type12, AppTheme.Ink, "")
        let close = Icon(
            ui,
            MaterialIcons.Create("close", AppTheme.Icon16, AppTheme.Body),
            ui.Strings.Get("Close"),
            input.OnClose
        )
        let strip = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: if compact {
                AlignItems.Center
            } else {
                AlignItems.FlexStart
            },
            Gap: AppTheme.Space16,
            FlexShrink: 0,
            MinWidth: 0,
            Padding: Edges{Top: AppTheme.Space8, Bottom: AppTheme.Space8},
            BorderWidth: Edges{Top: AppTheme.Border1, Bottom: AppTheme.Border1},
            BorderColor: AppTheme.Rule,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Status,
                Name: ui.Strings.Get("sent") + " " + Amount(ui.Privacy, estimate.Amount) + " BNT " + status
            }
        }
        if compact {
            strip.Add(Label(ui, "◆", AppTheme.Type14, AppTheme.Lime, ""))
            strip.Add(txid)
            strip.Add(Label(ui, "-" + Amount(ui.Privacy, estimate.Amount), AppTheme.Type12, AppTheme.Pink, ""))
            strip.Add(chain)
            strip.Add(Grow(ticks))
            strip.Add(close)
            return strip
        }
        let inputCount = result.InputCount
        let inputs = Math.Min(inputCount, 6)
        let coins = Label(
            ui,
            String('◉', inputs) + if inputCount > inputs {
                " +" + (inputCount - inputs).ToString()
            } else {
                ""
            },
            AppTheme.Type16,
            AppTheme.Lime,
            ""
        )
        let ring = Container{Gap: AppTheme.Space2, MinWidth: 0, Overflow: Overflow.Hidden}
        let neon = []Color{AppTheme.Lime, AppTheme.Orange, AppTheme.Pink, AppTheme.Blue, AppTheme.Mint, AppTheme.Violet}
        for row in 0 ... Math.Min(inputCount, 3) {
            let digits = Random(result.TxId.GetHashCode() + row)
            let glyphs = StringBuilder()
            let tints = List[TextStyleRange]()
            for index in 0 ... 16 {
                glyphs.Append("0123456789abcdef" [digits.Next(16)])
                if digits.Next(3) == 0 {
                    tints.Add(TextStyleRange(TextRange(index, 1), Style{Color: neon[digits.Next(neon.Length)]}))
                }
            }
            ring.Add(
                Text{
                    Content: glyphs.ToString(),
                    StyleRanges: tints.ToArray(),
                    FontFamily: AppTheme.Font,
                    FontSize: AppTheme.Type12,
                    Color: AppTheme.Dim,
                    TextWrap: TextWrap.NoWrap
                }
            )
        }
        if inputCount > 3 {
            ring.Add(Label(ui, "+" + (inputCount - 3).ToString(), AppTheme.Type11, AppTheme.Dim, ""))
        }
        let outputs = Container{
            Gap: AppTheme.Space2,
            Label(ui, "▶ " + Amount(ui.Privacy, estimate.Amount), AppTheme.Type12, AppTheme.Pink, "")
        }
        if result.Change > 0 {
            outputs.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: AppTheme.Space6,
                    Label(ui, "▶ " + Amount(ui.Privacy, result.Change), AppTheme.Type12, AppTheme.Mint, ""),
                    Label(ui, ui.Strings.Get("change"), AppTheme.Type11, AppTheme.Dim, "")
                }
            )
        }
        outputs.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: AppTheme.Space6,
                OpacityAnim: fades[3],
                TranslateAnim: shifts[3],
                Label(ui, "↘ " + Amount(ui.Privacy, result.Fee), AppTheme.Type12, AppTheme.Orange, ""),
                Label(ui, ui.Strings.Get("Fee"), AppTheme.Type11, AppTheme.Dim, "")
            }
        )
        let ringStage = Stage(ui, "ring ×16", 1, ring)
        ringStage.FlexShrink = 1
        ringStage.MinWidth = 0
        let stages = Container{
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space12,
            Stage(
                ui,
                "inputs",
                0,
                Container{
                    Gap: AppTheme.Space2,
                    coins,
                    Label(
                        ui,
                        Amount(ui.Privacy, estimate.Amount + result.Fee + result.Change),
                        AppTheme.Type12,
                        AppTheme.Body,
                        ""
                    )
                }
            ),
            ringStage,
            Stage(ui, "outputs", 2, outputs),
            Stage(
                ui,
                "sealed",
                4,
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space6,
                    Container{ScaleAnim: seal, Label(ui, "◆", AppTheme.Type16, AppTheme.Lime, "")},
                    txid
                }
            ),
            Stage(ui, "broadcast", 5, Container{Gap: AppTheme.Space2, chain, ticks})
        }
        strip.Add(Grow(stages))
        strip.Add(close)
        return strip
    }

    private func Stage(ui Presentation, label string, stage int32, content Blob) Container -> Container{
        Gap: AppTheme.Space4,
        FlexShrink: 0,
        OpacityAnim: fades[stage],
        TranslateAnim: shifts[stage],
        Label(
            ui,
            if stage > 0 {
                "→ " + ui.Strings.Get(label)
            } else {
                ui.Strings.Get(label)
            },
            AppTheme.Type11,
            AppTheme.Dim,
            ""
        ),
        content
    }
}
