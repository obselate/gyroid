package Gyroid.Components

import Goo
import Goo.Widgets.Feedback
import Gyroid.Views

class ListParts {
    shared {
        func Viewport(content Blob, style Style? = nil, grow bool = true) Container -> Container{
            BasedOn: style,
            FlexGrow: grow ? 1: 0,
            FlexBasis: grow ? 0: Length.Auto,
            MinWidth: 0,
            MinHeight: 0,
            Overflow: Overflow.Hidden,
            content
        }

        func Empty(ui Presentation, value string, action Blob? = nil) Blob -> EmptyState{
            Title: ui.Strings.Get(value),
            AccessibilityName: ui.Strings.Get(value),
            MinHeight: AppTheme.Space0,
            PaddingHorizontal: AppTheme.Space0,
            PaddingVertical: AppTheme.Space12,
            Gap: AppTheme.Space8,
            TitleFontSize: AppTheme.Type13,
            TitleFontWeight: AppTheme.WeightNormal,
            TitleColor: AppTheme.Dim,
            FontFamily: AppTheme.Font,
            CreateTitle: value -> TextParts.Label(ui, value.Title ?? "", AppTheme.Type13, AppTheme.Dim, ""),
            Action: action
        }.Build()
    }
}
