package Gyroid.Components

import Goo
import Goo.Widgets.Layout
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import Gyroid.Views
import System
import System.Globalization

class LayoutParts {
    shared {
        func BarSegment(share float64, color Color, height float64 = 8, minWidth float64 = 3) Container -> Container{
            FlexGrow: share,
            FlexBasis: 0,
            MinWidth: minWidth,
            Height: height,
            BorderRadius: 2,
            BackgroundColor: color
        }

        func Grow(blob Blob) Blob {
            blob.FlexGrow = 1
            blob.FlexBasis = 0
            blob.MinWidth = 0
            return blob
        }

        func DialogRoot(ui Presentation) Container -> Container{
            Position: PositionType.Absolute,
            Left: 0,
            Right: 0,
            Top: 0,
            Bottom: 0,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            OnPointerDown: (event PointerEvent) -> ui.Actions.touch(),
            OnWheel: (event WheelEvent) -> ui.Actions.touch()
        }

        func Accent(color Color, content Blob) Blob -> Container{
            BorderWidth: Edges{Left: 3},
            BorderColor: color,
            Padding: Edges{Left: 12},
            MinWidth: 0,
            content
        }

        func ActionRow(children[]Blob) Blob {
            let row = Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.FlexEnd,
                Gap: 8,
                FlexShrink: 0
            }
            for child in children {
                row.Add(child)
            }
            return row
        }

        func UpgradeTimeline(ui Presentation, status NodeStatus, span float64) Blob {
            let style = DateTimeStyles.None
            if !DateTime.TryParseExact(
                status.UpgradeDate,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                style,
                out let date
            ) ||
                !DateTime
                .TryParseExact(
                status.UpgradeDeadline,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                style,
                out let deadline
            ) {
                return Container{}
            }
            let end = float64(CoreRelease.UpgradeHeight) + (deadline - date).TotalDays * 288
            let now = status.Syncing ? 0.0: Math.Min(span, span * status.Height / end)
            let upgrade = span * CoreRelease.UpgradeHeight / end
            let bar = Container{
                Width: span,
                Height: 8,
                Accessibility: Accessibility{
                    Name: (status.Syncing ? "": Count(status.Height) + " / ") +
                        Count(CoreRelease.UpgradeHeight) +
                        " · " +
                        status.UpgradeDeadline
                },
                Container{
                    Position: PositionType.Absolute,
                    Width: now,
                    Height: 8,
                    BorderRadius: 2,
                    BackgroundColor: ui.Lime
                }
            }
            if upgrade > now {
                let dashes = PathBuilder(0, 0, upgrade - now, 8)
                var dash = 0.0
                while dash < upgrade - now {
                    let right = Math.Min(dash + 6, upgrade - now)
                    dashes.MoveTo(dash, 0).LineTo(right, 0).LineTo(right, 8).LineTo(dash, 8).Close()
                    dash += 10
                }
                bar.Add(
                    Shape{
                        Position: PositionType.Absolute,
                        Left: now,
                        Width: upgrade - now,
                        Height: 8,
                        Path: dashes.Build(),
                        Fit: ShapeFit.Fill,
                        BackgroundColor: ui.Orange
                    }
                )
            }
            let stripes = PathBuilder(0, 0, span - upgrade, 8)
            var x = -8.0
            while x < span - upgrade {
                stripes.MoveTo(x, 8).LineTo(x + 8, 0).LineTo(x + 12, 0).LineTo(x + 4, 8).Close()
                x += 10
            }
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: upgrade,
                    Width: span - upgrade,
                    Height: 8,
                    BorderRadius: 2,
                    Overflow: Overflow.Hidden,
                    BackgroundColor: Color.Parse("#3a0026"),
                    Shape{
                        Width: span - upgrade,
                        Height: 8,
                        Path: stripes.Build(),
                        Fit: ShapeFit.Fill,
                        BackgroundColor: ui.Pink
                    }
                }
            )
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: now - 1,
                    Top: -5,
                    Width: 2,
                    Height: 18,
                    BackgroundColor: ui.Lime
                }
            )
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: upgrade - 1,
                    Top: -5,
                    Width: 2,
                    Height: 18,
                    BackgroundColor: ui.Orange
                }
            )
            return bar
        }
    }
}
