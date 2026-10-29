package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Gyroid.Contacts
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Threading.Tasks

data struct ContactsInput {
    var Ui Presentation
    var Contacts SortedDictionary[string, string]
    var Privacy bool
    var Busy bool
    var Language string
    var Height float64
    var OnChange Action[SortedDictionary[string, string]]
}

class ContactsPage : Cell[ContactsInput] {
    private var editing string? = nil

    private var deleting string = ""

    private var contactName string = ""

    private var contactAddress string = ""

    private var issue string = ""

    protected override func Build(input ContactsInput) Blob {
        let ui = input.Ui
        let card = ui.Glass()
        card.Width = Percent(100)
        card.MaxWidth = Math.Clamp(640 + Math.Max(0, input.Height - 640) * 0.6, 640.0, 900.0)
        card.MaxHeight = Percent(100)
        card.BorderRadius = 14
        card.Gap = 14
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                FlexShrink: 0,
                ui.Grow(ui.Label(ui.Strings.Get("contacts"), 17, ui.Ink, "")),
                Square(input, "person_add", ui.Strings.Get("Add contact"), editing == "", () -> Edit("", ""))
            }
        )
        let list = Container{
            Gap: 8,
            MinHeight: 0,
            FlexShrink: 1,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Theme.Read().Scrollbar
        }
        if editing == "" || input.Contacts.Count == 0 && editing == nil {
            list.Add(Editor(input, ""))
        }
        for (label, destination) in input.Contacts {
            list.Add(
                if label == editing {
                    Editor(input, label)
                } else {
                    Row(input, label, destination)
                }
            )
        }
        card.Add(list)
        if deleting.Length > 0 {
            card.Add(DeleteDialog(input))
        }
        return card
    }

    private func Edit(label string, destination string) {
        editing = label
        contactName = label
        contactAddress = destination
        issue = ""
        Rebuild()
    }

    private func Reset() {
        editing = nil
        contactName = ""
        contactAddress = ""
        issue = ""
        Rebuild()
    }

    private func Square(input ContactsInput, icon string, label string, active bool, click Action) Blob {
        let ui = input.Ui
        let button = Goo
            .Button{
            Width: 34,
            Height: 34,
            FlexShrink: 0,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            BorderWidth: 1,
            BorderRadius: 8,
            BorderColor: active ? ui.Lime: ui.Edge,
            BackgroundColor: Color.Parse("#0b0b0b"),
            Disabled: input.Busy,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label},
            OnClick: click,
            MaterialIcons.Create(icon, 16, active ? ui.Lime: ui.Body)
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Row(input ContactsInput, label string, destination string) Blob {
        let ui = input.Ui
        return Container{
            Key: label,
            Height: 48,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Padding: Edges{Left: 12, Right: 7},
            BorderWidth: 1,
            BorderRadius: 10,
            BorderColor: ui.Rule,
            BackgroundColor: ui.Surface,
            Accessibility: Accessibility{Role: AccessibilityRole.ListItem, Name: label},
            MaterialIcons.Create("person", 16, ui.Dim),
            ui.Grow(ui.Label(label, 14, ui.Ink, "")),
            Container{FlexShrink: 1, MinWidth: 0, ui.Label(ui.Hidden(ui.Short(destination)), 13, ui.Dim, "")},
            Square(input, "edit", ui.Strings.Get("Edit") + " " + label, false, () -> Edit(label, destination)),
            Square(
                input,
                "delete",
                ui.Strings.Get("Delete") + " " + label,
                false,
                () -> {
                    deleting = label
                    Rebuild()
                }
            )
        }
    }

    private func Editor(input ContactsInput, original string) Blob {
        let ui = input.Ui
        let label = contactName.Trim()
        let taken = label != original && input.Contacts.ContainsKey(label)
        let save Action = () -> Save(input)
        let fields = Container{
            FlexDirection: FlexDirection.Row,
            Gap: 10,
            FlexShrink: 0,
            Container{
                Width: 180,
                FlexShrink: 0,
                ui.Entry(
                    TextField{
                        AccessibilityName: ui.Strings.Get("Name"),
                        Placeholder: ui.Strings.Get("Name"),
                        Value: contactName,
                        Controlled: true,
                        Disabled: input.Busy,
                        Invalid: taken,
                        IssueText: if taken {
                            ui.Strings.Get("Name already exists")
                        } else {
                            nil
                        },
                        Leading: MaterialIcons.Create("person", 16, ui.Dim),
                        OnChange: value -> {
                            contactName = value
                            Rebuild()
                        },
                        OnSubmit: _ -> save()
                    }
                )
            },
            ui.Grow(
                Container{
                    MinWidth: 0,
                    ui.Entry(
                        TextField{
                            AccessibilityName: ui.Strings.Get("Address"),
                            Placeholder: ui.Strings.Get("Address"),
                            Value: contactAddress,
                            Controlled: true,
                            Password: input.Privacy,
                            Disabled: input.Busy,
                            Invalid: issue.Length > 0,
                            IssueText: if issue.Length > 0 {
                                ui.Strings.Explain(issue)
                            } else {
                                nil
                            },
                            ContentDirection: Direction.LeftToRight,
                            OnChange: value -> {
                                contactAddress = value.Trim()
                                issue = ""
                                Rebuild()
                            },
                            OnSubmit: _ -> save()
                        }
                    )
                }
            )
        }
        return Container{
            Key: "edit",
            Gap: 12,
            Padding: 12,
            FlexShrink: 0,
            BorderWidth: 1,
            BorderRadius: 10,
            BorderColor: ui.Edge,
            BackgroundColor: ui.Raised,
            fields,
            ui.ActionRow(
                []Blob{
                    ui.Button("Cancel", () -> Reset(), input.Busy || input.Contacts.Count == 0),
                    ui.Button(
                        "Save",
                        save,
                        input.Busy || label.Length == 0 || contactAddress.Length == 0 || taken,
                        true
                    )
                }
            )
        }
    }

    private func Save(input ContactsInput) {
        let label = contactName.Trim()
        let original = editing ?? ""
        if input.Busy || label.Length == 0 || label != original && input.Contacts.ContainsKey(label) {
            return
        }
        try {
            let next = SortedDictionary[string, string](input.Contacts, StringComparer.Ordinal)
            next.Remove(original)
            next[label] = WalletValidation.ValidateDestination(contactAddress)
            Store(input, next, () -> Reset())
        } catch (failure WalletException) {
            issue = failure.Message
            Rebuild()
        }
    }

    private func Store(input ContactsInput, next SortedDictionary[string, string], done Action) {
        input.Ui.Run(
            Task.Run(() -> AddressBook.WriteContacts(next)),
            () -> {
                input.OnChange(next)
                done()
            }
        )
    }

    private func DeleteDialog(input ContactsInput) Blob {
        let ui = input.Ui
        let close Action = () -> {
            deleting = ""
            Rebuild()
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "delete-contact",
            ModalDialog{
                Open: true,
                CreateRoot: ui.DialogRoot,
                Preset: ModalDialogPreset.Confirm,
                AccessibilityName: ui.Strings.Get("Delete"),
                Width: 420,
                Content: ui.Label(deleting, 16, ui.Ink, ""),
                ConfirmText: ui.Strings.Get("Delete"),
                CancelText: ui.Strings.Get("Cancel"),
                ConfirmDisabled: input.Busy,
                OnConfirm: () -> {
                    let removed = deleting
                    let next = SortedDictionary[string, string](input.Contacts, StringComparer.Ordinal)
                    next.Remove(removed)
                    deleting = ""
                    Store(
                        input,
                        next,
                        () -> if editing == removed {
                            Reset()
                        } else {
                            Rebuild()
                        }
                    )
                },
                OnCancel: close,
                OnClose: close
            }
        )
    }
}
