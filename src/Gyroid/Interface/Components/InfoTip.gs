package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Layout

data struct InfoTipInput {
    var Ui Presentation
    var Topic string
    var Lines[]string
    var Language string
    var Width float64
}

class InfoTip : Cell[InfoTipInput] {
    private let anchor ElementHandle = ElementHandle()

    private var visible bool

    protected override func Build(input InfoTipInput) Blob {
        let ui = input.Ui
        let lines = Container{Gap: 8}
        for line in input.Lines {
            lines.Add(
                Text{
                    Content: ui.Strings.Get(line),
                    FontFamily: ui.Font,
                    FontSize: 12.5,
                    Color: ui.Body,
                    TextWrap: TextWrap.Wrap
                }
            )
        }
        return Container{
            Handle: anchor,
            FlexShrink: 0,
            IconButton{
                Icon: MaterialIcons.Create("info", 16, visible ? ui.Ink: ui.Body),
                AccessibilityName: ui.Strings.Get(input.Topic),
                OnClick: () -> {
                    visible = !visible
                    Rebuild()
                }
            }.Build(),
            Cell.Mount[PopoverInput, Popover](
                "tip",
                PopoverInput{
                    Open: visible,
                    Anchor: anchor,
                    Placement: PopoverPlacement.BottomEnd,
                    Width: input.Width,
                    Padding: 14,
                    Content: lines,
                    AccessibilityName: ui.Strings.Get(input.Topic),
                    OnDismiss: reason -> {
                        visible = false
                        Rebuild()
                    }
                }
            )
        }
    }
}
