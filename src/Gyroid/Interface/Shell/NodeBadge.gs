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
                    UpgradeTimeline(status),
                    Container{
                        FlexDirection: FlexDirection.Row,
                        JustifyContent: JustifyContent.SpaceBetween,
                        ui.Label(status.UpgradeDate, 14, ui.Ink, ""),
                        ui.Label(ui.Count(status.UpgradeBlocksLeft) + " " + ui.Strings.Get("blocks"), 14, ui.Orange, "")
                    }
                }
            )
        }
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                ui.Button(
                    "Node settings",
                    () -> {
                        nodeOpen = false
                        Navigate("Settings")
                        settingsTab = "node"
                    }
                )
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

    private func UpgradeTimeline(status NodeStatus) Blob {
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
        let span = 294.0
        let end = float64(CoreRelease.UpgradeHeight) + (deadline - date).TotalDays * 288
        let now = Math.Min(span, span * status.Height / end)
        let upgrade = span * CoreRelease.UpgradeHeight / end
        let bar = Container{
            Width: span,
            Height: 8,
            Accessibility: Accessibility{
                Name: ui.Count(status.Height) + " / " + ui.Count(CoreRelease.UpgradeHeight) +
                    " · " +
                    status.UpgradeDeadline
            },
            Container{Position: PositionType.Absolute, Width: now, Height: 8, BorderRadius: 2, BackgroundColor: ui.Lime}
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

    private func NodeReading(label string, value string, total string = "") Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Baseline,
        ui.Label(ui.Strings.Get(label), 13, ui.Body, ""),
        Container{FlexGrow: 1},
        ui.Label(value, 14, ui.Ink, ""),
        ui.Label(total, 14, ui.Dim, "")
    }
}
