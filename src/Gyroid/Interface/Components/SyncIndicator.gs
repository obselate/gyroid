package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Node
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.IO
import System.Linq

partial class App {
    private func Phase() string {
        let status = wallet.Node.Status
        return if status.Phase.Length == 0 && status.Running && status.Peers == 0 {
            "Connecting"
        } else {
            status.Phase
        }
    }

    private func Preparing() bool -> wallet.Node.Status.Phase.Length > 0 && wallet.Node.Status.Phase != "ChainSync"

    private func PhaseName() string -> ui.Strings.Get(
        switch Phase() {
            case "Core": "Core download"
            case "ChainSync": "Syncing"
            default: Phase()
        }
    )

    private func PhasePercent() int32? {
        let status = wallet.Node.Status
        if status.Phase != "ChainSync" {
            return status.DownloadPercent
        }
        if status.ChainHeight == 0 {
            return nil
        }
        return Math.Min(100, int32(100 * (status.SyncProgress ?? status.Height) / status.ChainHeight))
    }

    private func PhaseText() string -> if let value = PhasePercent() {
        PhaseName() + " " + value.ToString() + "%"
    } else {
        PhaseName()
    }

    private func SyncIndicator(size float64, fontSize float64) Blob? {
        if Phase().Length == 0 {
            return nil
        }
        let row = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            FlexShrink: 0,
            Accessibility: Accessibility{Role: AccessibilityRole.ProgressBar, Name: PhaseText(), Busy: true}
        }
        guard let percent = PhasePercent() else {
            row.Add(
                Cell.Mount[SpinnerInput, Spinner](
                    if PlaybackActive() {
                        "sync"
                    } else {
                        "sync-idle"
                    },
                    SpinnerInput{Size: size, Color: ui.Lime, Label: PhaseName()}
                )
            )
            row.Add(ui.Label(PhaseName(), fontSize, ui.Body, ""))
            return row
        }
        let stroke = Math.Max(2.0, size / 10)
        let center = size / 2
        let radius = center - stroke / 2
        let circle = PathBuilder(0, 0, size, size)
            .MoveTo(center, stroke / 2)
            .ArcTo(radius, radius, 0, false, true, center, size - stroke / 2)
            .ArcTo(radius, radius, 0, false, true, center, stroke / 2)
            .Build()
        row.Add(
            Container{
                Width: size,
                Height: size,
                FlexShrink: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                Shape{
                    Position: PositionType.Absolute,
                    Width: size,
                    Height: size,
                    Path: circle,
                    BorderWidth: stroke,
                    BorderColor: ui.Rule
                },
                Shape{
                    Position: PositionType.Absolute,
                    Width: size,
                    Height: size,
                    Path: circle,
                    BorderWidth: stroke,
                    BorderColor: ui.Lime,
                    StrokeEnd: percent / 100.0
                },
                MaterialIcons.Create(
                    switch wallet.Node.Status.Phase {
                        case "Checkpoints": "verified"
                        case "ChainSync": "sync"
                        default: "download"
                    },
                    size * 0.6,
                    ui.Lime
                )
            }
        )
        row.Add(ui.Label(PhaseName(), fontSize, ui.Body, ""))
        row.Add(ui.Label((percent.ToString() + "%").PadLeft(4), fontSize, ui.Lime, ""))
        return row
    }
}
