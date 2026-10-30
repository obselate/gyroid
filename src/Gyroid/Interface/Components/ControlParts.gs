package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Feedback
import Goo.Widgets.Inputs
import Goo.Widgets.Navigation
import Gyroid.Interface.TextParts
import System

class ControlParts {
    shared {
        func Tabs(
            ui Presentation,
            key string,
            label string,
            items[]NavigationItem,
            selected string,
            chosen Action[string]
        ) Blob ->
        Cell.Mount[TabBarInput, TabBar](
            key,
            TabBarInput{
                Items: items,
                SelectedId: selected,
                AccessibilityName: ui.Strings.Get(label),
                CreateItem: (bar TabBarInput, item NavigationItem, button Button) -> {
                    button.BorderRadius = 4
                    button.Overflow = Overflow.Hidden
                    return button
                },
                OnSelect: chosen
            }
        )

        func Button(
            ui Presentation,
            content string,
            action Action,
            disabled bool = false,
            primary bool = false,
            autoFocus bool = false
        ) Blob {
            let theme = Theme.Read()
            let style = if primary {
                theme.PrimaryButton
            } else {
                theme.Button
            }
            let busy = primary && ui.Working()
            let button = (
                style with{
                    Content = ui.Strings.Get(content),
                    OnClick = action,
                    Disabled = disabled || busy,
                    DisabledBackgroundColor = busy ? style.BackgroundColor: style.DisabledBackgroundColor,
                    DisabledTextColor = busy ? Color.Transparent: ui.Dim,
                    FontFamily = ui.Font
                }
            ).Build()
            button.AutoFocus = autoFocus
            return Container{
                Position: PositionType.Relative,
                button,
                if busy && ui.Actions.playbackActive() {
                    Container{
                        Position: PositionType.Absolute,
                        Left: 0,
                        Right: 0,
                        Top: 0,
                        Bottom: 0,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.Center,
                        Cell.Mount[SpinnerInput, Spinner](
                            "busy",
                            SpinnerInput{Size: 20, StrokeWidth: 3, Color: style.TextColor}
                        )
                    }
                } else {
                    Container{}
                }
            }
        }

        func Entry(ui Presentation, field TextField) Blob -> (
            field with{
                Width = Percent(100),
                EntryHeight = 38,
                BorderRadius = 8,
                BackgroundColor = Color.Parse("#080808"),
                BorderColor = Color.Parse("#2a2a2a"),
                FontFamily = ui.Font
            }
        ).Build()

        func Meter(ui Presentation, used int32, limit int32, counted bool) Blob {
            let share = Math.Min(float64(used) / limit, 1.0)
            let color = if share >= 1 {
                ui.Pink
            } else if share >= 0.75 {
                ui.Orange
            } else {
                ui.Dim
            }
            let track = PathBuilder(0, 0, 18, 18)
            let arc = PathBuilder(0, 0, 18, 18)
            for step in 0 ... 33 {
                let turn = step / 32.0 * Math.PI * 2
                let sweep = turn * share - Math.PI / 2
                if step == 0 {
                    track.MoveTo(16, 9)
                    arc.MoveTo(9 + 7 * Math.Cos(sweep), 9 + 7 * Math.Sin(sweep))
                } else {
                    track.LineTo(9 + 7 * Math.Cos(turn), 9 + 7 * Math.Sin(turn))
                    arc.LineTo(9 + 7 * Math.Cos(sweep), 9 + 7 * Math.Sin(sweep))
                }
            }
            let meter = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 6,
                FlexShrink: 0,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.ProgressBar,
                    Name: ui.Strings.Get("Memo bytes") + " " + used.ToString() + "/" + limit.ToString()
                }
            }
            if counted && share >= 0.75 {
                meter.Add(Label(ui, (limit - used).ToString(), 11.5, color, ""))
            }
            meter.Add(
                Container{
                    Width: 18,
                    Height: 18,
                    Shape{
                        Position: PositionType.Absolute,
                        Width: 18,
                        Height: 18,
                        Path: track.Build(),
                        Fit: ShapeFit.Fill,
                        BorderWidth: 2,
                        BorderColor: Color.Parse("#1f1f1f")
                    },
                    Shape{
                        Position: PositionType.Absolute,
                        Width: 18,
                        Height: 18,
                        Path: arc.Build(),
                        Fit: ShapeFit.Fill,
                        BorderWidth: 2,
                        BorderColor: used > 0 ? color: Color.Transparent
                    }
                }
            )
            return meter
        }
    }
}
