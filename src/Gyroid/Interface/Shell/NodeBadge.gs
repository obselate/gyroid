package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.Node
import System
import System.Globalization

partial class App {
    private var nodeOpen bool

    private let nodeAnchor ElementHandle = ElementHandle()

    private var upgradeShown bool

    private let showUpgrade Action

    private func NodeState() string {
        let status = wallet.Node.Status
        return if !status.Running {
            "offline"
        } else if status.Syncing {
            "syncing"
        } else if status.Peers == 0 {
            "no peers"
        } else {
            "synced"
        }
    }

    private func NodeColor(state string) Color -> switch state {
        case "offline": ui.Pink
        case "syncing": ui.Lime
        case "no peers": ui.Orange
        default: ui.Mint
    }

    private func NodeBadge() Blob {
        let status = wallet.Node.Status
        let state = NodeState()
        let percent = PhasePercent()
        let height = status.Height > 0 ? ui.Count(status.Height): "-"
        let detail = if state == "offline" {
            ui.Strings.Get(state)
        } else if state == "syncing" && percent != nil {
            percent!!.ToString() + "%"
        } else {
            status.Peers.ToString() + " " + ui.Strings.Get(status.Peers == 1 ? "peer": "peers")
        }
        let badge = Goo
            .Button{
            Handle: nodeAnchor,
            Width: 60,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Column,
            AlignItems: AlignItems.Center,
            Gap: 2,
            Padding: Edges{Top: 6, Bottom: 6},
            BorderWidth: 1,
            BorderRadius: 4,
            BorderColor: nodeOpen ? ui.Edge: ui.Rule,
            BackgroundColor: nodeOpen ? ui.Rule: ui.Black.WithAlpha(0.35),
            Overflow: Overflow.Hidden,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get("node") + " " + height + ", " + detail,
                HasPopup: true,
                Expanded: nodeOpen
            },
            OnClick: () -> {
                nodeOpen = !nodeOpen
                Rebuild()
            },
            ui.Label(height, 11, state == "offline" ? ui.Dim: ui.Ink, ""),
            ui.Label(detail, 10.5, state == "synced" ? ui.Dim: NodeColor(state), "")
        }
        WidgetKeyBindings.BindActivation(badge)
        if state == "syncing" && percent != nil {
            badge.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Bottom: 0,
                    Height: 2,
                    Width: Percent(percent),
                    BackgroundColor: ui.Lime
                }
            )
        }
        return Container{FlexShrink: 0, badge, NodePopover(status, state)}
    }

    private func NodePopover(status NodeStatus, state string) Blob {
        let box = nodeAnchor.BorderBox
        let center = box.Y + box.Height / 2
        let version = status.Version.Length > 0 ? "v" + status.Version: ui.Strings.Get("unknown")
        let card = Container{
            Width: 330,
            Padding: Edges{Left: 18, Right: 18, Top: 16, Bottom: 16},
            Gap: 14,
            BackgroundColor: ui.Raised,
            BorderWidth: 1,
            BorderColor: ui.Edge,
            BorderRadius: 12,
            BoxShadows: []BoxShadow{BoxShadow{OffsetY: 10, Blur: 40, Color: ui.Black.WithAlpha(0.9)}},
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                ui.Label(ui.Strings.Get(state), 14, NodeColor(state), ""),
                ui.Label(ui.Strings.Get(status.Network) + " · " + version, 14, ui.Dim, "")
            }
        }
        if status.Running {
            let readings = Container{Gap: 10}
            let syncing = state == "syncing"
            readings.Add(
                NodeReading("Height", ui.Count(status.Height), syncing ? " / " + ui.Count(status.ChainHeight): "")
            )
            if syncing && status.SyncRate > 0 {
                let minutes = Math.Max(
                    1.0,
                    Math.Ceiling(float64(status.ChainHeight - status.Height) / status.SyncRate / 60)
                )
                readings.Add(
                    NodeReading("Speed", String.Format(ui.Strings.Get("{0} blk/s"), Math.Round(status.SyncRate)))
                )
                readings.Add(NodeReading("Remaining", String.Format(ui.Strings.Get("~{0} min"), minutes)))
            }
            if !syncing && status.LastBlockTime > 0 {
                let time = DateTimeOffset.FromUnixTimeSeconds(status.LastBlockTime).ToLocalTime()
                readings.Add(
                    NodeReading(
                        "Last block",
                        ui.Count(status.Height) + " · " + time.ToString("HH:mm", CultureInfo.InvariantCulture)
                    )
                )
            }
            readings.Add(NodeReading("Peers", status.Peers.ToString()))
            if !syncing {
                readings.Add(NodeReading("Mempool", status.Mempool.ToString() + " " + ui.Strings.Get("tx")))
            }
            card.Add(readings)
        }
        if status.UpgradeDate.Length > 0 {
            card.Add(Container{Height: 1, BackgroundColor: ui.Rule})
            card.Add(
                Container{
                    Gap: 10,
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.SpaceBetween,
                        ui.Label(ui.Strings.Get("Network upgrade"), 13, ui.Body, ""),
                        IconButton{
                            Icon: MaterialIcons.Create("info", 16, ui.Body),
                            AccessibilityName: ui.Strings.Get("Network upgrade"),
                            OnClick: () -> {
                                nodeOpen = false
                                upgradeShown = true
                                Rebuild()
                            }
                        }.Build()
                    },
                    ui.UpgradeTimeline(status, 294),
                    Container{
                        FlexDirection: FlexDirection.Row,
                        JustifyContent: JustifyContent.SpaceBetween,
                        ui.Label(status.UpgradeDate, 14, ui.Ink, ""),
                        ui.Label(ui.Count(status.UpgradeBlocksLeft) + " " + ui.Strings.Get("blocks"), 14, ui.Orange, "")
                    }
                }
            )
        }
        let networkButton = Goo
            .Button{
            Height: 34,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 6,
            Padding: Edges{Left: 14, Right: 10},
            BorderWidth: 1,
            BorderRadius: 8,
            BorderColor: ui.Lime,
            BackgroundColor: ui.Raised,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get("Network")},
            OnClick: () -> {
                nodeOpen = false
                Navigate("Network")
            },
            ui.Label(ui.Strings.Get("Network"), 14, ui.Lime, ""),
            MaterialIcons.Create("chevron_right", 16, ui.Lime)
        }
        WidgetKeyBindings.BindActivation(networkButton)
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.SpaceBetween,
                ui.Button(
                    "Node settings",
                    () -> {
                        nodeOpen = false
                        settingsSection = "node"
                        Navigate("Settings")
                    }
                ),
                networkButton
            }
        )
        let fill = PathBuilder(0, 0, 10, 18).MoveTo(10, 0).LineTo(1, 9).LineTo(10, 18).Close().Build()
        let edge = PathBuilder(0, 0, 10, 18).MoveTo(10, 0).LineTo(1, 9).LineTo(10, 18).Build()
        let caret = Container{
            Width: 9,
            ZIndex: 1,
            Shape{
                Position: PositionType.Absolute,
                Bottom: 35,
                Width: 10,
                Height: 18,
                Path: fill,
                Fit: ShapeFit.Fill,
                BackgroundColor: ui.Raised
            },
            Shape{
                Position: PositionType.Absolute,
                Bottom: 35,
                Width: 10,
                Height: 18,
                Path: edge,
                Fit: ShapeFit.Fill,
                BorderWidth: 1,
                BorderColor: ui.Edge
            }
        }
        return Cell.Mount[PopoverInput, Popover](
            "node",
            PopoverInput{
                Open: nodeOpen,
                Anchor: nodeAnchor,
                Placement: PopoverPlacement.RightStart,
                Gap: 5,
                Width: 339,
                MaxHeight: height,
                ViewportMargin: 0,
                Viewport: ElementRect{X: 0, Y: 52, Width: width, Height: Math.Max(1.0, center - 8)},
                Content: Container{FlexDirection: FlexDirection.Row, caret, card},
                CreatePanel: (input PopoverInput, bounds ElementRect, content Blob) -> Container{},
                Role: AccessibilityRole.Dialog,
                AccessibilityName: ui.Strings.Get("node"),
                OnDismiss: reason -> {
                    nodeOpen = false
                    Rebuild()
                }
            }
        )
    }

    private func NodeReading(label string, value string, total string = "") Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Baseline,
        ui.Label(ui.Strings.Get(label), 13, ui.Body, ""),
        Container{FlexGrow: 1},
        ui.Label(value, 14, ui.Ink, ""),
        ui.Label(total, 14, ui.Dim, "")
    }

    private func UpgradeDialog() Blob {
        let node = wallet.Node.Status
        let close Action = () -> {
            upgradeShown = false
            Rebuild()
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "upgrade",
            ModalDialog{
                Open: true,
                CreateRoot: ui.DialogRoot,
                AccessibilityName: ui.Strings.Get("Network upgrade"),
                Width: Math.Min(width - 48, 600),
                Header: ui.Label(ui.Strings.Get("Network upgrade"), 18, ui.Ink, ""),
                Content: Container{
                    Gap: 14,
                    ui.Figure("Date", node.UpgradeDate, ui.Ink),
                    ui.Figure("Blocks left", ui.Count(node.UpgradeBlocksLeft), ui.Orange),
                    ui.Figure("Migration deadline", node.UpgradeDeadline, ui.Ink),
                    Text{
                        Content: node.UpgradeNotice,
                        FontFamily: ui.Font,
                        FontSize: 13,
                        Color: ui.Body,
                        TextWrap: TextWrap.Wrap
                    }
                },
                Footer: ui.ActionRow([]Blob{ui.Button("Close", close)}),
                OnCancel: close,
                OnClose: close
            }
        )
    }
}
