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
            let list = Card(ui, Edges{Top: 4, Bottom: 4, Left: 16, Right: 16}, 0, 14)
            list.FlexShrink = 1
            list.OverflowY = Overflow.Scroll
            for index in 0 ... rows.Length {
                if index < rows.Length - 1 {
                    rows[index].BorderWidth = Edges{Bottom: 1}
                }
                list.Add(rows[index])
            }
            return list
        }

        func Card(ui Presentation, padding Edges? = nil, gap float64 = 16, radius float64 = 6) Container -> Container{
            BackgroundColor: ui.Surface.WithAlpha(ui.Pane),
            BackdropBlur: 16,
            BorderWidth: 1,
            BorderColor: Theme.Read().HairlineColor,
            BorderRadius: radius,
            Padding: padding ?? Edges(20),
            Gap: gap,
            MinWidth: 0,
            MinHeight: 0
        }

        func PageCard(ui Presentation, width float64, height float64) Container {
            let card = Card(
                ui,
                width < 1100 ? 16.0: Math.Clamp(height * 0.025, 20.0, 32.0),
                Math.Clamp(14 + Math.Max(0, height - 640) * 0.025, 14.0, 24.0),
                14
            )
            card.Width = 900
            card.MaxWidth = Percent(100)
            card.MaxHeight = Percent(100)
            return card
        }

        func Header(label Blob, gap float64 = 8, trailing Blob? = nil, value Blob? = nil) Container {
            let header = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: gap,
                FlexShrink: 0,
                label
            }
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
                Gap: 10,
                Height: height,
                FlexShrink: 0,
                BorderColor: ui.FaintRule,
                Grow(Label(ui, ui.Strings.Get(label), 14, ui.Body, ""))
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
                Width: size,
                Height: size,
                FlexShrink: shrink,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                BorderWidth: 1,
                BorderRadius: radius,
                BorderColor: active ? ui.Lime: ui.Edge,
                BackgroundColor: ui.Control,
                Disabled: disabled,
                Hover: Style{BackgroundColor: ui.Rule},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label},
                OnClick: click,
                MaterialIcons.Create(
                    icon,
                    iconSize,
                    iconColor ?? (active ? ui.Lime: disabled ? disabledColor ?? ui.Dim: ui.Body)
                )
            }
            WidgetKeyBindings.BindActivation(button)
            return button
        }

        func Modal(ui Presentation, key string, dialog ModalDialog) Blob -> Cell.Mount[ModalDialog, ModalDialogHost](
            key,
            dialog with{CreateRoot = (dialog, backdrop, panel) -> DialogRoot(ui)}
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
            ModalDialog{
                Open: true,
                KeyBindings: WidgetKeyBindings.Editing(window?.PlatformInput),
                AccessibilityName: ui.Strings.Get(name),
                Width: Math.Min(availableWidth - 40, width),
                MaxHeight: Percent(100),
                Padding: 22,
                Gap: 14,
                BackgroundColor: ui.Raised,
                BorderRadius: 14,
                Header: header,
                Content: content,
                Footer: footer,
                OnCancel: close,
                OnClose: close
            }
        )

        func PageContent(ui Presentation, title string, maxWidth float64 = 520, trailing Blob? = nil) Container {
            let card = Card(ui)
            card.Width = Percent(100)
            card.MaxWidth = maxWidth
            card.MaxHeight = Percent(100)
            let header = Header(Label(ui, title, 18, ui.Ink), 16)
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
