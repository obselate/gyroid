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
            BasedOn: AppTheme.FieldStyle,
            Padding: padding,
            BorderColor: border ?? AppTheme.Edge,
            BackgroundColor: AppTheme.Raised,
            content
        }

        func ChoiceGroup(ui Presentation, accessibility Accessibility, background Color? = nil) Container -> Container{
            BasedOn: AppTheme.SegmentGroupStyle,
            BackgroundColor: background ?? AppTheme.Black,
            BorderWidth: AppTheme.Border1,
            BorderColor: AppTheme.Rule,
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
                BasedOn: AppTheme.SegmentStyle,
                Padding: padding,
                BackgroundColor: selected ? AppTheme.Rule: Color.Transparent,
                Hover: Style{BackgroundColor: selected ? AppTheme.StrongRule: AppTheme.Rule},
                Focus: Theme.Read().FocusStyle,
                Disabled: disabled,
                Accessibility: accessibility,
                OnClick: action,
                Label(ui, content, size, selected ? AppTheme.Ink: AppTheme.Body, "")
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
                    Edges{Left: AppTheme.Space12, Right: AppTheme.Space12},
                    size: AppTheme.Type12,
                    disabled: disabled || index >= enabledCount
                )
                button.Height = AppTheme.ControlCompact
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
                BasedOn: AppTheme.DisclosureStyle,
                Margin: Edges{Top: AppTheme.Space4},
                FlexShrink: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                BorderRadius: AppTheme.Radius8,
                BackgroundColor: active ? AppTheme.Rule: Color.Transparent,
                Disabled: disabled,
                Hover: Style{BackgroundColor: active ? AppTheme.StrongRule: AppTheme.Rule},
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
                ItemHeight: AppTheme.ControlCompact,
                CreateItem: (bar TabBarInput, item NavigationItem, button Button) -> {
                    button.BasedOn = item.Id == bar.SelectedId ? AppTheme.SelectedTabStyle: AppTheme.TabStyle
                    button.Focus = Theme.Read().FocusStyle
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
            let style = if primary {
                AppTheme.PrimaryButton
            } else {
                AppTheme.Button
            }
            let busy = primary && ui.Working()
            let button = (
                style with{
                    Content = ui.Strings.Get(content),
                    OnClick = action,
                    Disabled = disabled || busy,
                    DisabledBackgroundColor = busy ? style.BackgroundColor: style.DisabledBackgroundColor,
                    DisabledTextColor = busy ? Color.Transparent: AppTheme.Dim,
                    FontFamily = AppTheme.Font
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
                            SpinnerInput{Size: 20, StrokeWidth: AppTheme.Stroke3, Color: style.TextColor}
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
                EntryHeight = AppTheme.FieldInput.EntryHeight,
                BorderRadius = AppTheme.FieldInput.BorderRadius,
                BorderWidth = AppTheme.FieldInput.BorderWidth,
                BackgroundColor = AppTheme.FieldInput.BackgroundColor,
                BorderColor = AppTheme.FieldInput.BorderColor,
                FontFamily = AppTheme.FieldInput.FontFamily,
                FontSize = AppTheme.FieldInput.FontSize,
                TextColor = AppTheme.FieldInput.TextColor,
                InvalidColor = AppTheme.FieldInput.InvalidColor,
                DisabledTextColor = AppTheme.FieldInput.DisabledTextColor
            }
        ).Build()

        func Meter(ui Presentation, used int32, limit int32, counted bool) Blob {
            let share = Math.Min(float64(used) / limit, 1.0)
            let color = if share >= 1 {
                AppTheme.Pink
            } else if share >= 0.75 {
                AppTheme.Orange
            } else {
                AppTheme.Dim
            }
            let ring = Ring(share, color, AppTheme.Rule)
            let meter = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space6,
                FlexShrink: 0,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.ProgressBar,
                    Name: ui.Strings.Get("Memo bytes") + " " + used.ToString() + "/" + limit.ToString()
                }
            }
            if counted && share >= 0.75 {
                meter.Add(Label(ui, (limit - used).ToString(), AppTheme.Type12, color, ""))
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
                    BorderWidth: AppTheme.Border2,
                    BorderColor: trackColor
                },
                Shape{
                    Position: PositionType.Absolute,
                    Width: 18,
                    Height: 18,
                    Path: arc.Build(),
                    Fit: ShapeFit.Fill,
                    BorderWidth: AppTheme.Border2,
                    BorderColor: share > 0 ? color: Color.Transparent
                }
            }
        }
    }
}
