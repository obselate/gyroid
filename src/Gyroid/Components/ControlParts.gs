package Gyroid.Components

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
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

        func Segment(
            ui Presentation,
            label string,
            ids[]string,
            names[]string,
            selected string,
            disabled bool,
            chosen Action[string],
            enabledCount int32 = Int32.MaxValue,
            key string = ""
        ) Blob {
            let items = [ids.Length]ToggleOption
            for index in 0 ... ids.Length {
                items[index] = ToggleOption{
                    Id: ids[index],
                    Label: ui.Strings.Get(names[index]),
                    Disabled: disabled || index >= enabledCount
                }
            }
            return Cell.Mount[ToggleGroupInput, ToggleGroup](
                key.Length > 0 ? key: "segment-" + label,
                ToggleGroupInput{
                    Items: items,
                    SelectedIds: []string{selected},
                    AccessibilityName: ui.Strings.Get(label),
                    CreateRoot: (_, root) -> {
                        root.BasedOn = AppTheme.SegmentGroupStyle
                        root.FlexShrink = 0
                        return root
                    },
                    CreateItem: (_, item, button) -> {
                        let active = item.Id == selected
                        button.BasedOn = AppTheme.SegmentStyle
                        button.Height = AppTheme.ControlCompact
                        button.MinHeight = AppTheme.ControlCompact
                        button.BackgroundColor = active ? AppTheme.Rule: Color.Transparent
                        button.Hover = Style{BackgroundColor: active ? AppTheme.StrongRule: AppTheme.Rule}
                        button.Focus = Theme.Read().FocusStyle
                        button.BorderWidth = AppTheme.Border0
                        button.BoxShadow = BoxShadow{}
                        button.Opacity = item.Disabled ? 0.4: 1.0
                        button.Children.Clear()
                        button.Add(
                            Label(ui, item.Label ?? item.Id, AppTheme.Type12, active ? AppTheme.Ink: AppTheme.Body, "")
                        )
                        return button
                    },
                    OnChange: values -> {
                        if values.Length > 0 && values[0] != selected {
                            chosen(values[0])
                        }
                    }
                }
            )
        }

        func Icon(
            ui Presentation,
            icon Blob,
            label string,
            action Action,
            disabled bool = false,
            active bool = false,
            size float64 = 38,
            style Style? = nil,
            expanded bool? = nil
        ) Blob -> (
            AppTheme.IconButton with{
                Icon = icon,
                AccessibilityName = label,
                OnClick = action,
                Disabled = disabled,
                Active = active,
                Width = size,
                Height = size,
                DisabledOpacity = 1,
                RootStyle = style ?? AppTheme.IconButtonStyle,
                CreateRoot = (value, content) -> Goo
                    .Button{
                    BasedOn: style ?? AppTheme.IconButtonStyle,
                    Width: size,
                    Height: size,
                    FlexShrink: 0,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Disabled: value.Disabled,
                    OnClick: value.OnClick,
                    Hover: Style{BackgroundColor: active ? AppTheme.StrongRule: AppTheme.Rule},
                    BorderColor: active ? AppTheme.Lime: AppTheme.Edge,
                    Focus: Theme.Read().FocusStyle,
                    Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label, Expanded: expanded},
                    content
                }
            }
        ).Build()

        func Tabs(
            ui Presentation,
            key string,
            label string,
            items[]NavigationItem,
            selected string,
            chosen Action[string],
            equalWidth bool = false
        ) Blob ->
        Cell.Mount[TabBarInput, TabBar](
            key,
            TabBarInput{
                Items: items,
                SelectedId: selected,
                AccessibilityName: ui.Strings.Get(label),
                ItemHeight: AppTheme.ControlCompact,
                CreateRoot: (_, root) -> {
                    root.FlexShrink = 1
                    root.MinWidth = 0
                    return root
                },
                CreateItem: (bar TabBarInput, item NavigationItem, button Button) -> {
                    button.BasedOn = item.Id == bar.SelectedId ? AppTheme.SelectedTabStyle: AppTheme.TabStyle
                    button.Focus = Theme.Read().FocusStyle
                    button.Overflow = Overflow.Hidden
                    if equalWidth {
                        button.FlexGrow = 1
                        button.FlexBasis = 0
                        button.MinWidth = 0
                    }
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
            autoFocus bool = false,
            busy bool? = nil,
            appearance ActionButton? = nil,
            hasPopup bool? = nil,
            expanded bool? = nil
        ) Blob {
            let style = appearance ?? (primary ? AppTheme.PrimaryButton: AppTheme.Button)
            let loading = busy ?? (primary && ui.Working())
            let button = (
                style with{
                    Content = ui.Strings.Get(content),
                    OnClick = action,
                    Loading = loading,
                    Disabled = disabled,
                    DisabledBackgroundColor = loading ? style.BackgroundColor: style.DisabledBackgroundColor,
                    DisabledTextColor = AppTheme.Dim,
                    FontFamily = AppTheme.Font
                }
            ).Build()
            button.AutoFocus = autoFocus
            if hasPopup.HasValue || expanded.HasValue {
                let semantics = button.Accessibility ?? Accessibility{}
                button.Accessibility = Accessibility{
                    Role: semantics.Role,
                    Name: semantics.Name,
                    Busy: semantics.Busy,
                    Checked: semantics.Checked,
                    HasPopup: hasPopup ?? semantics.HasPopup,
                    Expanded: expanded ?? semantics.Expanded
                }
            }
            return button
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

        func Ring(share float64, color Color, trackColor Color, size float64 = 18, thickness float64 = 2) Blob {
            let track = PathBuilder(0, 0, size, size)
            let arc = PathBuilder(0, 0, size, size)
            let middle = size / 2
            let radius = middle - thickness
            for step in 0 ... 33 {
                let turn = step / 32.0 * Math.PI * 2
                let sweep = turn * Math.Clamp(share, 0.0, 1.0) - Math.PI / 2
                if step == 0 {
                    track.MoveTo(middle + radius, middle)
                    arc.MoveTo(middle + radius * Math.Cos(sweep), middle + radius * Math.Sin(sweep))
                } else {
                    track.LineTo(middle + radius * Math.Cos(turn), middle + radius * Math.Sin(turn))
                    arc.LineTo(middle + radius * Math.Cos(sweep), middle + radius * Math.Sin(sweep))
                }
            }
            return Container{
                Width: size,
                Height: size,
                FlexShrink: 0,
                Shape{
                    Position: PositionType.Absolute,
                    Width: size,
                    Height: size,
                    Path: track.Build(),
                    Fit: ShapeFit.Fill,
                    BorderWidth: thickness,
                    BorderColor: trackColor
                },
                Shape{
                    Position: PositionType.Absolute,
                    Width: size,
                    Height: size,
                    Path: arc.Build(),
                    Fit: ShapeFit.Fill,
                    BorderWidth: thickness,
                    BorderColor: share > 0 ? color: Color.Transparent
                }
            }
        }

        func Progress(
            name string,
            share float64,
            color Color,
            width float64,
            height float64 = 8,
            track Color? = nil,
            widthLength Length? = nil,
            heightLength Length? = nil
        ) Blob {
            var control = ProgressBar{
                AccessibilityName: name,
                Value: share,
                Width: width,
                Height: height,
                BorderRadius: AppTheme.Radius2,
                FillColor: color,
                TrackColor: track ?? AppTheme.Rule
            }
            if let length = heightLength {
                control = control with{
                    CreateFill = bar -> Container{
                        Width: Percent(bar.Value * 100),
                        Height: length,
                        BorderRadius: bar.BorderRadius ?? AppTheme.Radius2,
                        BackgroundColor: bar.FillColor ?? color,
                        TransitionMs: bar.TransitionMs ?? 0,
                        TransitionEasing: bar.TransitionEasing ?? Easing.EaseOut
                    }
                }
            }
            let progress = control.Build()
            if let length = widthLength {
                progress.Width = length
            }
            if let length = heightLength {
                progress.Height = length
            }
            return progress
        }

        func Navigation(ui Presentation, key string, input NavigationRailInput) Blob ->
        Cell.Mount[NavigationRailInput, NavigationRail](
            key,
            input with{
                FontFamily = AppTheme.Font,
                FontSize = AppTheme.Type13,
                ItemBorderRadius = AppTheme.Radius8,
                ItemGap = AppTheme.Space10,
                ItemPaddingHorizontal = AppTheme.Space12,
                ItemBackgroundColor = Color.Transparent,
                BackgroundColor = Color.Transparent,
                TextColor = AppTheme.Body,
                SelectedTextColor = AppTheme.Ink,
                SelectedBackgroundColor = AppTheme.Rule,
                HoverBackgroundColor = AppTheme.Rule
            }
        )
    }
}
