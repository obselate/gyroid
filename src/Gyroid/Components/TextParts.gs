package Gyroid.Components

import Goo
import Goo.Widgets.Actions
import Goo.Widgets.Icons
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
            color Color? = nil
        ) Blob -> Container{
            FlexDirection: FlexDirection.Row,
            Gap: gap,
            Label(ui, label, AppTheme.Type12, color ?? AppTheme.Body, ""),
            Label(ui, value, AppTheme.Type12, AppTheme.Ink, "")
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
        ) Text {
            let t = if channel.Length == 0 {
                1.0
            } else {
                Math.Min(ui.Actions.Progress("page"), ui.Actions.Progress(channel))
            }
            if size >= 13 && t < 1 {
                return TextParts.Frame(
                    ui,
                    content,
                    t,
                    ui.Actions.DecodeSeed ^ content.GetHashCode(),
                    Random.Shared,
                    size,
                    color ?? AppTheme.Ink
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

        func Badge(ui Presentation, content string, color Color, icon string = "") Container {
            let badge = Container{BasedOn: AppTheme.BadgeStyle, BorderColor: color, FlexShrink: 0}
            if icon.Length > 0 {
                badge.Add(MaterialIcons.Create(icon, AppTheme.Icon12, color))
            }
            badge.Add(TextParts.Label(ui, content, AppTheme.Type12, color, ""))
            return badge
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

        func Copyable(ui Presentation, label string, value string, shown string, clearAfterMs float64 = 120000) Blob {
            let copied = ReadOnlySpan[char](ui.Actions.ClipboardText).SequenceEqual(
                System.MemoryExtensions.AsSpan(value)
            )
            return Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexStart,
                Gap: AppTheme.Space8,
                FlexShrink: 0,
                Grow(
                    Container{
                        Gap: AppTheme.Space6,
                        TextParts.Label(ui, ui.Strings.Get(label), AppTheme.Type12, AppTheme.Body),
                        Text{
                            Content: shown,
                            FontFamily: AppTheme.Font,
                            FontSize: AppTheme.Type13,
                            Color: AppTheme.Ink,
                            TextWrap: TextWrap.Wrap
                        }
                    }
                ),
                (
                    AppTheme.IconButton with{
                        Icon = MaterialIcons.Create(
                            copied ? "check": "content_copy",
                            AppTheme.Icon16,
                            copied ? AppTheme.Lime: AppTheme.Body
                        ),
                        AccessibilityName = ui.Strings.Get("Copy") + " " + ui.Strings.Get(label),
                        OnClick = () -> {
                            ui.Actions.Copy(value, clearAfterMs)
                            ui.Actions.rebuild()
                        }
                    }
                ).Build()
            }
        }
    }
}
