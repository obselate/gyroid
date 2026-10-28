package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Layout

partial class App {
    private func Explainer(topic string, summary string, details[]string) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 4,
        FlexShrink: 0,
        ui.Grow(ui.Label(ui.Strings.Get(summary), 13, ui.Body, "")),
        Cell.Mount[InfoTipInput, InfoTip](
            topic,
            InfoTipInput{Ui: ui, Topic: topic, Lines: details, Language: ui.Strings.Language, Width: 400}
        )
    }
}
