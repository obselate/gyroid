package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.TextParts
import System
import System.Linq

partial class App {
    private func RailItem(label string, icon string, selected bool, disabled bool, action Action) Blob {
        let color = if disabled {
            ui.Dim
        } else if selected {
            ui.Lime
        } else {
            ui.Body
        }
        let button = Goo
            .Button{
            Width: 60,
            Height: height < 700 ? 44.0: 48.0,
            FlexShrink: 1,
            FlexDirection: FlexDirection.Column,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Gap: 4,
            BorderRadius: 10,
            BackgroundColor: if selected {
                Color.Parse("#121906")
            } else {
                Color.Transparent
            },
            Disabled: disabled,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get(label),
                Selected: selected
            },
            OnClick: action,
            MaterialIcons.Create(icon, 20, color),
            Label(ui, ui.Strings.Get(label), 11, color, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Sidebar(page AppPage) Blob {
        let blocked = ui.Working()
        let compact = height < 700
        let inset = compact ? 4.0: 8.0
        let rail = WalletParts.Card(ui, Edges{Top: inset, Bottom: inset}, compact ? 0.0: 2.0, 14)
        rail.Width = 72
        rail.FlexShrink = 0
        rail.AlignItems = AlignItems.Center
        rail.Add(RailItem("overview", "grid_view", page == AppPage.Overview, blocked, () -> Navigate(AppPage.Overview)))
        if !wallet.Snapshot.ViewOnly {
            rail.Add(RailItem("send", "north_east", page == AppPage.Send, blocked, () -> Navigate(AppPage.Send)))
        }
        rail.Add(RailItem("receive", "south_west", page == AppPage.Receive, blocked, () -> Navigate(AppPage.Receive)))
        rail.Add(
            RailItem("history", "schedule", page == AppPage.Transactions, blocked, () -> Navigate(AppPage.Transactions))
        )
        rail.Add(RailItem("tools", "tune", page == AppPage.Tools, blocked, () -> Navigate(AppPage.Tools)))
        rail.Add(RailItem("contacts", "person", page == AppPage.Contacts, blocked, () -> Navigate(AppPage.Contacts)))
        rail.Add(RailItem("mining", "hardware", page == AppPage.Mining, blocked, () -> Navigate(AppPage.Mining)))
        rail.Add(RailItem("network", "share", page == AppPage.Network, blocked, () -> Navigate(AppPage.Network)))
        rail.Add(Container{FlexGrow: 1})
        rail.Add(NodeBadge())
        rail.Add(
            Container{Width: 32, Height: 1, FlexShrink: 0, Margin: Edges{Top: 4, Bottom: 4}, BackgroundColor: ui.Rule}
        )
        rail.Add(
            RailItem(
                "privacy",
                if ui.Privacy {
                    "visibility_off"
                } else {
                    "visibility"
                },
                page == AppPage.Privacy,
                blocked,
                () -> Navigate(AppPage.Privacy)
            )
        )
        rail.Add(RailItem("settings", "settings", page == AppPage.Settings, blocked, () -> Navigate(AppPage.Settings)))
        rail.Add(RailItem("lock", "lock", false, wallet.LockQueued, () -> Lock()))
        return rail
    }
}
