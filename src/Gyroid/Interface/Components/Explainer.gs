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

partial class WalletView {
    private var help string = ""

    private let helpAnchors Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle]()

    private func Explainer(topic string, summary string, details[]string) Blob {
        if !helpAnchors.ContainsKey(topic) {
            helpAnchors[topic] = ElementHandle()
        }
        let lines = Container{Gap: 8}
        for line in details {
            lines.Add(
                Text{Content: strings.Get(line), FontFamily: font, FontSize: 13, Color: ink, TextWrap: TextWrap.Wrap}
            )
        }
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 4,
            FlexShrink: 0,
            Grow(Label(strings.Get(summary), 13, body, "")),
            Container{
                Handle: helpAnchors[topic],
                IconButton{
                    Icon: MaterialIcons.Create("info", 16, body),
                    AccessibilityName: strings.Get(topic),
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
                    AccessibilityName: strings.Get(topic),
                    OnDismiss: reason -> {
                        help = ""
                        Rebuild()
                    }
                }
            )
        }
    }
}
