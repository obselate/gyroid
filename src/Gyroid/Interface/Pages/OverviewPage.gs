package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Data
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Send
import Gyroid.Wallet
import Net.Codecrete.QrCodeGenerator
import System
import System.Collections.Generic
import System.Globalization
import System.Linq
import System.Text
import System.Threading.Tasks

partial class App {
    private var upgradeShown bool

    private func Dashboard() Blob {
        let snapshot = wallet.Snapshot
        let content = Container{Gap: 16, FlexGrow: 1, FlexBasis: 0, MinHeight: 0}
        if wallet.Send.Pending != nil || wallet.Send.Outcome.Text.Length > 0 {
            content.Add(PendingSendBanner())
        }
        content.Add(Balance(snapshot))
        if wallet.Node.Status.UpgradeDate.Length > 0 {
            content.Add(Upgrade(wallet.Node.Status))
        }
        content.Add(History(snapshot))
        return content
    }

    private func Stat(label string, value string, color Color) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Baseline,
        JustifyContent: JustifyContent.SpaceBetween,
        Gap: 16,
        Accessibility: Accessibility{Name: ui.Strings.Get(label) + " " + value},
        ui.Label(ui.Strings.Get(label), 12, ui.Body),
        ui.Label(value, 16, color, "balance")
    }

    private func Balance(snapshot WalletSnapshot) Blob {
        let balance = snapshot.Balance
        var total = if balance?.Scanning == true {
            ui.Strings.Get("Scanning")
        } else {
            ui.Strings.Get("Unavailable")
        }
        var totalColor = if balance?.Scanning == true {
            ui.Orange
        } else {
            ui.Body
        }
        var spendable = ui.Strings.Get("Unavailable")
        var pending = ui.Strings.Get("Unavailable")
        var pendingColor = ui.Body
        if let units = balance?.Balance {
            total = ui.Amount(units)
            totalColor = ui.Lime
        }
        if let units = balance?.Spendable {
            spendable = ui.Amount(units)
        }
        if let units = balance?.Pending {
            pending = ui.Amount(units)
            pendingColor = if units > 0 {
                ui.Orange
            } else {
                ui.Ink
            }
        }
        let room = width - 680
        let size = Math.Max(24, Math.Min(height * 0.07, room / (0.62 * total.Length)))
        let figure = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: 10,
            MinWidth: 0,
            ui.Label(total, size, totalColor, "balance")
        }
        if balance?.Balance != nil {
            figure.Add(Container{FlexShrink: 0, ui.Label("BNT", 18, ui.Body, "")})
        }
        let hero = ui.Glass()
        hero.FlexShrink = 0
        hero.FlexDirection = FlexDirection.Row
        hero.AlignItems = AlignItems.Center
        hero.Gap = 24
        hero.BorderWidth = Edges{Left: 3, Top: 1, Right: 1, Bottom: 1}
        hero.BorderStartColor = ui.Lime
        hero.Add(
            ui.Grow(
                Container{
                    Gap: 4,
                    Accessibility: Accessibility{Name: ui.Strings.Get("Balance") + " " + total},
                    ui.Label(ui.Strings.Get("Balance"), 12, ui.Body),
                    figure
                }
            )
        )
        hero.Add(Container{Width: 1, AlignSelf: AlignSelf.Stretch, BackgroundColor: ui.Rule})
        hero.Add(
            Container{
                Width: 280,
                FlexShrink: 0,
                Gap: 12,
                Stat("Available", spendable, ui.Ink),
                Stat("Pending", pending, pendingColor)
            }
        )
        return hero
    }

    private func Chain(snapshot WalletSnapshot) Blob {
        guard let value = snapshot.Balance else {
            return ui.Figure("Height", ui.Strings.Get("Unavailable"), ui.Body)
        }
        if value.Scanning {
            return ui.Figure(
                "Height",
                ui.Count(value.ScanHeight) + " / " + ui.Count(value.ChainHeight),
                ui.Orange,
                14,
                "sync"
            )
        }
        return ui.Figure("Height", ui.Count(value.ChainHeight), ui.Ink, 14, "sync")
    }

    private func Upgrade(node NodeStatus) Blob {
        let strip = ui.Glass()
        strip.FlexShrink = 0
        strip.FlexDirection = FlexDirection.Row
        strip.AlignItems = AlignItems.Center
        strip.Gap = 24
        strip.Padding = Edges{Top: 6, Left: 20, Right: 8, Bottom: 6}
        strip.BorderWidth = Edges{Left: 3, Top: 1, Right: 1, Bottom: 1}
        strip.BorderStartColor = ui.Orange
        strip.Add(ui.Figure("Network upgrade", node.UpgradeDate, ui.Ink))
        strip.Add(ui.Grow(ui.Figure("Blocks left", ui.Count(node.UpgradeBlocksLeft), ui.Orange)))
        strip.Add(
            IconButton{
                Icon: MaterialIcons.Create("info", 16, ui.Body),
                AccessibilityName: ui.Strings.Get("Network upgrade"),
                OnClick: () -> {
                    upgradeShown = true
                    Rebuild()
                }
            }.Build()
        )
        return strip
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
