package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services.WalletText
import System
import System.Globalization

enum NodeConnectionState {
    Offline,
    Syncing,
    NoPeers,
    Synced
}

data struct NodeBadgeInput {
    var Ui Presentation
    var Running bool
    var Syncing bool
    var Height uint64
    var ChainHeight uint64
    var Peers uint64
    var Mempool uint64
    var Version string
    var Network string
    var SyncRate float64
    var LastBlockTime int64
    var UpgradeDate string
    var UpgradeDeadline string
    var UpgradeBlocksLeft uint64
    var Percent int32?
    var Language string
    var Width float64
    var WindowHeight float64
    var OnNavigate Action[AppPage]
    var OnSettings Action
    var OnUpgrade Action
}

class NodeBadgeRegion : Cell[NodeBadgeInput] {
    private var nodeOpen bool

    private let nodeAnchor ElementHandle = ElementHandle()

    init() {
        nodeAnchor.MetricsChanged += _ -> {
            if nodeOpen {
                Rebuild()
            }
        }
    }

    private func NodeState(running bool, syncing bool, peers uint64) NodeConnectionState -> if !running {
        NodeConnectionState.Offline
    } else if syncing {
        NodeConnectionState.Syncing
    } else if peers == 0 {
        NodeConnectionState.NoPeers
    } else {
        NodeConnectionState.Synced
    }

    private func NodeColor(state NodeConnectionState) Color -> switch state {
        case NodeConnectionState.Offline: AppTheme.Pink
        case NodeConnectionState.Syncing: AppTheme.Lime
        case NodeConnectionState.NoPeers: AppTheme.Orange
        case NodeConnectionState.Synced: AppTheme.Mint
    }

    protected override func Build(status NodeBadgeInput) Blob {
        let ui = status.Ui
        let state = NodeState(status.Running, status.Syncing, status.Peers)
        let percent = status.Percent
        let height = status.Height > 0 ? Count(status.Height): "-"
        let detail = if state == NodeConnectionState.Offline {
            ui.Strings.Get("offline")
        } else if state == NodeConnectionState.Syncing && percent != nil {
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
            Gap: AppTheme.Space2,
            Padding: Edges{Top: AppTheme.Space6, Bottom: AppTheme.Space6},
            BorderWidth: AppTheme.Border1,
            BorderRadius: AppTheme.Radius4,
            BorderColor: nodeOpen ? AppTheme.Edge: AppTheme.Rule,
            BackgroundColor: nodeOpen ? AppTheme.Rule: AppTheme.Black.WithAlpha(0.35),
            Overflow: Overflow.Hidden,
            Hover: Style{BackgroundColor: AppTheme.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get("node") + " " + height + ", " + detail,
                HasPopup: true,
                Expanded: nodeOpen
            },
            OnClick: () -> {
                nodeOpen = !nodeOpen
            },
            Label(ui, height, AppTheme.Type11, state == NodeConnectionState.Offline ? AppTheme.Dim: AppTheme.Ink, ""),
            Label(ui, detail, AppTheme.Type11, state == NodeConnectionState.Synced ? AppTheme.Dim: NodeColor(state), "")
        }
        WidgetKeyBindings.BindActivation(badge)
        if state == NodeConnectionState.Syncing && percent != nil {
            badge.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Bottom: 0,
                    ControlParts.Progress(
                        ui.Strings.Get("syncing"),
                        percent / 100.0,
                        AppTheme.Lime,
                        60,
                        2,
                        Color.Transparent
                    )
                }
            )
        }
        return Container{FlexShrink: 0, badge, NodePopover(status, state)}
    }

    private func NodePopover(status NodeBadgeInput, state NodeConnectionState) Blob {
        let ui = status.Ui
        let width = status.Width
        let height = status.WindowHeight
        let box = nodeAnchor.BorderBox
        let center = box.Y + box.Height / 2
        let version = status.Version.Length > 0 ? " · v" + status.Version: ""
        let card = Container{
            BasedOn: AppTheme.InformationCardStyle,
            Width: 330,
            Padding: AppTheme.Space16,
            Gap: AppTheme.Space14,
            BorderRadius: AppTheme.Radius12,
            BoxShadows: []BoxShadow{BoxShadow{OffsetY: 10, Blur: 40, Color: AppTheme.Black.WithAlpha(0.9)}},
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Label(
                    ui,
                    ui.Strings.Get(
                        switch state {
                            case NodeConnectionState.Offline: "offline"
                            case NodeConnectionState.Syncing: "syncing"
                            case NodeConnectionState.NoPeers: "no peers"
                            case NodeConnectionState.Synced: "synced"
                        }
                    ),
                    AppTheme.Type14,
                    NodeColor(state),
                    ""
                ),
                Label(ui, ui.Strings.Get(status.Network) + version, AppTheme.Type14, AppTheme.Dim, "")
            }
        }
        if status.Running {
            let readings = Container{Gap: AppTheme.Space10}
            let syncing = state == NodeConnectionState.Syncing
            readings.Add(
                NodeReading(ui, "Height", Count(status.Height), syncing ? " / " + Count(status.ChainHeight): "")
            )
            if syncing && status.SyncRate > 0 {
                let minutes = Math.Max(
                    1.0,
                    Math.Ceiling(float64(status.ChainHeight - status.Height) / status.SyncRate / 60)
                )
                readings.Add(
                    NodeReading(ui, "Speed", String.Format(ui.Strings.Get("{0} blk/s"), Math.Round(status.SyncRate)))
                )
                readings.Add(NodeReading(ui, "Remaining", String.Format(ui.Strings.Get("~{0} min"), minutes)))
            }
            if !syncing && status.LastBlockTime > 0 {
                let time = DateTimeOffset.FromUnixTimeSeconds(status.LastBlockTime).ToLocalTime()
                readings.Add(
                    NodeReading(
                        ui,
                        "Last block",
                        Count(status.Height) + " · " + time.ToString("HH:mm", CultureInfo.InvariantCulture)
                    )
                )
            }
            readings.Add(NodeReading(ui, "Peers", status.Peers.ToString()))
            if !syncing {
                readings.Add(NodeReading(ui, "Mempool", status.Mempool.ToString() + " " + ui.Strings.Get("tx")))
            }
            card.Add(readings)
        }
        if status.UpgradeDate.Length > 0 {
            let upgradeDate = Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.SpaceBetween,
                Label(ui, status.UpgradeDate, AppTheme.Type14, AppTheme.Ink, "")
            }
            if !status.Syncing {
                upgradeDate.Add(
                    Label(
                        ui,
                        Count(status.UpgradeBlocksLeft) + " " + ui.Strings.Get("blocks"),
                        AppTheme.Type14,
                        AppTheme.Orange,
                        ""
                    )
                )
            }
            card.Add(Container{Height: 1, BackgroundColor: AppTheme.Rule})
            card.Add(
                Container{
                    Gap: AppTheme.Space10,
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.SpaceBetween,
                        Label(ui, ui.Strings.Get("Network upgrade"), AppTheme.Type13, AppTheme.Body, ""),
                        (
                            AppTheme.IconButton with{
                                Icon = MaterialIcons.Create("info", AppTheme.Icon16, AppTheme.Body),
                                AccessibilityName = ui.Strings.Get("Network upgrade"),
                                OnClick = () -> {
                                    nodeOpen = false
                                    Rebuild()
                                    status.OnUpgrade()
                                }
                            }
                        ).Build()
                    },
                    UpgradeTimeline(ui, status.UpgradeDate, status.UpgradeDeadline, status.Syncing, status.Height, 294),
                    upgradeDate
                }
            )
        }
        let networkButton = Goo
            .Button{
            BasedOn: AppTheme.ButtonStyle,
            Gap: AppTheme.Space6,
            Padding: Edges{Left: AppTheme.Space14, Right: AppTheme.Space10},
            BorderColor: AppTheme.Lime,
            BackgroundColor: AppTheme.Raised,
            Hover: Style{BackgroundColor: AppTheme.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get("Network")},
            OnClick: () -> {
                nodeOpen = false
                status.OnNavigate(AppPage.Network)
            },
            Label(ui, ui.Strings.Get("Network"), AppTheme.Type14, AppTheme.Lime, ""),
            MaterialIcons.Create("chevron_right", AppTheme.Icon16, AppTheme.Lime)
        }
        WidgetKeyBindings.BindActivation(networkButton)
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.SpaceBetween,
                Button(
                    ui,
                    "Node settings",
                    () -> {
                        nodeOpen = false
                        status.OnSettings()
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
                BackgroundColor: AppTheme.Raised
            },
            Shape{
                Position: PositionType.Absolute,
                Bottom: 35,
                Width: 10,
                Height: 18,
                Path: edge,
                Fit: ShapeFit.Fill,
                BorderWidth: AppTheme.Border1,
                BorderColor: AppTheme.Edge
            }
        }
        return Cell.Mount[PopoverInput, Popover](
            "node",
            PopoverInput{
                Open: nodeOpen,
                Anchor: nodeAnchor,
                Placement: PopoverPlacement.RightStart,
                Gap: AppTheme.Space6,
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

    private func NodeReading(ui Presentation, label string, value string, total string = "") Blob ->
    KeyValue(
        ui,
        ui.Strings.Get(label),
        Container{
            FlexDirection: FlexDirection.Row,
            Label(ui, value, AppTheme.Type12, AppTheme.Ink, ""),
            Label(ui, total, AppTheme.Type12, AppTheme.Dim, "")
        }
    )
}

partial class App {
    private var upgradeShown bool
    private let showUpgrade Action

    private func NodeBadge() Blob {
        let node = wallet.Node.Status
        return Cell.Mount[NodeBadgeInput, NodeBadgeRegion](
            "node-badge",
            NodeBadgeInput{
                Ui: ui,
                Running: node.Running,
                Syncing: node.Syncing,
                Height: node.Height,
                ChainHeight: node.ChainHeight,
                Peers: node.Peers,
                Mempool: node.Mempool,
                Version: node.Version,
                Network: node.Network,
                SyncRate: node.SyncRate,
                LastBlockTime: node.LastBlockTime,
                UpgradeDate: node.UpgradeDate,
                UpgradeDeadline: node.UpgradeDeadline,
                UpgradeBlocksLeft: node.UpgradeBlocksLeft,
                Percent: PhasePercent(),
                Language: ui.Strings.Language,
                Width: width,
                WindowHeight: height,
                OnNavigate: navigate,
                OnSettings: openNodeSettings,
                OnUpgrade: showUpgrade
            }
        )
    }

    private func UpgradeDialog() Blob {
        let node = wallet.Node.Status
        let close Action = () -> {
            upgradeShown = false
            Rebuild()
        }
        return WalletParts.Modal(
            ui,
            "upgrade",
            AppTheme.Dialog with{
                Open = true,
                AccessibilityName = ui.Strings.Get("Network upgrade"),
                Width = Math.Min(width - 48, 600),
                Header = WalletParts.Header(
                    Label(ui, ui.Strings.Get("Network upgrade"), AppTheme.Type17, AppTheme.Ink, "")
                ),
                Content = Container{
                    Gap: AppTheme.Space14,
                    Figure(ui, "Date", node.UpgradeDate, AppTheme.Ink),
                    Figure(ui, "Blocks left", Count(node.UpgradeBlocksLeft), AppTheme.Orange),
                    Figure(ui, "Migration deadline", node.UpgradeDeadline, AppTheme.Ink),
                    Text{
                        Content: ui.Strings.UpgradeInstructions(node.UpgradeDate, node.UpgradeDeadline),
                        FontFamily: AppTheme.Font,
                        FontSize: AppTheme.Type13,
                        Color: AppTheme.Body,
                        TextWrap: TextWrap.Wrap
                    }
                },
                Footer = ActionRow([]Blob{Button(ui, "Close", close)}),
                OnCancel = close,
                OnClose = close
            }
        )
    }
}
