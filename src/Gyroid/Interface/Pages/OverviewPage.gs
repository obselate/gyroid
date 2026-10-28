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

partial class WalletView {
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
        Accessibility: Accessibility{Name: strings.Get(label) + " " + value},
        Label(strings.Get(label), 12, body),
        Label(value, 16, color, "balance")
    }

    private func Balance(snapshot WalletSnapshot) Blob {
        let balance = snapshot.Balance
        var total = if balance?.Scanning == true {
            strings.Get("Scanning")
        } else {
            strings.Get("Unavailable")
        }
        var totalColor = if balance?.Scanning == true {
            orange
        } else {
            body
        }
        var spendable = strings.Get("Unavailable")
        var pending = strings.Get("Unavailable")
        var pendingColor = body
        if let units = balance?.Balance {
            total = Amount(units)
            totalColor = lime
        }
        if let units = balance?.Spendable {
            spendable = Amount(units)
        }
        if let units = balance?.Pending {
            pending = Amount(units)
            pendingColor = if units > 0 {
                orange
            } else {
                ink
            }
        }
        let room = width - 680
        let size = Math.Max(24, Math.Min(height * 0.07, room / (0.62 * total.Length)))
        let figure = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: 10,
            MinWidth: 0,
            Label(total, size, totalColor, "balance")
        }
        if balance?.Balance != nil {
            figure.Add(Container{FlexShrink: 0, Label("BNT", 18, body, "")})
        }
        let hero = Glass()
        hero.FlexShrink = 0
        hero.FlexDirection = FlexDirection.Row
        hero.AlignItems = AlignItems.Center
        hero.Gap = 24
        hero.BorderWidth = Edges{Left: 3, Top: 1, Right: 1, Bottom: 1}
        hero.BorderStartColor = lime
        hero.Add(
            Grow(
                Container{
                    Gap: 4,
                    Accessibility: Accessibility{Name: strings.Get("Balance") + " " + total},
                    Label(strings.Get("Balance"), 12, body),
                    figure
                }
            )
        )
        hero.Add(Container{Width: 1, AlignSelf: AlignSelf.Stretch, BackgroundColor: rule})
        hero.Add(
            Container{
                Width: 280,
                FlexShrink: 0,
                Gap: 12,
                Stat("Available", spendable, ink),
                Stat("Pending", pending, pendingColor)
            }
        )
        return hero
    }

    private func Chain(snapshot WalletSnapshot) Blob {
        guard let value = snapshot.Balance else {
            return Figure("Height", strings.Get("Unavailable"), body)
        }
        if value.Scanning {
            return Figure("Height", Count(value.ScanHeight) + " / " + Count(value.ChainHeight), orange, 14, "sync")
        }
        return Figure("Height", Count(value.ChainHeight), ink, 14, "sync")
    }

    private func Upgrade(node NodeStatus) Blob {
        let strip = Glass()
        strip.FlexShrink = 0
        strip.FlexDirection = FlexDirection.Row
        strip.AlignItems = AlignItems.Center
        strip.Gap = 24
        strip.Padding = Edges{Top: 6, Left: 20, Right: 8, Bottom: 6}
        strip.BorderWidth = Edges{Left: 3, Top: 1, Right: 1, Bottom: 1}
        strip.BorderStartColor = orange
        strip.Add(Figure("Network upgrade", node.UpgradeDate, ink))
        strip.Add(Grow(Figure("Blocks left", Count(node.UpgradeBlocksLeft), orange)))
        strip.Add(
            IconButton{
                Icon: MaterialIcons.Create("info", 16, body),
                AccessibilityName: strings.Get("Network upgrade"),
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
                CreateRoot: DialogRoot,
                AccessibilityName: strings.Get("Network upgrade"),
                Width: Math.Min(width - 48, 600),
                Header: Label(strings.Get("Network upgrade"), 18, ink, ""),
                Content: Container{
                    Gap: 14,
                    Figure("Date", node.UpgradeDate, ink),
                    Figure("Blocks left", Count(node.UpgradeBlocksLeft), orange),
                    Figure("Migration deadline", node.UpgradeDeadline, ink),
                    Text{
                        Content: node.UpgradeNotice,
                        FontFamily: font,
                        FontSize: 13,
                        Color: body,
                        TextWrap: TextWrap.Wrap
                    }
                },
                Footer: ActionRow([]Blob{Button("Close", close)}),
                OnCancel: close,
                OnClose: close
            }
        )
    }
}
