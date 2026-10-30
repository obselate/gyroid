package Gyroid.Interface

import Goo
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Gyroid.Interface.LayoutParts
import Gyroid.Wallet
import Gyroid.Wallet.WalletText
import System
import System.Collections.Generic

class TextParts {
    shared {
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
            let neon = []Color{ui.Lime, ui.Orange, ui.Pink, ui.Blue, ui.Mint, ui.Violet}
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
                FontFamily: ui.Font,
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
                    color ?? ui.Ink
                )
            }
            return Text{
                Content: content,
                FontFamily: ui.Font,
                FontSize: size,
                Color: color ?? ui.Ink,
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
            channel string = "page"
        ) Blob -> Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: 10,
            MinWidth: 0,
            Accessibility: Accessibility{Name: ui.Strings.Get(label) + " " + value},
            TextParts.Label(ui, ui.Strings.Get(label), 12, ui.Body),
            TextParts.Label(ui, value, size, color, channel)
        }

        func Badge(ui Presentation, content string, color Color, icon string = "") Container {
            let badge = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 5,
                Height: 20,
                Padding: Edges{Left: 6, Right: 6},
                BorderWidth: 1,
                BorderColor: color,
                BorderRadius: 3,
                FlexShrink: 0
            }
            if icon.Length > 0 {
                badge.Add(MaterialIcons.Create(icon, 12, color))
            }
            badge.Add(TextParts.Label(ui, content, 11.5, color, ""))
            return badge
        }

        func Status(ui Presentation, content string, color Color, icon string = "") Container {
            let status = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 6,
                FlexShrink: 0
            }
            if icon.Length > 0 {
                status.Add(MaterialIcons.Create(icon, 14, color))
            }
            status.Add(TextParts.Label(ui, content, 12.5, color, ""))
            return status
        }

        func Copyable(ui Presentation, label string, value string, shown string, clearAfterMs float64 = 120000) Blob {
            let copied = ReadOnlySpan[char](ui.Actions.ClipboardText).SequenceEqual(
                System.MemoryExtensions.AsSpan(value)
            )
            return Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexStart,
                Gap: 8,
                FlexShrink: 0,
                Grow(
                    Container{
                        Gap: 6,
                        TextParts.Label(ui, ui.Strings.Get(label), 12, ui.Body),
                        Text{Content: shown, FontFamily: ui.Font, FontSize: 13, Color: ui.Ink, TextWrap: TextWrap.Wrap}
                    }
                ),
                IconButton{
                    Icon: MaterialIcons.Create(copied ? "check": "content_copy", 16, copied ? ui.Lime: ui.Body),
                    AccessibilityName: ui.Strings.Get("Copy") + " " + ui.Strings.Get(label),
                    OnClick: () -> {
                        ui.Actions.Copy(value, clearAfterMs)
                        ui.Actions.rebuild()
                    }
                }.Build()
            }
        }
    }
}
