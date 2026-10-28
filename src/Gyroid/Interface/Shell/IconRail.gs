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
    private func SideItem(
        label string,
        selected bool,
        disabled bool,
        action Action,
        icon string = "",
        checked AccessibilityChecked = AccessibilityChecked.Unspecified
    ) Blob -> Goo
        .Button{
        Height: 40,
        FlexShrink: 0,
        Padding: Edges{Left: 9, Right: 8},
        BorderWidth: Edges{Left: 3, Top: 1, Right: 1, Bottom: 1},
        BorderRadius: 4,
        BorderColor: if selected {
            ui.Rule
        } else {
            Color.Transparent
        },
        BorderStartColor: if selected {
            ui.Lime
        } else {
            Color.Transparent
        },
        BackgroundColor: if selected {
            Color.Parse("#0b1203")
        } else {
            Color.Transparent
        },
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        JustifyContent: JustifyContent.FlexStart,
        Gap: if icon.Length > 0 {
            10.0
        } else {
            0.0
        },
        Disabled: disabled,
        Hover: Style{BackgroundColor: ui.Rule},
        Focus: Theme.Read().FocusStyle,
        Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get(label), Checked: checked},
        OnClick: action,
        if icon.Length > 0 {
            Container{FlexShrink: 0, MaterialIcons.Create(icon, 16, ui.Dim)}
        } else {
            Container{}
        },
        ui.Label(
            ui.Strings.Get(label),
            14,
            if disabled {
                ui.Dim
            } else if selected {
                ui.Lime
            } else if icon.Length > 0 {
                ui.Body
            } else {
                ui.Ink
            },
            ""
        )
    }

    private func Sidebar(page string) Blob {
        let blocked = ui.Working()
        let island = ui.Glass()
        island.Width = 176
        island.FlexShrink = 0
        island.Margin = Edges{Top: 24, Left: 24, Bottom: 24}
        island.Padding = 8
        island.Add(
            Container{
                FlexGrow: 1,
                Gap: 4,
                SideItem("overview", page == "Overview", blocked, () -> Navigate("Overview")),
                if wallet.Snapshot.ViewOnly {
                    Container{}
                } else {
                    SideItem("send", page == "Send", blocked, () -> Navigate("Send"))
                },
                SideItem("receive", page == "Receive", blocked, () -> Navigate("Receive")),
                SideItem("history", page == "Transactions", blocked, () -> Navigate("Transactions")),
                SideItem("tools", page == "Tools", blocked, () -> Navigate("Tools")),
                SideItem("contacts", page == "Contacts", blocked, () -> Navigate("Contacts")),
                Container{FlexGrow: 1},
                if let indicator = SyncIndicator(16, 12) {
                    Container{Padding: Edges{Left: 10}, FlexShrink: 0, indicator}
                } else {
                    Container{}
                },
                Container{Height: 1, FlexShrink: 0, Margin: Edges{Top: 8, Bottom: 8}, BackgroundColor: ui.Rule},
                SideItem(
                    "privacy",
                    ui.Privacy,
                    false,
                    () -> TogglePrivacy(),
                    if ui.Privacy {
                        "visibility_off"
                    } else {
                        "visibility"
                    },
                    if ui.Privacy {
                        AccessibilityChecked.True
                    } else {
                        AccessibilityChecked.False
                    }
                ),
                SideItem("settings", page == "Settings", blocked, () -> Navigate("Settings"), "settings"),
                SideItem("lock", false, wallet.LockQueued, () -> Lock(), "lock")
            }
        )
        return island
    }
}
