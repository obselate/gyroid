package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Linq
import System.Numerics
import System.Text
import System.Threading.Tasks

partial class App {
    private func RailItem(
        label string,
        icon string,
        selected bool,
        disabled bool,
        action Action,
        checked AccessibilityChecked = AccessibilityChecked.Unspecified
    ) Blob {
        let color = if disabled {
            ui.Dim
        } else if selected {
            ui.Lime
        } else {
            ui.Body
        }
        return Goo
            .Button{
            Width: 60,
            Height: height < 700 ? 44.0: 48.0,
            FlexShrink: 0,
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
                Selected: selected,
                Checked: checked
            },
            OnClick: action,
            MaterialIcons.Create(icon, 20, color),
            ui.Label(ui.Strings.Get(label), 11, color, "")
        }
    }

    private func Sidebar(page string) Blob {
        let blocked = ui.Working()
        let compact = height < 700
        let inset = compact ? 4.0: 8.0
        let rail = ui.Glass()
        rail.Width = 72
        rail.FlexShrink = 0
        rail.BorderRadius = 14
        rail.AlignItems = AlignItems.Center
        rail.Padding = Edges{Top: inset, Bottom: inset}
        rail.Gap = compact ? 0.0: 2.0
        rail.Add(RailItem("overview", "grid_view", page == "Overview", blocked, () -> Navigate("Overview")))
        if !wallet.Snapshot.ViewOnly {
            rail.Add(RailItem("send", "north_east", page == "Send", blocked, () -> Navigate("Send")))
        }
        rail.Add(RailItem("receive", "south_west", page == "Receive", blocked, () -> Navigate("Receive")))
        rail.Add(RailItem("history", "schedule", page == "Transactions", blocked, () -> Navigate("Transactions")))
        rail.Add(RailItem("tools", "tune", page == "Tools", blocked, () -> Navigate("Tools")))
        rail.Add(RailItem("contacts", "person", page == "Contacts", blocked, () -> Navigate("Contacts")))
        rail.Add(RailItem("mining", "hardware", page == "Mining", blocked, () -> Navigate("Mining")))
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
                false,
                false,
                () -> TogglePrivacy(),
                if ui.Privacy {
                    AccessibilityChecked.True
                } else {
                    AccessibilityChecked.False
                }
            )
        )
        rail.Add(RailItem("settings", "settings", page == "Settings", blocked, () -> Navigate("Settings")))
        rail.Add(RailItem("lock", "lock", false, wallet.LockQueued, () -> Lock()))
        return rail
    }
}
