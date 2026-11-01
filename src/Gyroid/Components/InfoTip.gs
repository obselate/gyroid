package Gyroid.Components

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.Views

data struct InfoTipInput {
    var Ui Presentation
    var Topic string
    var Lines[]string
    var Language string
    var Width float64
    var Placement PopoverPlacement? = nil
    var TakeFocus bool = true
}

class InfoTip : Cell[InfoTipInput] {
    private let anchor ElementHandle = ElementHandle()

    private var visible bool

    protected override func Build(input InfoTipInput) Blob {
        let ui = input.Ui
        let lines = Container{Gap: AppTheme.Space8}
        for line in input.Lines {
            lines.Add(
                Text{
                    Content: ui.Strings.Get(line),
                    FontFamily: AppTheme.Font,
                    FontSize: AppTheme.Type13,
                    Color: AppTheme.Body,
                    TextWrap: TextWrap.Wrap
                }
            )
        }
        return Container{
            Handle: anchor,
            FlexShrink: 0,
            (
                AppTheme.IconButton with{
                    Icon = MaterialIcons.Create("info", AppTheme.Icon16, visible ? AppTheme.Ink: AppTheme.Body),
                    AccessibilityName = ui.Strings.Get(input.Topic),
                    OnClick = () -> {
                        visible = !visible
                        Rebuild()
                    }
                }
            ).Build(),
            Cell.Mount[PopoverInput, Popover](
                "tip",
                PopoverInput{
                    Open: visible,
                    Anchor: anchor,
                    Placement: input.Placement ?? PopoverPlacement.BottomEnd,
                    TakeFocus: input.TakeFocus,
                    Width: input.Width,
                    Padding: AppTheme.Space14,
                    BackgroundColor: AppTheme.Raised,
                    BorderColor: AppTheme.Edge,
                    CreatePanel: (value, bounds, content) -> Container{BasedOn: AppTheme.InformationCardStyle,},
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
