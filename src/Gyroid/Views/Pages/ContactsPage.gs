package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Threading.Tasks

data struct ContactsInput {
    var Ui Presentation
    var Contacts SortedDictionary[string, string]
    var Privacy bool
    var Busy bool
    var Language string
    var Network string
    var Height float64
    var OnChange Action[SortedDictionary[string, string]]
}

class ContactsPage : Cell[ContactsInput] {
    private var editing string? = nil

    private var deleting string = ""

    private var editorDestination string = ""

    private let editorHandle ElementHandle = ElementHandle{}

    private let listHandle ElementHandle = ElementHandle{}

    protected override func Build(input ContactsInput) Blob {
        let ui = input.Ui
        let card = WalletParts.PageCard(
            ui,
            maxWidth: Math.Clamp(640 + Math.Max(0, input.Height - 640) * 0.6, 640.0, 900.0),
            fill: true
        )
        card.Add(
            WalletParts.Header(
                Label(ui, ui.Strings.Get("contacts"), AppTheme.Type17, AppTheme.Ink, ""),
                trailing: Icon(
                    ui,
                    MaterialIcons.Create("person_add", AppTheme.Icon16, editing == "" ? AppTheme.Lime: AppTheme.Body),
                    ui.Strings.Get("Add contact"),
                    () -> Edit(input, "", ""),
                    input.Busy,
                    editing == "",
                    AppTheme.ControlRegular
                )
            )
        )
        let list = Container{
            Handle: listHandle,
            Gap: AppTheme.Space8,
            MinHeight: 0,
            FlexShrink: 1,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Theme.Read().Scrollbar
        }
        if editing == "" || input.Contacts.Count == 0 && editing == nil {
            list.Add(Editor(input, "", ""))
        }
        for (label, destination) in input.Contacts {
            list.Add(
                if label == editing {
                    Editor(input, label, editorDestination)
                } else {
                    Row(input, label, destination)
                }
            )
        }
        card.Add(ListParts.Viewport(list, Style{FlexShrink: 1}, grow: false))
        if deleting.Length > 0 {
            card.Add(DeleteDialog(input))
        }
        return card
    }

    private func Edit(input ContactsInput, label string, destination string) {
        if editing != nil || input.Contacts.Count == 0 {
            editorHandle.ScrollIntoView()
            return
        }
        editing = label
        editorDestination = destination
        if label == "" {
            listHandle.JumpTo(0, 0)
        }
    }

    private func Reset() {
        editing = nil
        editorDestination = ""
        Rebuild()
    }

    private func Row(input ContactsInput, label string, destination string) Blob {
        let ui = input.Ui
        return Container{
            BasedOn: AppTheme.ListRowStyle,
            Key: label,
            Height: 48,
            FlexShrink: 0,
            Padding: Edges{Left: AppTheme.Space12, Right: AppTheme.Space8},
            BorderWidth: AppTheme.Border1,
            BorderRadius: AppTheme.Radius10,
            BackgroundColor: AppTheme.Surface,
            Accessibility: Accessibility{Role: AccessibilityRole.ListItem, Name: label},
            MaterialIcons.Create("person", AppTheme.Icon16, AppTheme.Dim),
            Grow(Label(ui, label, AppTheme.Type14, AppTheme.Ink, "")),
            Container{
                FlexShrink: 1,
                MinWidth: 0,
                Label(
                    ui,
                    AddressBook.IsDestination(destination) ? Hidden(ui.Privacy, Short(destination)): ui.Strings.Get(
                        "Invalid"
                    ),
                    AppTheme.Type13,
                    AppTheme.Dim,
                    ""
                )
            },
            Icon(
                ui,
                MaterialIcons.Create("edit", AppTheme.Icon16, AppTheme.Body),
                ui.Strings.Get("Edit") + " " + label,
                () -> Edit(input, label, destination),
                input.Busy,
                size: AppTheme.ControlRegular
            ),
            Icon(
                ui,
                MaterialIcons.Create("delete", AppTheme.Icon16, AppTheme.Body),
                ui.Strings.Get("Delete") + " " + label,
                () -> deleting = label,
                input.Busy,
                size: AppTheme.ControlRegular
            )
        }
    }

    private func Editor(input ContactsInput, original string, destination string) Blob ->
    Cell.Mount[ContactEditorInput, ContactEditor](
        "contact-editor-" + original,
        ContactEditorInput{
            Ui: input.Ui,
            Contacts: input.Contacts,
            Privacy: input.Privacy,
            Busy: input.Busy,
            Language: input.Language,
            Network: input.Network,
            Original: original,
            Destination: destination,
            Handle: editorHandle,
            OnSave: (label, address) -> Save(input, label, address),
            OnCancel: Reset
        }
    )

    private func Save(input ContactsInput, label string, destination string) {
        let next = SortedDictionary[string, string](input.Contacts, StringComparer.Ordinal)
        next.Remove(editing ?? "")
        next[label] = destination
        Store(input, next, Reset)
    }

    private func Store(input ContactsInput, next SortedDictionary[string, string], done Action) {
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                AddressBook.WriteContacts(next)
                return Task.CompletedTask
            },
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
        return WalletParts.Modal(
            ui,
            "delete-contact",
            AppTheme.Dialog with{
                Open = true,
                Preset = ModalDialogPreset.Confirm,
                AccessibilityName = ui.Strings.Get("Delete"),
                Width = 420,
                Content = Label(ui, deleting, AppTheme.Type16, AppTheme.Ink, ""),
                ConfirmText = ui.Strings.Get("Delete"),
                CancelText = ui.Strings.Get("Cancel"),
                ConfirmDisabled = input.Busy,
                OnConfirm = () -> {
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
                OnCancel = close,
                OnClose = close
            }
        )
    }
}

data struct ContactEditorInput {
    var Ui Presentation
    var Contacts SortedDictionary[string, string]
    var Privacy bool
    var Busy bool
    var Language string
    var Network string
    var Original string
    var Destination string
    var Handle ElementHandle
    var OnSave Action[string, string]
    var OnCancel Action
}

class ContactEditor : Cell[ContactEditorInput] {
    private var contactName string? = nil

    private var contactAddress string? = nil

    private var issue string = ""

    protected override func Build(input ContactEditorInput) Blob {
        let ui = input.Ui
        let name = contactName ?? input.Original
        let address = contactAddress ?? input.Destination
        let label = name.Trim()
        let taken = label != input.Original && input.Contacts.ContainsKey(label)
        let destinationName = AddressBook.IsDestination(label)
        let form = WalletForm(
            ui,
            !input.Busy && !taken && !destinationName,
            () -> Save(input),
            []string{label, address},
            edited: () -> Rebuild()
        )
        let fields = Container{
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space10,
            FlexShrink: 0,
            Container{
                Width: 180,
                FlexShrink: 0,
                form.Field(
                    "Name",
                    name,
                    value -> contactName = value,
                    issue: if destinationName {
                        "Name cannot be an address"
                    } else if taken {
                        "Name already exists"
                    } else {
                        ""
                    },
                    disabled: input.Busy,
                    labelled: false,
                    leading: MaterialIcons.Create("person", AppTheme.Icon16, AppTheme.Dim),
                    placeholder: ui.Strings.Get("Name"),
                    inheritDirection: true
                )
            },
            Grow(
                Container{
                    MinWidth: 0,
                    form.Field(
                        "Address",
                        address,
                        value -> {
                            contactAddress = value.Trim()
                            issue = ""
                        },
                        issue: issue,
                        disabled: input.Busy,
                        labelled: false,
                        hidden: input.Privacy,
                        placeholder: ui.Strings.Get("Address")
                    )
                }
            )
        }
        return Container{
            BasedOn: AppTheme.TileStyle,
            Key: "edit",
            Handle: input.Handle,
            Gap: AppTheme.Space12,
            Padding: AppTheme.Space12,
            FlexShrink: 0,
            BackgroundColor: AppTheme.Raised,
            fields,
            ActionRow(
                []Blob{
                    Button(ui, "Cancel", input.OnCancel, input.Busy || input.Contacts.Count == 0),
                    Button(ui, "Save", form.Submit, !form.CanSubmit, true)
                }
            )
        }
    }

    private func Save(input ContactEditorInput) {
        try {
            let destination = WalletValidation.ValidateDestination(contactAddress ?? input.Destination)
            if !destination.StartsWith("$", StringComparison.Ordinal) {
                let addressIssue = WalletValidation.AddressIssue(destination, input.Network)
                if addressIssue.Length > 0 {
                    throw WalletException(addressIssue)
                }
            }
            input.OnSave((contactName ?? input.Original).Trim(), destination)
        } catch (failure WalletException) {
            issue = failure.Message
            Rebuild()
        }
    }
}
