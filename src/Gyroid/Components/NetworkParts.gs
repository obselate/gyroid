package Gyroid.Components

import Goo
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services.WalletText
import Gyroid.Views
import System
import System.Globalization

class NetworkParts {
    shared {
        func Figure(
            ui Presentation,
            label string,
            value string,
            unit string,
            size float64,
            color Color,
            weight float64 = 1
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
                Cell.Mount[DecodeValueInput, DecodeValue](
                    label,
                    DecodeValueInput{
                        Value: value,
                        Name: ui.Strings.Get(label) + " " + value,
                        Size: size,
                        Color: color,
                        FractionColor: color,
                        Live: AccessibilityLive.Off,
                        Ui: ui
                    }
                ),
                Label(ui, unit, AppTheme.Type11, color, "")
            }
        }

        func TimeChart(
            ui Presentation,
            blocks[]NetworkBlock,
            handle ElementHandle,
            selected uint64,
            onSelect Action[uint64],
            compact bool = false,
            offline bool = false
        ) Blob {
            let count = Math.Min(blocks.Length - 1, compact ? 30: 60)
            let plot = Container{
                Handle: handle,
                FlexGrow: 1,
                MinHeight: 0,
                Overflow: Overflow.Hidden,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.Image,
                    Name: String.Format(ui.Strings.Get("last {0} block times, target 5:00"), Math.Max(count, 0))
                },
                OnPointerLeave: (event PointerEvent) -> onSelect(0)
            }
            let width = handle.BorderBox.Width
            let height = handle.BorderBox.Height
            if count < 1 || width <= 50 || height <= 30 {
                return plot
            }
            let inner = width - 46
            let extent = height - (compact ? 6.0: 22.0)
            let limit = compact ? 480.0: 900.0
            let slots = compact ? 30: 60
            let step = inner / slots
            let target = Level(300, extent, limit)
            for tick in 0 ... 3 {
                let seconds = (3 - tick) * (compact ? 150.0: 300.0)
                let top = Level(seconds, extent, limit)
                if seconds == 300 {
                    plot.Add(
                        Shape{
                            Position: PositionType.Absolute,
                            Left: 2,
                            Top: top,
                            Width: inner,
                            Height: 1,
                            Path: PathBuilder(0, 0, inner, 1).MoveTo(0, 0.5).LineTo(inner, 0.5).Build(),
                            Fit: ShapeFit.Fill,
                            BorderWidth: AppTheme.Border1,
                            BorderColor: AppTheme.Dim,
                            Dashes: DashPattern([]float64{4, 3}, 0)
                        }
                    )
                } else {
                    plot.Add(Rule(2, top, inner, AppTheme.FaintRule))
                }
                plot.Add(
                    Place(inner + 10, top - 7, Label(ui, Duration(int64(seconds)), AppTheme.Type10, AppTheme.Dim, ""))
                )
            }
            let start = blocks.Length - count - 1
            for index in 0 ... count {
                let block = blocks[start + index + 1]
                let seconds = Math.Max(0L, block.Timestamp - blocks[start + index].Timestamp)
                let level = Level(float64(seconds), extent, limit)
                let left = 2 + (slots - count + index) * step
                let chosen = block.Height == selected
                plot.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Left: left + step * 0.18,
                        Top: compact ? level: Math.Min(level, target),
                        Width: Math.Max(2.0, step * 0.64),
                        Height: Math.Max(1.5, compact ? extent + 6 - level: Math.Abs(level - target)),
                        BorderRadius: AppTheme.Radius1,
                        BorderWidth: chosen ? AppTheme.Border1_2: AppTheme.Border0,
                        BorderColor: AppTheme.Ink,
                        BackgroundColor: if offline {
                            AppTheme.Selected
                        } else if compact {
                            AppTheme.TransportBlueMuted
                        } else if seconds > 300 {
                            chosen ? AppTheme.Orange: AppTheme.WarningMuted
                        } else {
                            chosen ? AppTheme.Blue: AppTheme.InfoMuted
                        }
                    }
                )
                if !compact {
                    plot.Add(
                        Container{
                            Position: PositionType.Absolute,
                            Left: left,
                            Top: 0,
                            Width: step,
                            Height: height,
                            OnPointerEnter: (event PointerEvent) -> onSelect(block.Height)
                        }
                    )
                }
            }
            if !compact {
                plot.Add(
                    Place(2, height - 14, Label(ui, "#" + Count(blocks[0].Height), AppTheme.Type11, AppTheme.Dim, ""))
                )
                plot.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Right: 44,
                        Top: height - 14,
                        Label(ui, "#" + Count(blocks[blocks.Length - 1].Height), AppTheme.Type11, AppTheme.Dim, "")
                    }
                )
            }
            return plot
        }

        private func Level(seconds float64, extent float64, limit float64) float64 ->
        6 + extent * (1 - Math.Min(seconds, limit) / limit)

        func Rule(left float64, top float64, width float64, color Color) Blob -> Container{
            Position: PositionType.Absolute,
            Left: left,
            Top: top,
            Width: width,
            Height: 1,
            BackgroundColor: color
        }

        func Place(left float64, top float64, content Blob) Blob -> Container{
            Position: PositionType.Absolute,
            Left: left,
            Top: top,
            HitTestSelf: false,
            content
        }

        func Duration(seconds int64) string -> (seconds / 60).ToString(CultureInfo.InvariantCulture) +
            ":" +
            (seconds % 60).ToString("00", CultureInfo.InvariantCulture)

        func Rate(hashes float64) string -> (
            hashes / Math.Pow(1000, Math.Clamp(Math.Floor(Math.Log10(Math.Max(hashes, 1)) / 3), 0, 3))
        ).ToString("0.00", CultureInfo.InvariantCulture)

        func Unit(hashes float64) string -> switch int32(
            Math.Clamp(Math.Floor(Math.Log10(Math.Max(hashes, 1)) / 3), 0, 3)
        ) {
            case 0: "H/s"
            case 1: "kH/s"
            case 2: "MH/s"
            default: "GH/s"
        }

        func Compact(value uint64) string -> if value >= 1000000000 {
            (value / 1e9).ToString("0.00", CultureInfo.InvariantCulture) + " G"
        } else if value >= 1000000 {
            (value / 1e6).ToString("0.00", CultureInfo.InvariantCulture) + " M"
        } else if value >= 1000 {
            (value / 1e3).ToString("0.00", CultureInfo.InvariantCulture) + " K"
        } else {
            value.ToString(CultureInfo.InvariantCulture)
        }
    }
}
