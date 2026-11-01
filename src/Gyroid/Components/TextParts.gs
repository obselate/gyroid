package Gyroid.Components

import Goo
import Goo.Widgets.Icons
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Services.WalletText
import Gyroid.Views
import System
import System.Collections.Generic

class TextParts {
    shared {
        func KeyValue(
            ui Presentation,
            label string,
            value string,
            gap float64 = 8,
            color Color? = nil,
            valueColor Color? = nil,
            size float64 = 12,
            labelWidth float64? = nil
        ) Blob {
            let name = Label(ui, label, size, color ?? AppTheme.Body, "")
            if let width = labelWidth {
                name.Width = width
                name.FlexShrink = 0
            }
            return Container{
                FlexDirection: FlexDirection.Row,
                Gap: gap,
                AlignItems: AlignItems.Baseline,
                MinWidth: 0,
                name,
                Label(ui, value, size, valueColor ?? AppTheme.Ink, "")
            }
        }

        func KeyValue(ui Presentation, label string, value Blob, labelWidth float64? = nil) Blob {
            let name = Label(ui, label, AppTheme.Type12, AppTheme.Body, "")
            if let width = labelWidth {
                name.Width = width
                name.FlexShrink = 0
            }
            return Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                MinWidth: 0,
                name,
                Grow(value)
            }
        }

        func ChainState(ui Presentation, state string, confirmations uint64) string -> if state == "confirmed" {
            ui.Strings.Get("Confirmed") + " " + Count(confirmations)
        } else if state == "mempool" {
            ui.Strings.Get("Pending")
        } else if state == "not_found" {
            ui.Strings.Get("Not found")
        } else {
            state
        }

        func Frame(
            ui Presentation,
            content string,
            t float64,
            seed int32,
            digits Random,
            size float64,
            color Color
        ) Text {
            let thresholds = Random(seed)
            let reveal = (t - 0.45) / 0.55
            let neon = []Color{
                AppTheme.Lime,
                AppTheme.Orange,
                AppTheme.Pink,
                AppTheme.Blue,
                AppTheme.Mint,
                AppTheme.Violet
            }
            let chars = content.ToCharArray()
            let tints = List[TextStyleRange]()
            var index = 0
            while index < chars.Length {
                let lockAt = thresholds.NextDouble()
                if chars[index] >= '!' && chars[index] <= '~' && (t < 0.45 || reveal < lockAt) {
                    chars[index] = "0123456789abcdef" [digits.Next(16)]
                    if digits.Next(10) == 0 {
                        tints.Add(TextStyleRange(TextRange(index, 1), Style{Color: neon[digits.Next(neon.Length)]}))
                    }
                }
                index++
            }
            return Text{
                Content: String(chars),
                StyleRanges: tints.ToArray(),
                FontFamily: AppTheme.Font,
                FontSize: size,
                Color: color,
                TextWrap: TextWrap.NoWrap,
                MinWidth: 0
            }
        }

        func Label(
            ui Presentation,
            content string,
            size float64 = 14,
            color Color? = nil,
            channel string = "page"
        ) Blob {
            if channel.Length > 0 && size >= 13 {
                return Cell.Mount[DecodeLabelInput, DecodeLabel](
                    nil,
                    DecodeLabelInput{
                        Ui: ui,
                        Content: content,
                        Size: size,
                        Color: color ?? AppTheme.Ink,
                        Revision: Math.Max(
                            ui.Actions.Decoding.GetValueOrDefault("page"),
                            ui.Actions.Decoding.GetValueOrDefault(channel)
                        )
                    }
                )
            }
            return Text{
                Content: content,
                FontFamily: AppTheme.Font,
                FontSize: size,
                Color: color ?? AppTheme.Ink,
                TextWrap: TextWrap.NoWrap,
                TextTrimming: TextTrimming.Ellipsis,
                MinWidth: 0
            }
        }

        func Figure(
            ui Presentation,
            label string,
            value string,
            color Color,
            size float64 = 14,
            channel string = "page",
            compact bool = false
        ) Blob -> Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: compact ? AppTheme.Space8: AppTheme.Space10,
            MinWidth: 0,
            FlexShrink: compact ? 0: 1,
            Accessibility: Accessibility{Name: ui.Strings.Get(label) + " " + value},
            TextParts.Label(
                ui,
                ui.Strings.Get(label),
                AppTheme.Type12,
                compact ? AppTheme.Dim: AppTheme.Body,
                compact ? "": "page"
            ),
            TextParts.Label(ui, value, size, color, channel)
        }

        func Value(
            ui Presentation,
            key string,
            name string,
            value string,
            size float64,
            color Color,
            fractionColor Color? = nil,
            live AccessibilityLive = AccessibilityLive.Off
        ) Blob -> Cell
            .Mount[DecodeValueInput, DecodeValue](
            key,
            DecodeValueInput{
                Value: value,
                Name: name,
                Size: size,
                Color: color,
                FractionColor: fractionColor ?? color,
                Live: live,
                Ui: ui
            }
        )

        func Figure(
            ui Presentation,
            label string,
            value string,
            unit string,
            size float64,
            color Color,
            weight float64 = 1,
            key string = ""
        ) Blob -> Container{
            FlexGrow: weight,
            FlexBasis: 0,
            MinWidth: 0,
            Gap: AppTheme.Space6,
            Accessibility: Accessibility{Name: ui.Strings.Get(label) + " " + value + " " + unit},
            Label(ui, ui.Strings.Get(label), AppTheme.Type12, AppTheme.Dim, ""),
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Baseline,
                Gap: AppTheme.Space6,
                Overflow: Overflow.Hidden,
                Value(ui, key.Length > 0 ? key: label, ui.Strings.Get(label) + " " + value, value, size, color),
                Label(ui, unit, AppTheme.Type11, color, "")
            }
        }

        func Legend(ui Presentation, label string, color Color, trailing Blob? = nil) Container {
            let row = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                MinWidth: 0,
                Container{BasedOn: AppTheme.MarkerStyle, BackgroundColor: color, FlexShrink: 0},
                Label(ui, label, AppTheme.Type12, AppTheme.Body, "")
            }
            if let value = trailing {
                row.Add(value)
            }
            return row
        }

        func Status(ui Presentation, content string, color Color, icon string = "") Container {
            let status = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space6,
                FlexShrink: 0
            }
            if icon.Length > 0 {
                status.Add(MaterialIcons.Create(icon, AppTheme.Icon14, color))
            }
            status.Add(TextParts.Label(ui, content, AppTheme.Type13, color, ""))
            return status
        }

        func Copyable(
            ui Presentation,
            label string,
            value string,
            shown string,
            valueColor Color? = nil,
            disabled bool = false
        ) Blob -> Cell
            .Mount[CopyableTextInput, CopyableText](
            "copy-" + label,
            CopyableTextInput{
                Ui: ui,
                Label: label,
                Value: value,
                Shown: shown,
                Color: valueColor ?? AppTheme.Ink,
                Disabled: disabled,
                Language: ui.Strings.Language
            }
        )
    }
}

data struct CopyableTextInput {
    var Ui Presentation
    var Label string
    var Value string
    var Shown string
    var Color Color
    var Disabled bool
    var Language string
}

class CopyableText : Cell[CopyableTextInput], IDisposable {
    private var actions UiService?
    private let changed Action

    init() {
        changed = () -> Rebuild()
    }

    public func Dispose() {
        if let source = actions {
            source.ClipboardChanged -= changed
        }
        actions = nil
    }

    protected override func Build(input CopyableTextInput) Blob {
        if actions != input.Ui.Actions {
            Dispose()
            actions = input.Ui.Actions
            input.Ui.Actions.ClipboardChanged += changed
        }
        let ui = input.Ui
        let label = input.Label
        let value = input.Value
        let disabled = input.Disabled
        let copied = ReadOnlySpan[char](ui.Actions.ClipboardText).SequenceEqual(System.MemoryExtensions.AsSpan(value))
        let content = Container{
            Gap: AppTheme.Space6,
            TextParts.Label(ui, ui.Strings.Get(label), AppTheme.Type12, AppTheme.Body)
        }
        content.Add(
            Text{
                Content: input.Shown,
                FontFamily: AppTheme.Font,
                FontSize: AppTheme.Type13,
                Color: input.Color,
                TextWrap: TextWrap.Wrap
            }
        )
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            Gap: AppTheme.Space8,
            FlexShrink: 0,
            Grow(content),
            ControlParts.Icon(
                ui,
                MaterialIcons.Create(
                    copied ? "check": "content_copy",
                    AppTheme.Icon16,
                    disabled ? AppTheme.Dim: copied ? AppTheme.Lime: AppTheme.Body
                ),
                ui.Strings.Get("Copy") + " " + ui.Strings.Get(label),
                () -> {
                    ui.Actions.Copy(value, 120000)
                },
                disabled: disabled
            )
        }
    }
}

data struct DecodeLabelInput {
    var Ui Presentation
    var Content string
    var Size float64
    var Color Color
    var Revision int64
}

class DecodeLabel : Cell[DecodeLabelInput] {
    private let progress Anim[float64]
    private var revision int64

    init() {
        progress = Animate(1.0)
    }

    protected override func Build(input DecodeLabelInput) Blob {
        if revision != input.Revision {
            revision = input.Revision
            if input.Revision > 0 && input.Ui.Actions.playbackActive() {
                progress.Snap(0)
                progress.To(1, Motion.Tween(250))
            } else {
                progress.Snap(1)
            }
        }
        if progress.Value < 1 && input.Ui.Actions.playbackActive() {
            return TextParts.Frame(
                input.Ui,
                input.Content,
                progress.Value,
                int32(revision) ^ input.Content.GetHashCode(),
                Random.Shared,
                input.Size,
                input.Color
            )
        }
        return Text{
            Content: input.Content,
            FontFamily: AppTheme.Font,
            FontSize: input.Size,
            Color: input.Color,
            TextWrap: TextWrap.NoWrap,
            TextTrimming: TextTrimming.Ellipsis,
            MinWidth: 0
        }
    }
}
