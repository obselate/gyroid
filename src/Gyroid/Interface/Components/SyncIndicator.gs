package Gyroid.Interface

import Goo
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Gyroid.Interface.TextParts
import Gyroid.Node
import System
import System.IO
import System.Linq

partial class App {
    private func Phase() NodePhase {
        let status = wallet.Node.Status
        return if status.Phase == NodePhase.None && status.Running && status.Peers == 0 {
            NodePhase.Connecting
        } else {
            status.Phase
        }
    }

    private func Preparing() bool -> wallet
        .Node
        .Status
        .Phase != NodePhase.None &&
        wallet
        .Node
        .Status
        .Phase != NodePhase.ChainSync

    private func PhaseName() string -> ui.Strings.Get(
        switch Phase() {
            case NodePhase.None: ""
            case NodePhase.Detecting: "Detecting"
            case NodePhase.Core: "Core download"
            case NodePhase.Checkpoints: "Checkpoints"
            case NodePhase.Starting: "Starting"
            case NodePhase.Connecting: "Connecting"
            case NodePhase.ChainSync: "Syncing"
        }
    )

    private func PhasePercent() int32? {
        let status = wallet.Node.Status
        if status.Phase != NodePhase.ChainSync {
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
        if Phase() == NodePhase.None {
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
            row.Add(Label(ui, PhaseName(), fontSize, ui.Body, ""))
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
                        case NodePhase.Checkpoints: "verified"
                        case NodePhase.ChainSync: "sync"
                        case NodePhase.None,
                        NodePhase.Detecting,
                        NodePhase.Core,
                        NodePhase.Starting,
                        NodePhase.Connecting: "download"
                    },
                    size * 0.6,
                    ui.Lime
                )
            }
        )
        row.Add(Label(ui, PhaseName(), fontSize, ui.Body, ""))
        row.Add(Label(ui, (percent.ToString() + "%").PadLeft(4), fontSize, ui.Lime, ""))
        return row
    }
}
