package Gyroid.Interface

import Goo
import System
import System.Collections.Generic

data struct DecodeValueInput {
    var Value string
    var Name string
    var Size float64
    var Color Color
    var FractionColor Color
    var Live AccessibilityLive
    var Ui Presentation
}

class DecodeValue : Cell[DecodeValueInput] {
    private var from string = ""
    private var target string = ""
    private let progress Anim[float64]
    private var ui Presentation?

    init() {
        progress = Animate(1.0)
        progress.Completed += reason -> ui?.SettleMotion()
    }

    protected override func Build(input DecodeValueInput) Blob {
        ui = input.Ui
        if input.Value != target {
            from = target
            target = input.Value
            if from.Length > 0 && !from.Contains('•') && !target.Contains('•') {
                Motion.TimeScale = 1.0
                progress.Snap(0)
                progress.To(1, Motion.Tween(250))
            }
        }
        let chars = target.ToCharArray()
        let shift = target.Length - from.Length
        let changed = List[int32]()
        for index in 0 ... chars.Length {
            if Char.IsDigit(chars[index]) && (index < shift || from[index - shift] != chars[index]) {
                changed.Add(index)
            }
        }
        for rank in int32(changed.Count * progress.Value) ... changed.Count {
            let index = changed[rank]
            let old = index < shift ? ' ': from[index - shift]
            while chars[index] == target[index] || chars[index] == old {
                chars[index] = "0123456789" [Random.Shared.Next(10)]
            }
        }
        let point = target.IndexOf('.')
        return Text{
            Content: String(chars),
            StyleRanges: if point < 0 {
                []TextStyleRange{}
            } else {
                []TextStyleRange{
                    TextStyleRange(TextRange(point, target.Length - point), Style{Color: input.FractionColor})
                }
            },
            FontSize: input.Size,
            LineHeight: 1,
            Color: input.Color,
            TextWrap: TextWrap.NoWrap,
            FlexShrink: 0,
            Accessibility: Accessibility{Role: AccessibilityRole.Text, Name: input.Name, Live: input.Live}
        }
    }
}
