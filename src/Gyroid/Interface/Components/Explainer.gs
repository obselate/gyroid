package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Contacts
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Threading.Tasks

partial class App {
    private var help string = ""

    private let helpAnchors Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle]()

    private func Explainer(topic string, summary string, details[]string) Blob {
        if !helpAnchors.ContainsKey(topic) {
            helpAnchors[topic] = ElementHandle()
        }
        let lines = Container{Gap: 8}
        for line in details {
            lines.Add(
                Text{
                    Content: ui.Strings.Get(line),
                    FontFamily: ui.Font,
                    FontSize: 13,
                    Color: ui.Ink,
                    TextWrap: TextWrap.Wrap
                }
            )
        }
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 4,
            FlexShrink: 0,
            ui.Grow(ui.Label(ui.Strings.Get(summary), 13, ui.Body, "")),
            Container{
                Handle: helpAnchors[topic],
                IconButton{
                    Icon: MaterialIcons.Create("info", 16, ui.Body),
                    AccessibilityName: ui.Strings.Get(topic),
                    OnClick: () -> {
                        help = topic
                        Rebuild()
                    }
                }.Build()
            },
            Cell.Mount[PopoverInput, Popover](
                topic,
                PopoverInput{
                    Open: help == topic,
                    Anchor: helpAnchors[topic],
                    Placement: PopoverPlacement.BottomEnd,
                    Width: 400,
                    Padding: 16,
                    Content: lines,
                    AccessibilityName: ui.Strings.Get(topic),
                    OnDismiss: reason -> {
                        help = ""
                        Rebuild()
                    }
                }
            )
        }
    }
}
