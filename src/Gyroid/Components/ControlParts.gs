package Gyroid.Components

import Goo
import Goo.Widgets
import Goo.Widgets.Feedback
import Goo.Widgets.Inputs
import Goo.Widgets.Navigation
import Gyroid.Components.TextParts
import Gyroid.Views
import System

class ControlParts {
    shared {
        func FieldBox(ui Presentation, content Blob, padding Edges, border Color? = nil) Container -> Container{
            Padding: padding,
            BorderRadius: 8,
            BorderWidth: 1,
            BorderColor: border ?? ui.FieldEdge,
            BackgroundColor: ui.Field,
            content
        }

        func ChoiceGroup(ui Presentation, accessibility Accessibility, background Color? = nil) Container -> Container{
            FlexDirection: FlexDirection.Row,
            Padding: 3,
            BorderRadius: 10,
            BackgroundColor: background ?? ui.Black,
            BorderWidth: 1,
            BorderColor: ui.Rule,
            Accessibility: accessibility
        }

        func Choice(
            ui Presentation,
            content string,
            selected bool,
            action Action,
            accessibility Accessibility,
            padding Edges,
            size float64 = 14,
            disabled bool = false
        ) Goo
            .Button {
            let button = Goo
                .Button{
                Padding: padding,
                BorderRadius: 7,
                BackgroundColor: selected ? ui.Selected: Color.Transparent,
                Hover: Style{BackgroundColor: ui.Rule},
                Focus: Theme.Read().FocusStyle,
                Disabled: disabled,
                Accessibility: accessibility,
                OnClick: action,
                Label(ui, content, size, selected ? ui.Ink: ui.Body, "")
            }
            WidgetKeyBindings.BindActivation(button)
            return button
        }

        func Segment(
            ui Presentation,
            label string,
            ids[]string,
            names[]string,
            selected string,
            disabled bool,
            chosen Action[string],
            enabledCount int32 = Int32.MaxValue
        ) Blob {
            let group = ChoiceGroup(ui, Accessibility{Role: AccessibilityRole.Group, Name: ui.Strings.Get(label)})
            group.FlexShrink = 0
            for index in 0 ... ids.Length {
                let id = ids[index]
                let on = id == selected
                let button = Choice(
                    ui,
                    ui.Strings.Get(names[index]),
                    on,
                    () -> {
                        if !on {
                            chosen(id)
                        }
                    },
                    Accessibility{
                        Role: AccessibilityRole.Radio,
                        Name: ui.Strings.Get(names[index]),
                        Checked: on ? AccessibilityChecked.True: AccessibilityChecked.False
                    },
                    Edges{Left: 12, Right: 12},
                    disabled: disabled || index >= enabledCount
                )
                button.Height = 28
                button.AlignItems = AlignItems.Center
                button.JustifyContent = JustifyContent.Center
                button.Opacity = index >= enabledCount ? 0.4: 1.0
                group.Add(button)
            }
            return group
        }

        func ExpandButton(ui Presentation, icon Blob, label string, active bool, disabled bool, action Action) Blob {
            let button = Goo
                .Button{
                Width: 30,
                Height: 30,
                Margin: Edges{Top: 4},
                FlexShrink: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                BorderRadius: 8,
                BackgroundColor: active ? ui.Rule: Color.Transparent,
                Disabled: disabled,
                Hover: Style{BackgroundColor: ui.Rule},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.Button,
                    Name: ui.Strings.Get(label),
                    Expanded: active
                },
                OnClick: action,
                icon
            }
            WidgetKeyBindings.BindActivation(button)
            return button
        }

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
                BackgroundColor = ui.Field,
                BorderColor = ui.FieldEdge,
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
            let ring = Ring(share, color, Color.Parse("#1f1f1f"))
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
            meter.Add(ring)
            return meter
        }

        func Ring(share float64, color Color, trackColor Color) Blob {
            let track = PathBuilder(0, 0, 18, 18)
            let arc = PathBuilder(0, 0, 18, 18)
            for step in 0 ... 33 {
                let turn = step / 32.0 * Math.PI * 2
                let sweep = turn * Math.Clamp(share, 0.0, 1.0) - Math.PI / 2
                if step == 0 {
                    track.MoveTo(16, 9)
                    arc.MoveTo(9 + 7 * Math.Cos(sweep), 9 + 7 * Math.Sin(sweep))
                } else {
                    track.LineTo(9 + 7 * Math.Cos(turn), 9 + 7 * Math.Sin(turn))
                    arc.LineTo(9 + 7 * Math.Cos(sweep), 9 + 7 * Math.Sin(sweep))
                }
            }
            return Container{
                Width: 18,
                Height: 18,
                FlexShrink: 0,
                Shape{
                    Position: PositionType.Absolute,
                    Width: 18,
                    Height: 18,
                    Path: track.Build(),
                    Fit: ShapeFit.Fill,
                    BorderWidth: 2,
                    BorderColor: trackColor
                },
                Shape{
                    Position: PositionType.Absolute,
                    Width: 18,
                    Height: 18,
                    Path: arc.Build(),
                    Fit: ShapeFit.Fill,
                    BorderWidth: 2,
                    BorderColor: share > 0 ? color: Color.Transparent
                }
            }
        }
    }
}
