package Gyroid.View

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Gyroid.Send
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

partial class WalletView {
    private let traceFades[]Anim[float64] = [6]Anim[float64]
    private let traceShifts[]Anim[Point] = [6]Anim[Point]
    private var traceSeal Anim[float64]?
    private var traceEstimate SendEstimate?
    private var traceResult SendResult?
    private var traceCompact bool
    private var traceTimer WindowTimer?

    private func TraceSend(estimate SendEstimate, result SendResult) {
        traceEstimate = estimate
        traceResult = result
        traceCompact = false
        traceTimer?.Dispose()
        traceTimer = window?.SetTimeout(
            () -> {
                traceCompact = true
                Rebuild()
            },
            6000
        )
        if traceSeal == nil {
            for index in 0 ... 6 {
                traceFades[index] = AnimateValue(1.0)
                traceShifts[index] = AnimateValue(Point{X: 0, Y: 0})
            }
            traceSeal = AnimateValue(1.0)
        }
        let animate = PlaybackActive()
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
            if animate {
                traceFades[index].Snap(0)
                traceFades[index].To(1, (start, end, velocity) -> SendCue(delay, start, end, 0))
                traceShifts[index].Snap(from)
                traceShifts[index].To(
                    still,
                    (start float64, end float64, velocity float64) -> SendCue(delay, start, end, wobble),
                    (start float64, end float64, velocity float64) -> SendCue(delay, start, end, 0)
                )
            } else {
                traceFades[index].Snap(1)
                traceShifts[index].Snap(still)
            }
        }
        if animate {
            traceSeal?.Snap(1.8)
            traceSeal?.To(1, (start, end, velocity) -> SendCue(1.4, start, end, 0))
        } else {
            traceSeal?.Snap(1)
        }
    }

    private func CloseTrace() {
        traceEstimate = nil
        traceResult = nil
        traceTimer?.Dispose()
        traceTimer = nil
        Rebuild()
    }

    private func SendTrace() Blob? {
        guard let result = traceResult, let estimate = traceEstimate else {
            return nil
        }
        var state = "mempool"
        var confirmations uint64 = 0
        for send in wallet.Snapshot.Sends {
            if send.TxId == result.TxId {
                state = send.Status
                confirmations = send.Confirmations
            }
        }
        if confirmations >= 10 {
            return nil
        }
        let status = ChainState(state, confirmations)
        let filled = int32(confirmations)
        let ticks = Text{
            Content: String('●', filled) + String('○', 10 - filled),
            StyleRanges: []TextStyleRange{TextStyleRange(TextRange(0, filled), Style{Color: lime})},
            FontFamily: font,
            FontSize: 13,
            Color: dim,
            TextWrap: TextWrap.NoWrap
        }
        let chain = Label(
            status,
            12,
            if state == "confirmed" {
                lime
            } else {
                orange
            },
            ""
        )
        let txid = Label(Hidden(result.TxId.Substring(0, 8)), 12, ink, "")
        let close = IconButton{
            Icon: MaterialIcons.Create("close", 16, body),
            AccessibilityName: strings.Get("Close"),
            OnClick: () -> CloseTrace()
        }.Build()
        let strip = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: if traceCompact {
                AlignItems.Center
            } else {
                AlignItems.FlexStart
            },
            Gap: 16,
            FlexShrink: 0,
            MinWidth: 0,
            Padding: Edges{Top: 8, Bottom: 8},
            BorderWidth: Edges{Top: 1, Bottom: 1},
            BorderColor: rule,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Status,
                Name: strings.Get("sent") + " " + Amount(estimate.Amount) + " BNT " + status
            }
        }
        if traceCompact {
            strip.Add(Label("◆", 14, lime, ""))
            strip.Add(txid)
            strip.Add(Label("-" + Amount(estimate.Amount), 12, pink, ""))
            strip.Add(chain)
            strip.Add(Grow(ticks))
            strip.Add(close)
            return strip
        }
        let inputCount = result.InputCount
        let inputs = Math.Min(inputCount, 6)
        let coins = Label(
            String('◉', inputs) + if inputCount > inputs {
                " +" + (inputCount - inputs).ToString()
            } else {
                ""
            },
            16,
            lime,
            ""
        )
        let ring = Container{Gap: 2, MinWidth: 0, Overflow: Overflow.Hidden}
        let neon = []Color{lime, orange, pink, blue, mint, violet}
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
                    FontFamily: font,
                    FontSize: 12,
                    Color: dim,
                    TextWrap: TextWrap.NoWrap
                }
            )
        }
        if inputCount > 3 {
            ring.Add(Label("+" + (inputCount - 3).ToString(), 11, dim, ""))
        }
        let outputs = Container{Gap: 2, Label("▶ " + Amount(estimate.Amount), 12, pink, "")}
        if result.Change > 0 {
            outputs.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: 6,
                    Label("▶ " + Amount(result.Change), 12, mint, ""),
                    Label(strings.Get("change"), 11, dim, "")
                }
            )
        }
        outputs.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: 6,
                OpacityAnim: traceFades[3],
                TranslateAnim: traceShifts[3],
                Label("↘ " + Amount(result.Fee), 12, orange, ""),
                Label(strings.Get("Fee"), 11, dim, "")
            }
        )
        let ringStage = TraceStage("ring ×16", 1, ring)
        ringStage.FlexShrink = 1
        ringStage.MinWidth = 0
        let stages = Container{
            FlexDirection: FlexDirection.Row,
            Gap: 12,
            TraceStage(
                "inputs",
                0,
                Container{Gap: 2, coins, Label(Amount(estimate.Amount + result.Fee + result.Change), 12, body, "")}
            ),
            ringStage,
            TraceStage("outputs", 2, outputs),
            TraceStage(
                "sealed",
                4,
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 6,
                    Container{ScaleAnim: traceSeal, Label("◆", 16, lime, "")},
                    txid
                }
            ),
            TraceStage("broadcast", 5, Container{Gap: 2, chain, ticks})
        }
        strip.Add(Grow(stages))
        strip.Add(close)
        return strip
    }

    private func TraceStage(label string, stage int32, content Blob) Container -> Container{
        Gap: 4,
        FlexShrink: 0,
        OpacityAnim: traceFades[stage],
        TranslateAnim: traceShifts[stage],
        Label(
            if stage > 0 {
                "→ " + strings.Get(label)
            } else {
                strings.Get(label)
            },
            11,
            dim,
            ""
        ),
        content
    }
}
