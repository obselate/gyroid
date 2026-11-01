package Gyroid.Components

import Goo

class ChartParts {
    shared {
        func Tooltip(
            left Length,
            top Length,
            content Blob,
            width float64? = nil,
            right Length? = nil,
            bottom Length? = nil,
            margin Edges? = nil,
            zIndex int32 = 0
        ) Container {
            let surface = Container{BasedOn: AppTheme.PassiveTooltipStyle, HitTestSelf: false, content}
            if let size = width {
                surface.Width = size
            }
            let placed = Container{Position: PositionType.Absolute, HitTestSelf: false, ZIndex: zIndex, surface}
            if let edge = right {
                placed.Right = edge
            } else {
                placed.Left = left
            }
            if let edge = bottom {
                placed.Bottom = edge
            } else {
                placed.Top = top
            }
            if let inset = margin {
                placed.Margin = inset
            }
            return placed
        }

        func Point(left Length, top Length, color Color, size float64 = 8) Container -> Container{
            Position: PositionType.Absolute,
            Left: left,
            Top: top,
            Margin: Edges{Left: -size / 2, Top: -size / 2},
            Width: size,
            Height: size,
            BorderRadius: size / 2,
            BackgroundColor: color,
            HitTestSelf: false
        }
    }
}
