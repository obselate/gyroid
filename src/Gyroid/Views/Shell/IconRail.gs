package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Components
import Gyroid.Components.TextParts
import System
import System.Linq

partial class App {
    private func RailItem(input NavigationRailInput, item NavigationItem) Goo.Button {
        let selected = item.Id == input.SelectedId
        let color = item.Disabled ? AppTheme.Dim: selected ? AppTheme.Lime: AppTheme.Body
        let button = Goo
            .Button{
            Width: 60,
            Height: input.ItemHeight,
            FlexShrink: 1,
            FlexDirection: FlexDirection.Column,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Gap: AppTheme.Space4,
            BorderRadius: AppTheme.Radius10,
            BackgroundColor: selected ? AppTheme.LimeQuiet: Color.Transparent,
            Hover: Style{BackgroundColor: AppTheme.Rule},
            Focus: Theme.Read().FocusStyle
        }
        if let icon = item.Content {
            button.Add(icon)
        }
        button.Add(Label(ui, item.Label ?? "", AppTheme.Type11, color, ""))
        return button
    }

    private func Sidebar(page AppPage) Blob {
        let blocked = ui.Working()
        let compact = height < 700
        let unread = wallet.Messages.Conversations.Sum(item -> item.Unread)
        let entries = [](AppPage, string, string){
            (AppPage.Overview, "overview", "grid_view"),
            (AppPage.Send, "send", "north_east"),
            (AppPage.Receive, "receive", "south_west"),
            (AppPage.Transactions, "history", "schedule"),
            (AppPage.Messages, "messages", "chat_bubble"),
            (AppPage.Tools, "tools", "tune"),
            (AppPage.Contacts, "contacts", "person"),
            (AppPage.Mining, "mining", "hardware"),
            (AppPage.Network, "network", "share"),
            (AppPage.Privacy, "privacy", ui.Privacy ? "visibility_off": "visibility"),
            (AppPage.Settings, "settings", "settings")
        }
        let items = [wallet.Snapshot.ViewOnly ? 11: 12]NavigationItem
        var index = 0
        for (destination, label, icon) in entries {
            if destination == AppPage.Send && wallet.Snapshot.ViewOnly {
                continue
            }
            let name = ui.Strings.Get(label)
            let count = destination == AppPage.Messages && unread > 0 ? unread.ToString(): ""
            let color = blocked ? AppTheme.Dim: page == destination ? AppTheme.Lime: AppTheme.Body
            var content Blob = MaterialIcons.Create(icon, AppTheme.Icon20, color)
            if count.Length > 0 {
                content = Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space4,
                    content,
                    Label(ui, count, AppTheme.Type11, color, "")
                }
            }
            items[index] = NavigationItem{
                Id: destination.ToString(),
                Label: name,
                AccessibilityName: name + (count.Length > 0 ? " " + count: ""),
                Content: content,
                Disabled: blocked
            }
            index++
        }
        items[index] = NavigationItem{
            Id: "lock",
            Label: ui.Strings.Get("lock"),
            Content: MaterialIcons.Create("lock", AppTheme.Icon20, wallet.LockQueued ? AppTheme.Dim: AppTheme.Body),
            Disabled: wallet.LockQueued
        }
        return ControlParts.Navigation(
            ui,
            "sidebar",
            NavigationRailInput{
                Items: items,
                SelectedId: page.ToString(),
                AccessibilityName: ui.Strings.Get("Navigation"),
                ActiveMarker: false,
                ItemHeight: compact ? 44: 48,
                CreateItem: RailItem,
                OnSelect: id -> {
                    if id == "lock" {
                        Lock()
                    } else {
                        Navigate(Enum.Parse[AppPage](id))
                    }
                },
                CreateRoot: (input NavigationRailInput, buttons[]Goo.Button) -> {
                    let inset = compact ? AppTheme.Space4: AppTheme.Space8
                    let rail = WalletParts.Card(
                        ui,
                        Edges{Top: inset, Bottom: inset},
                        compact ? AppTheme.Space0: AppTheme.Space2,
                        AppTheme.Radius14
                    )
                    rail.Width = 72
                    rail.FlexShrink = 0
                    rail.AlignItems = AlignItems.Center
                    rail.Accessibility = Accessibility{
                        Role: AccessibilityRole.TabList,
                        Name: input.AccessibilityName ?? "",
                        Orientation: AccessibilityOrientation.Vertical
                    }
                    for i in 0 ... buttons.Length {
                        if i == buttons.Length - 3 {
                            rail.Add(Container{FlexGrow: 1})
                            rail.Add(NodeBadge())
                            rail.Add(
                                Container{
                                    Width: 32,
                                    Height: 1,
                                    FlexShrink: 0,
                                    Margin: Edges{Top: AppTheme.Space4, Bottom: AppTheme.Space4},
                                    BackgroundColor: AppTheme.Rule
                                }
                            )
                        }
                        rail.Add(buttons[i])
                    }
                    return rail
                }
            }
        )
    }
}
