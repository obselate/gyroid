package Gyroid.Components

import Goo

class ChartParts {
    shared {
        func Tooltip(left float64, top float64, content Blob, width float64? = nil) Blob {
            let surface = Container{BasedOn: AppTheme.PassiveTooltipStyle, HitTestSelf: false, content}
            if let size = width {
                surface.Width = size
            }
            return NetworkParts.Place(left, top, surface)
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
