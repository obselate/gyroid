package Gyroid.Components

import Goo
import Goo.Widgets.Layout
import Gyroid.Services
import Gyroid.Services.WalletText
import Gyroid.Views
import System
import System.Globalization

class LayoutParts {
    shared {
        func BarSegment(share float64, color Color, height float64 = 8, minWidth float64 = 3) Container -> Container{
            BasedOn: AppTheme.TrackStyle,
            FlexGrow: share,
            FlexBasis: 0,
            MinWidth: minWidth,
            Height: height,
            BorderRadius: AppTheme.Radius2,
            BackgroundColor: color
        }

        func SegmentGrid(
            rows int32,
            columns int32,
            cell Func[int32, Blob],
            gap float64 = 4,
            rowGap float64 = 8,
            minHeight float64 = 8,
            maxHeight float64 = 44,
            label Func[int32, Blob]? = nil
        ) Container {
            let grid = Container{FlexGrow: 1, MinHeight: 0, Gap: rowGap, JustifyContent: JustifyContent.Center}
            for row in 0 ... Math.Max(0, rows) {
                let line = Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: AppTheme.Space10,
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinHeight: minHeight,
                    MaxHeight: maxHeight
                }
                if let buildLabel = label {
                    line.Add(buildLabel(row))
                }
                let cells = Container{FlexDirection: FlexDirection.Row, Gap: gap, FlexGrow: 1, MinWidth: 0}
                for column in 0 ... Math.Max(0, columns) {
                    cells.Add(cell(row * columns + column))
                }
                line.Add(cells)
                grid.Add(line)
            }
            return grid
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

        func ActionRow(children[]Blob) Blob {
            let row = Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.FlexEnd,
                Gap: AppTheme.Space8,
                FlexShrink: 0
            }
            for child in children {
                row.Add(child)
            }
            return row
        }

        func UpgradeTimeline(
            ui Presentation,
            upgradeDate string,
            upgradeDeadline string,
            syncing bool,
            height uint64,
            span float64
        ) Blob {
            let style = DateTimeStyles.None
            if !DateTime.TryParseExact(upgradeDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, style, out let date) ||
                !DateTime
                .TryParseExact(upgradeDeadline, "yyyy-MM-dd", CultureInfo.InvariantCulture, style, out let deadline) {
                return Container{}
            }
            let end = float64(CoreRelease.UpgradeHeight) + (deadline - date).TotalDays * 288
            let now = syncing ? 0.0: Math.Min(span, span * height / end)
            let upgrade = span * CoreRelease.UpgradeHeight / end
            let bar = Container{
                Width: span,
                Height: 8,
                Accessibility: Accessibility{
                    Name: (syncing ? "": Count(height) + " / ") +
                        Count(CoreRelease.UpgradeHeight) +
                        " · " +
                        upgradeDeadline
                },
                Container{
                    Position: PositionType.Absolute,
                    Width: now,
                    Height: 8,
                    BorderRadius: AppTheme.Radius2,
                    BackgroundColor: AppTheme.Lime
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
                        BackgroundColor: AppTheme.Orange
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
                    BorderRadius: AppTheme.Radius2,
                    Overflow: Overflow.Hidden,
                    BackgroundColor: AppTheme.PinkSoft,
                    Shape{
                        Width: span - upgrade,
                        Height: 8,
                        Path: stripes.Build(),
                        Fit: ShapeFit.Fill,
                        BackgroundColor: AppTheme.Pink
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
                    BackgroundColor: AppTheme.Lime
                }
            )
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: upgrade - 1,
                    Top: -5,
                    Width: 2,
                    Height: 18,
                    BackgroundColor: AppTheme.Orange
                }
            )
            return bar
        }
    }
}
