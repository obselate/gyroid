package Gyroid.Components

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
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
        ) Blob -> Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            Gap: AppTheme.Space8,
            FlexShrink: 0,
            Grow(
                Container{
                    Gap: AppTheme.Space6,
                    Label(ui, ui.Strings.Get(label), AppTheme.Type12, AppTheme.Body),
                    Text{
                        Content: shown,
                        FontFamily: AppTheme.Font,
                        FontSize: AppTheme.Type13,
                        Color: valueColor ?? AppTheme.Ink,
                        TextWrap: TextWrap.Wrap
                    }
                }
            ),
            Copy(ui, value, ui.Strings.Get("Copy") + " " + ui.Strings.Get(label), disabled: disabled)
        }

        func Copy(
            ui Presentation,
            value string,
            label string,
            disabled bool = false,
            text bool = false,
            size float64 = 38,
            iconSize float64? = nil,
            color Color? = nil,
            style Style? = nil,
            clearAfterMs float64 = 120000,
            content Container? = nil,
            key string = ""
        ) Blob -> Cell
            .Mount[CopyControlInput, CopyControl](
            "copy-" + (key.Length > 0 ? key: label),
            CopyControlInput{
                Ui: ui,
                Value: value,
                Label: label,
                Disabled: disabled,
                Text: text,
                Size: size,
                IconSize: iconSize ?? AppTheme.Icon16,
                Color: color ?? AppTheme.Body,
                Style: style,
                ClearAfterMs: clearAfterMs,
                Content: content,
                Language: ui.Strings.Language
            }
        )
    }
}

data struct CopyControlInput {
    var Ui Presentation
    var Value string
    var Label string
    var Disabled bool
    var Text bool
    var Size float64
    var IconSize float64
    var Color Color
    var Style Style?
    var ClearAfterMs float64
    var Content Container?
    var Language string
}

class CopyControl : Cell[CopyControlInput], IDisposable {
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

    protected override func Build(input CopyControlInput) Blob {
        if actions != input.Ui.Actions {
            if let source = actions {
                source.ClipboardChanged -= changed
            }
            actions = input.Ui.Actions
            input.Ui.Actions.ClipboardChanged += changed
        }
        let ui = input.Ui
        let copied = ReadOnlySpan[char](ui.Actions.ClipboardText).SequenceEqual(
            System.MemoryExtensions.AsSpan(input.Value)
        )
        let copy = () -> ui.Actions.Copy(input.Value, input.ClearAfterMs)
        if let content = input.Content {
            content.BorderColor = copied ? AppTheme.Mint: AppTheme.Edge
            content.Disabled = input.Disabled
            content.OnClick = copy
            content.Accessibility = Accessibility{Role: AccessibilityRole.Button, Name: input.Label}
            WidgetKeyBindings.BindActivation(content)
            return content
        }
        if input.Text {
            let color = copied ? AppTheme.Mint: AppTheme.Lime
            return ControlParts.Button(
                ui,
                copied ? "Copied": input.Label,
                copy,
                input.Disabled,
                busy: false,
                appearance: AppTheme.Button with{
                    BorderColor = color,
                    BackgroundColor = copied ? AppTheme.MintQuiet: AppTheme.LimeQuiet,
                    TextColor = color,
                    Leading = MaterialIcons.Create(
                        copied ? "check": "content_copy",
                        input.IconSize,
                        input.Disabled ? AppTheme.Dim: color
                    )
                }
            )
        }
        return ControlParts.Icon(
            ui,
            MaterialIcons.Create(
                copied ? "check": "content_copy",
                input.IconSize,
                input.Disabled ? AppTheme.Dim: copied ? AppTheme.Lime: input.Color
            ),
            input.Label,
            copy,
            disabled: input.Disabled,
            size: input.Size,
            style: input.Style
        )
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
            if input
                .Ui
                .Actions
                .playbackActive() &&
                System
                .Diagnostics
                .Stopwatch
                .GetElapsedTime(input.Revision)
                .TotalMilliseconds < 250 {
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
