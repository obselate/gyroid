package Gyroid.Interface

import Goo
import Goo.Widgets.Layout
import Gyroid.Interface.TextParts
import Gyroid.Wallet
import Gyroid.Wallet.WalletText
import System
import System.IO
import System.Linq

partial class App {
    private func Chrome() Blob -> WindowChrome{
        Host: window,
        Height: 44,
        ControlWidth: 46,
        ControlColor: ui.Body,
        HoverBackgroundColor: ui.Rule,
        EnableDoubleClick: true,
        EnableContextMenu: true,
        CreateControlContent: (chrome, command) -> ControlGlyph(chrome, command),
        LeadingContent: Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Padding: Edges{Left: 18},
            Image{Width: 18, Height: 18, Source: appIcon},
            Label(ui, "gyroid", 14, ui.Ink, ""),
            Label(ui, WalletAvailable() ? WalletName(wallet.Settings.ActiveWallet): "", 14, ui.Ink, ""),
            Label(ui, wallet.Snapshot.ViewOnly ? ui.Strings.Get("view only"): "", 12, ui.Orange, "")
        }
    }.Build()

    private func ControlGlyph(chrome WindowChrome, command WindowChromeAction) Blob {
        let buttonWidth = chrome.ControlWidth * pixelScale
        let buttonHeight = chrome.Height * pixelScale
        let size = Math.Round(10 * pixelScale)
        let line = Math.Max(1.0, Math.Floor(pixelScale))
        let left = width * pixelScale - buttonWidth * switch command {
            case WindowChromeAction.Minimize: 3
            case WindowChromeAction.Close: 1
            default: 2
        }
        let x = Math.Floor(left + (buttonWidth - size) / 2) - left
        let top = -pixelScale / 2
        let y = Math.Floor(top + (buttonHeight - size) / 2) - top
        let path = PathBuilder(0, 0, buttonWidth, buttonHeight)
        if command == WindowChromeAction.Minimize {
            Outline(path, x, y + Math.Floor((size - line) / 2), []float64{0, 0, size, 0, size, line, 0, line})
        } else if command == WindowChromeAction.Close {
            let edge = line / Math.Sqrt(2)
            Outline(path, x, y, []float64{0, 0, edge, 0, size, size - edge, size, size, size - edge, size, 0, edge})
            Outline(path, x, y, []float64{size, edge, edge, size, 0, size, 0, size - edge, size - edge, 0, size, 0})
        } else {
            let offset = command == WindowChromeAction.Restore ? Math.Round(2 * pixelScale): 0.0
            let front = size - offset
            let inner = front - line
            Outline(path, x, y + offset, []float64{0, 0, front, 0, front, front, 0, front})
            Outline(path, x, y + offset, []float64{line, line, line, inner, inner, inner, inner, line})
            if offset > 0 {
                Outline(
                    path,
                    x + offset,
                    y,
                    []float64{0, 0, front, 0, front, front, inner, front, inner, line, 0, line}
                )
            }
        }
        return Shape{
            Width: chrome.ControlWidth,
            Height: chrome.Height,
            Path: path.Build(),
            Fit: ShapeFit.Fill,
            UseCurrentColor: true
        }
    }

    private func Outline(path PathBuilder, x float64, y float64, points[]float64) {
        path.MoveTo(x + points[0], y + points[1])
        for index in 1 ... points.Length / 2 {
            path.LineTo(x + points[2 * index], y + points[2 * index + 1])
        }
        path.Close()
    }
}
