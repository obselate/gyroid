package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Data
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
import System.Threading
import System.Threading.Tasks

data struct ContactsInput {
    var Ui Presentation
    var Window Window?
    var Contacts SortedDictionary[string, string]
    var Privacy bool
    var Busy bool
    var Language string
    var Network string
    var Height float64
    var OnChange Action[SortedDictionary[string, string]]
}

data struct ContactRow {
    var Name string
    var Destination string
    var Valid bool
    var Privacy bool
    var Busy bool
    var Language string
}

class ContactDraft {
    public var Name string? = nil
    public var Address string? = nil
    public var Issue string = ""
}

class ContactsPage : Cell, IDisposable {
    private var current ContactsInput
    private var rows[]ContactRow = []ContactRow{}
    private var draft ContactDraft = ContactDraft{}
    private let rowKey Func[ContactRow, string]
    private let rowBuilder Func[ContactRow, Blob]
    private var generation int32
    private var disposed bool
    private var lifetime CancellationTokenSource? = nil
    private var issue string = ""

    init() {
        rowKey = row -> "contact-row-" + row.Name
        rowBuilder = row -> Row(current, row.Name, row.Destination, row.Valid)
    }

    public func Accept(input ContactsInput) {
        if disposed || current.Equals(input) {
            return
        }
        let prepare = current.Contacts != input.Contacts ||
            current.Privacy != input.Privacy ||
            current.Busy != input.Busy ||
            current.Language != input.Language
        current = input
        if !prepare {
            Rebuild()
            return
        }
        generation++
        if let window = input.Window {
            let source = lifetime ?? CancellationTokenSource.CreateLinkedTokenSource(window.Closed)
            lifetime = source
            let token = source.Token
            let id = generation
            go Prepare(input, window, id, token)
        }
    }

    private func Prepare(input ContactsInput, window Window, id int32, token CancellationToken) {
        try {
            let contacts = AddressBook.PrepareContacts(input.Contacts, token)
            let prepared = List[ContactRow](contacts.Length)
            for contact in contacts {
                prepared.Add(
                    ContactRow{
                        Name: contact.Name,
                        Destination: contact.Destination,
                        Valid: contact.Valid,
                        Privacy: input.Privacy,
                        Busy: input.Busy,
                        Language: input.Language
                    }
                )
            }
            let result = prepared.ToArray()
            window.TryPost(
                () -> {
                    if id == generation {
                        rows = result
                        issue = ""
                        Rebuild()
                    }
                }
            )
        } catch (error OperationCanceledException) { } catch (error Exception) {
            let message = error.Message
            window.TryPost(
                () -> {
                    if id == generation {
                        issue = message
                        Rebuild()
                    }
                }
            )
        }
    }

    public func Dispose() {
        disposed = true
        generation++
        lifetime?.Cancel()
        lifetime?.Dispose()
    }

    private var editing string? = nil

    private var deleting string = ""

    private let editorHandle ElementHandle = ElementHandle{}

    private let listHandle ElementHandle = ElementHandle{}

    override func Build() Blob {
        let input = current
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
                    () -> Edit(input, ""),
                    input.Busy,
                    editing == "",
                    AppTheme.ControlRegular
                )
            )
        )
        if editing != nil || input.Contacts.Count == 0 {
            let key = editing ?? ""
            let destination = input.Contacts.TryGetValue(key, out let address) ? address: ""
            card.Add(Editor(input, key, destination))
        }
        let list = VirtualRows(rows, 56, rowKey, rowBuilder, false)
        list.Handle = listHandle
        list.FlexGrow = 1
        list.MinHeight = 0
        card.Add(ListParts.Viewport(list))
        if issue.Length > 0 {
            card.Add(Label(input.Ui, input.Ui.Strings.Explain(issue), AppTheme.Type13, AppTheme.Dim, ""))
        }
        if deleting.Length > 0 {
            card.Add(DeleteDialog(input))
        }
        return card
    }

    private func Edit(input ContactsInput, label string) {
        if editing != nil || input.Contacts.Count == 0 {
            editorHandle.ScrollIntoView()
            return
        }
        editing = label
        draft = ContactDraft{}
        if label != "" {
            listHandle.ScrollToItem("contact-row-" + label)
        }
    }

    private func Reset() {
        editing = nil
        draft = ContactDraft{}
        Rebuild()
    }

    private func Row(input ContactsInput, label string, destination string, valid bool) Blob {
        let ui = input.Ui
        return Container{
            BasedOn: AppTheme.ListRowStyle,
            Key: "contact-row-" + label,
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
                    valid ? Hidden(input.Privacy, Short(destination)): ui.Strings.Get("Invalid"),
                    AppTheme.Type13,
                    AppTheme.Dim,
                    ""
                )
            },
            Icon(
                ui,
                MaterialIcons.Create("edit", AppTheme.Icon16, AppTheme.Body),
                ui.Strings.Get("Edit") + " " + label,
                () -> Edit(input, label),
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
            Draft: draft,
            OnSave: (label, address) -> Save(input, label, address),
            OnCancel: Reset
        }
    )

    private func Save(input ContactsInput, label string, destination string) ->
    Store(input, editing ?? "", label, destination, Reset)

    private func Store(input ContactsInput, original string, label string, destination string?, done Action) {
        var result SortedDictionary[string, string]? = nil
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                ct.ThrowIfCancellationRequested()
                result = AddressBook.StoreContacts(input.Contacts, original, label, destination)
                return Task.CompletedTask
            },
            () -> {
                if let next = result {
                    input.OnChange(next)
                    if !disposed {
                        done()
                    }
                }
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
                    deleting = ""
                    Store(
                        input,
                        removed,
                        "",
                        nil,
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
    var Draft ContactDraft
    var OnSave Action[string, string]
    var OnCancel Action
}

class ContactEditor : Cell[ContactEditorInput] {
    protected override func Build(input ContactEditorInput) Blob {
        let ui = input.Ui
        let name = input.Draft.Name ?? input.Original
        let address = input.Draft.Address ?? input.Destination
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
                    value -> input.Draft.Name = value,
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
                            input.Draft.Address = value.Trim()
                            input.Draft.Issue = ""
                        },
                        issue: input.Draft.Issue,
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
            let destination = WalletValidation.ValidateDestination(input.Draft.Address ?? input.Destination)
            if !destination.StartsWith("$", StringComparison.Ordinal) {
                let addressIssue = WalletValidation.AddressIssue(destination, input.Network)
                if addressIssue.Length > 0 {
                    throw WalletException(addressIssue)
                }
            }
            input.OnSave((input.Draft.Name ?? input.Original).Trim(), destination)
        } catch (failure WalletException) {
            input.Draft.Issue = failure.Message
            Rebuild()
        }
    }
}
