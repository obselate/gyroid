package Gyroid.Views

import Goo
import Gyroid.Components
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts

partial class App {
    private func Explainer(topic string, summary string, details[]string) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 4,
        FlexShrink: 0,
        Grow(Label(ui, ui.Strings.Get(summary), 13, ui.Body, "")),
        Cell.Mount[InfoTipInput, InfoTip](
            topic,
            InfoTipInput{Ui: ui, Topic: topic, Lines: details, Language: ui.Strings.Language, Width: 400}
        )
    }
}
