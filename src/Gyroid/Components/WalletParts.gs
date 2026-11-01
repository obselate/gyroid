package Gyroid.Components

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Views
import System

class WalletParts {
    shared {
        func Rows(ui Presentation, rows[]Container) Container {
            let list = Card(
                ui,
                Edges{Top: AppTheme.Space4, Bottom: AppTheme.Space4, Left: AppTheme.Space16, Right: AppTheme.Space16},
                AppTheme.Space0,
                AppTheme.Radius14
            )
            list.FlexShrink = 1
            list.OverflowY = Overflow.Scroll
            for index in 0 ... rows.Length {
                if index < rows.Length - 1 {
                    rows[index].BorderWidth = Edges{Bottom: AppTheme.Border1}
                }
                list.Add(rows[index])
            }
            return list
        }

        func Card(ui Presentation, padding Edges? = nil, gap float64 = 16, radius float64 = 6) Container -> Container{
            BasedOn: AppTheme.CardStyle,
            BorderRadius: radius,
            Padding: padding ?? Edges(AppTheme.Space20),
            Gap: gap,
            MinWidth: 0,
            MinHeight: 0
        }

        func PageCard(
            ui Presentation,
            width float64,
            height float64,
            maxWidth float64 = 900,
            fill bool = false
        ) Container {
            let card = Card(ui, AppTheme.GetPagePadding(width, height), AppTheme.GetPageGap(height), AppTheme.Radius14)
            card.Width = fill ? Percent(100): maxWidth
            card.MaxWidth = fill ? maxWidth: Percent(100)
            card.MaxHeight = Percent(100)
            return card
        }

        func Header(
            label Blob,
            gap float64 = 8,
            trailing Blob? = nil,
            value Blob? = nil,
            leading Blob? = nil,
            alignment AlignItems = AlignItems.Center
        ) Container {
            let header = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: alignment,
                Gap: gap,
                FlexShrink: 0,
                MinWidth: 0
            }
            if let part = leading {
                header.Add(part)
            }
            header.Add(label)
            if let figure = value {
                header.Add(figure)
            }
            if let part = trailing {
                header.Add(Container{FlexGrow: 1})
                header.Add(part)
            }
            return header
        }

        func Line(ui Presentation, height float64, label string, parts[]Blob) Container {
            let row = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space10,
                Height: height,
                FlexShrink: 0,
                BorderColor: AppTheme.FaintRule,
                Grow(Label(ui, ui.Strings.Get(label), AppTheme.Type14, AppTheme.Body, ""))
            }
            for part in parts {
                row.Add(part)
            }
            return row
        }

        func Square(
            ui Presentation,
            icon string,
            label string,
            active bool,
            disabled bool,
            click Action,
            size float64 = 38,
            disabledColor Color? = nil,
            radius float64 = 8,
            iconSize float64 = 16,
            iconColor Color? = nil,
            shrink float64 = 0
        ) Blob {
            let button = Goo
                .Button{
                BasedOn: AppTheme.IconButtonStyle,
                Width: size,
                Height: size,
                FlexShrink: shrink,
                BorderRadius: radius,
                BorderColor: active ? AppTheme.Lime: AppTheme.Edge,
                BackgroundColor: AppTheme.Raised,
                Disabled: disabled,
                Hover: Style{BackgroundColor: AppTheme.Rule},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label},
                OnClick: click,
                MaterialIcons.Create(
                    icon,
                    iconSize,
                    iconColor ?? (active ? AppTheme.Lime: disabled ? disabledColor ?? AppTheme.Dim: AppTheme.Body)
                )
            }
            WidgetKeyBindings.BindActivation(button)
            return button
        }

        func Modal(ui Presentation, key string, dialog ModalDialog) Blob -> Cell.Mount[ModalDialog, ModalDialogHost](
            key,
            dialog with{
                BackgroundColor = dialog.BackgroundColor ?? AppTheme.Dialog.BackgroundColor,
                BorderColor = dialog.BorderColor ?? AppTheme.Dialog.BorderColor,
                BorderWidth = dialog.BorderWidth ?? AppTheme.Dialog.BorderWidth,
                BorderRadius = dialog.BorderRadius ?? AppTheme.Dialog.BorderRadius,
                Padding = dialog.Padding ?? AppTheme.Dialog.Padding,
                Gap = dialog.Gap ?? AppTheme.Dialog.Gap,
                CreateRoot = (dialog, backdrop, panel) -> DialogRoot(ui)
            }
        )

        func Modal(
            ui Presentation,
            window Window?,
            availableWidth float64,
            key string,
            name string,
            width float64,
            header Blob,
            content Blob,
            footer Blob,
            close Action
        ) Blob -> Modal(
            ui,
            key,
            AppTheme.Dialog with{
                Open = true,
                AccessibilityName = ui.Strings.Get(name),
                Width = Math.Min(availableWidth - 40, width),
                MaxHeight = Percent(100),
                Padding = AppTheme.Space22,
                Gap = AppTheme.Space14,
                BackgroundColor = AppTheme.Raised,
                BorderRadius = AppTheme.Radius14,
                Header = header,
                Content = content,
                Footer = footer,
                OnCancel = close,
                OnClose = close
            }
        )

        func PageContent(ui Presentation, title string, maxWidth float64 = 520, trailing Blob? = nil) Container {
            let card = Card(ui)
            card.Width = Percent(100)
            card.MaxWidth = maxWidth
            card.MaxHeight = Percent(100)
            let header = Header(Label(ui, title, AppTheme.Type17, AppTheme.Ink), AppTheme.Space8)
            header.AlignItems = AlignItems.Baseline
            header.JustifyContent = JustifyContent.SpaceBetween
            if let value = trailing {
                header.Add(value)
            }
            card.Add(header)
            return card
        }
    }
}
