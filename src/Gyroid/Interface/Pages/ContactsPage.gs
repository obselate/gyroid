package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Contacts
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Threading.Tasks

partial class WalletView {
    private var contacts SortedDictionary[string, string] = SortedDictionary[string, string](StringComparer.Ordinal)

    private var contactName string = ""

    private var contactAddress string = ""

    private var contactIssue string = ""

    private var editingContact string = ""

    private var deletingContact string = ""

    private func LoadContacts() {
        try {
            contacts = AddressBook.ReadContacts(message -> error = message)
        } catch (failure WalletException) {
            error = failure.Message
        }
    }

    private func ContactsPage() Blob {
        let panel = PageContent(strings.Get("contacts"), 640)
        if contacts.Count > 0 {
            let list = Container{
                Gap: 6,
                MinHeight: 0,
                FlexShrink: 1,
                OverflowY: Overflow.Scroll,
                ScrollbarY: Theme.Read().Scrollbar
            }
            for (label, destination) in contacts {
                list.Add(
                    Container{
                        Key: label,
                        Height: 44,
                        FlexShrink: 0,
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        Gap: 12,
                        Padding: Edges{Left: 14, Right: 4},
                        BorderWidth: Edges{Left: 3, Top: 1, Right: 1, Bottom: 1},
                        BorderRadius: 4,
                        BorderColor: rule,
                        BorderStartColor: if label == editingContact {
                            lime
                        } else {
                            blue
                        },
                        BackgroundColor: surface,
                        Container{Width: 160, FlexShrink: 0, Label(label, 14, ink)},
                        Grow(Label(Hidden(destination), 12, body)),
                        IconButton{
                            Icon: MaterialIcons.Create("edit", 16, body),
                            Disabled: Working(),
                            AccessibilityName: strings.Get("Edit") + " " + label,
                            OnClick: () -> {
                                editingContact = label
                                contactName = label
                                contactAddress = destination
                                contactIssue = ""
                                Rebuild()
                            }
                        }.Build(),
                        IconButton{
                            Icon: MaterialIcons.Create("delete", 16, body),
                            Disabled: Working(),
                            AccessibilityName: strings.Get("Delete") + " " + label,
                            OnClick: () -> {
                                deletingContact = label
                                Rebuild()
                            }
                        }.Build()
                    }
                )
            }
            panel.Add(list)
        }
        let label = contactName.Trim()
        let taken = label != editingContact && contacts.ContainsKey(label)
        panel.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: 16,
                FlexShrink: 0,
                Container{
                    Width: 200,
                    FlexShrink: 0,
                    Field(
                        "Name",
                        contactName,
                        value -> {
                            contactName = value
                            Rebuild()
                        },
                        () -> SaveContact(),
                        issue: taken ? "Name already exists": ""
                    )
                },
                Grow(
                    Container{
                        MinWidth: 0,
                        Field(
                            "Address",
                            contactAddress,
                            value -> {
                                contactAddress = value.Trim()
                                contactIssue = ""
                                Rebuild()
                            },
                            () -> SaveContact(),
                            issue: contactIssue
                        )
                    }
                )
            }
        )
        let actions = List[Blob]()
        if editingContact.Length > 0 {
            actions.Add(Button("Cancel", () -> ResetContact(), Working()))
        }
        actions.Add(
            Button(
                "Save",
                () -> SaveContact(),
                Working() || label.Length == 0 || contactAddress.Length == 0 || taken,
                true
            )
        )
        panel.Add(ActionRow(actions.ToArray()))
        return panel
    }

    private func ResetContact() {
        editingContact = ""
        contactName = ""
        contactAddress = ""
        contactIssue = ""
        Rebuild()
    }

    private func SaveContact() {
        let label = contactName.Trim()
        if Working() || label.Length == 0 || label != editingContact && contacts.ContainsKey(label) {
            return
        }
        try {
            let next = SortedDictionary[string, string](contacts, StringComparer.Ordinal)
            next.Remove(editingContact)
            next[label] = WalletValidation.ValidateDestination(contactAddress)
            StoreContacts(next, () -> ResetContact())
        } catch (failure WalletException) {
            contactIssue = failure.Message
            Rebuild()
        }
    }

    private func StoreContacts(next SortedDictionary[string, string], done Action) {
        Run(
            Task.Run(() -> AddressBook.WriteContacts(next)),
            () -> {
                contacts = next
                done()
            }
        )
    }

    private func DeleteContactDialog() Blob {
        let close Action = () -> {
            deletingContact = ""
            Rebuild()
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "delete-contact",
            ModalDialog{
                Open: true,
                CreateRoot: DialogRoot,
                Preset: ModalDialogPreset.Confirm,
                AccessibilityName: strings.Get("Delete"),
                Width: Math.Min(width - 48, 420),
                Content: Label(deletingContact, 16, ink, ""),
                ConfirmText: strings.Get("Delete"),
                CancelText: strings.Get("Cancel"),
                ConfirmDisabled: Working(),
                OnConfirm: () -> {
                    let removed = deletingContact
                    let next = SortedDictionary[string, string](contacts, StringComparer.Ordinal)
                    next.Remove(removed)
                    deletingContact = ""
                    StoreContacts(
                        next,
                        () -> {
                            if editingContact == removed {
                                ResetContact()
                            }
                        }
                    )
                },
                OnCancel: close,
                OnClose: close
            }
        )
    }
}
