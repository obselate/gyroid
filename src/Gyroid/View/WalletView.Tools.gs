package Gyroid.View

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Model
import Gyroid.Services
import System
import System.Collections.Generic
import System.Threading.Tasks

partial class WalletView {
    private var toolsTab string = "sign"
    private var help string = ""
    private let helpAnchors Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle]()
    private var message string = ""
    private var signature string = ""
    private var signer string = ""
    private var proofTx string = ""
    private var proofKey string = ""
    private var proofAddress string = ""
    private var proofAmount string = ""
    private var verdict bool?
    private var verdictRun int32
    private var rescan Task?
    private var contacts SortedDictionary[string, string] = SortedDictionary[string, string](StringComparer.Ordinal)
    private var contactName string = ""
    private var contactAddress string = ""
    private var contactIssue string = ""
    private var editingContact string = ""
    private var deletingContact string = ""
    private var spendKey string = ""
    private var viewKey string = ""
    private var filePassword string = ""
    private var viewKeys WalletViewKeys?
    private var viewKeysVisible bool
    private var viewOnlyOpen bool
    private var viewOnlyCreated string = ""

    private func ClearTools() {
        message = ""
        signature = ""
        signer = ""
        proofTx = ""
        proofKey = ""
        proofAddress = ""
        proofAmount = ""
        ResetVerdict()
    }

    private func ResetVerdict() {
        verdict = nil
        verdictRun += 1
    }

    private func Explainer(topic string, summary string, details[]string) Blob {
        if !helpAnchors.ContainsKey(topic) {
            helpAnchors[topic] = ElementHandle()
        }
        let lines = Container{Gap: 8}
        for line in details {
            lines.Add(
                Text{Content: strings.Get(line), FontFamily: font, FontSize: 13, Color: ink, TextWrap: TextWrap.Wrap}
            )
        }
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 4,
            FlexShrink: 0,
            Grow(Label(strings.Get(summary), 13, body, "")),
            Container{
                Handle: helpAnchors[topic],
                IconButton{
                    Icon: MaterialIcons.Create("info", 16, body),
                    AccessibilityName: strings.Get(topic),
                    OnClick: () -> {
                        help = topic
                        Rebuild()
                    }
                }.Build()
            },
            Cell.Mount[PopoverInput, Popover](
                topic,
                PopoverInput{
                    Open: help == topic,
                    Anchor: helpAnchors[topic],
                    Placement: PopoverPlacement.BottomEnd,
                    Width: 400,
                    Padding: 16,
                    Content: lines,
                    AccessibilityName: strings.Get(topic),
                    OnDismiss: reason -> {
                        help = ""
                        Rebuild()
                    }
                }
            )
        }
    }

    private func Tabs(key string, label string, items[]NavigationItem, selected string, chosen Action[string]) Blob ->
    Cell.Mount[TabBarInput, TabBar](
        key,
        TabBarInput{
            Items: items,
            SelectedId: selected,
            AccessibilityName: strings.Get(label),
            CreateItem: (bar TabBarInput, item NavigationItem, button Button) -> {
                button.BorderRadius = 4
                button.Overflow = Overflow.Hidden
                return button
            },
            OnSelect: chosen
        }
    )

    private func ToolsPage() Blob {
        let viewOnly = wallet.Snapshot.ViewOnly
        let tab = if viewOnly && toolsTab == "sign" {
            "verify"
        } else {
            toolsTab
        }
        let items = List[NavigationItem]()
        if !viewOnly {
            items.Add(NavigationItem{Id: "sign", Label: strings.Get("Sign")})
        }
        items.Add(NavigationItem{Id: "verify", Label: strings.Get("Verify")})
        items.Add(NavigationItem{Id: "proof", Label: strings.Get("Proof")})
        let panel = PageContent(
            strings.Get("tools"),
            640,
            Tabs(
                "tools-tabs",
                "tools",
                items.ToArray(),
                tab,
                id -> {
                    toolsTab = id
                    ResetVerdict()
                    Rebuild()
                }
            )
        )
        let verify Action = () -> Verify(tab)
        panel.Add(
            switch tab {
                case "sign": Explainer(
                    "About signing",
                    "Prove you own this wallet's address",
                    []string{
                        "Signs your message with this wallet's key",
                        "Share the message, signature and address",
                        "Nothing is sent and no coins move",
                        "Anyone can check it in Verify"
                    }
                )
                case "verify": Explainer(
                    "About verifying",
                    "Check that an address owner signed a message",
                    []string{
                        "Paste the address, message and signature",
                        "Valid means the address owner signed it",
                        "Any change to the message makes it invalid"
                    }
                )
                default: Explainer(
                    "About payment proofs",
                    "Prove you paid someone, or check a proof",
                    []string{
                        "Open a confirmed send in History, then Prove",
                        "Share the four fields below with them",
                        "Valid means that address got that amount",
                        "Anyone can check it. Your keys stay private"
                    }
                )
            }
        )
        if tab == "sign" {
            panel.Add(
                Field(
                    "Message",
                    message,
                    value -> {
                        message = value
                        signature = ""
                        Rebuild()
                    },
                    () -> Sign()
                )
            )
            if signature.Length > 0 {
                panel.Add(Copyable("Signature", signature, Grouped(signature)))
            }
            panel.Add(ActionRow([]Blob{Button("Sign", () -> Sign(), Working() || message.Length == 0, true)}))
            return panel
        }
        if tab == "proof" {
            panel.Add(ToolField("Transaction", proofTx, value -> proofTx = value.Trim(), verify))
            panel.Add(ToolField("Proof key", proofKey, value -> proofKey = value.Trim(), verify))
            panel.Add(ToolField("Address", proofAddress, value -> proofAddress = value.Trim(), verify))
            panel.Add(ToolField("Amount", proofAmount, value -> proofAmount = value.Trim(), verify))
        } else {
            panel.Add(ToolField("Address", signer, value -> signer = value.Trim(), verify))
            panel.Add(ToolField("Message", message, value -> message = value, verify))
            panel.Add(ToolField("Signature", signature, value -> signature = value.Trim(), verify))
        }
        let blank = if tab == "proof" {
            proofTx.Length == 0 || proofKey.Length == 0 || proofAddress.Length == 0 || proofAmount.Length == 0
        } else {
            signer.Length == 0 || message.Length == 0 || signature.Length == 0
        }
        let result = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, FlexGrow: 1}
        if let valid = verdict {
            let color = valid ? lime: pink
            result.Add(MaterialIcons.Create(valid ? "check_circle": "cancel", 18, color))
            result.Add(Label(strings.Get(valid ? "Valid": "Invalid"), 14, color, ""))
        }
        panel.Add(ActionRow([]Blob{result, Button("Verify", verify, Working() || blank, true)}))
        return panel
    }

    private func ToolField(label string, value string, changed Action[string], submit Action) Blob -> Field(
        label,
        value,
        text -> {
            changed(text)
            ResetVerdict()
            Rebuild()
        },
        submit
    )

    private func Sign() {
        if Working() || message.Length == 0 {
            return
        }
        let task = wallet.SignAsync(message)
        Run(
            task,
            () -> {
                signature = task.Result
            }
        )
    }

    private func Verify(tab string) {
        if Working() {
            return
        }
        ResetVerdict()
        let run = verdictRun
        let task = if tab == "proof" {
            wallet.VerifyProofAsync(proofTx, proofKey, proofAddress, proofAmount)
        } else {
            wallet.VerifyAsync(signer, message, signature)
        }
        Run(
            task,
            () -> {
                if run == verdictRun {
                    verdict = task.Result
                }
            }
        )
    }

    private func Rescan() {
        let task = wallet.RescanAsync()
        rescan = task
        Run(task)
    }

    private func LoadContacts() {
        try {
            contacts = WalletController.ReadContacts()
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
            Task.Run(() -> WalletController.WriteContacts(next)),
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

    private func ExportViewKeys() {
        if Working() || revealPassword.Length == 0 {
            return
        }
        let buffer = revealPassword.ToCharArray()
        revealPassword = ""
        let task = wallet.ExportViewKeysAsync(buffer)
        Run(
            task,
            () -> {
                viewKeys = task.Result
            },
            buffer
        )
    }

    private func ViewKeysDialog(keys WalletViewKeys) Blob {
        let close Action = () -> {
            ClearSecrets()
            Rebuild()
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "view-keys",
            ModalDialog{
                Open: true,
                CreateRoot: DialogRoot,
                AccessibilityName: strings.Get("View keys"),
                Width: Math.Min(width - 48, 600),
                Header: Label(strings.Get("View keys"), 18, ink, ""),
                Content: Container{
                    Gap: 14,
                    ViewKey("Spend public key", keys.SpendPublic),
                    ViewKey("View private key", keys.ViewPrivate)
                },
                Footer: ActionRow(
                    []Blob{
                        Button(
                            viewKeysVisible ? "Hide": "Reveal",
                            () -> {
                                viewKeysVisible = !viewKeysVisible
                                Rebuild()
                            }
                        ),
                        Button("Close", close)
                    }
                ),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func ViewKey(label string, key[]char) Blob -> Accent(
        viewKeysVisible ? lime: edge,
        Copyable(label, String(key), Grouped(viewKeysVisible ? String(key): String('•', key.Length)), 30000)
    )

    private func ViewOnlyDialog() Blob {
        let close Action = () -> {
            ClearSecrets()
            name = ""
            Rebuild()
        }
        let content = Container{Gap: 14}
        let actions = List[Blob]{Button(viewOnlyCreated.Length > 0 ? "Close": "Cancel", close)}
        if viewOnlyCreated.Length > 0 {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    MaterialIcons.Create("check_circle", 18, lime),
                    Label(WalletName(viewOnlyCreated), 16, lime, "")
                }
            )
        } else {
            if error.Length > 0 {
                content.Add(Label(Explain(error), 13, pink, ""))
            }
            let submit Action = () -> CreateViewOnly()
            content.Add(
                Field(
                    "Name",
                    name,
                    value -> {
                        name = value
                        Rebuild()
                    },
                    submit
                )
            )
            content.Add(
                Field(
                    "Password",
                    password,
                    value -> {
                        password = value
                        passwordIssue = ""
                        Rebuild()
                    },
                    submit,
                    true
                )
            )
            content.Add(
                Field(
                    "File password",
                    filePassword,
                    value -> {
                        filePassword = value
                        passwordIssue = ""
                        Rebuild()
                    },
                    submit,
                    true
                )
            )
            content.Add(
                Field(
                    "Confirm",
                    confirmation,
                    value -> {
                        confirmation = value
                        passwordIssue = ""
                        Rebuild()
                    },
                    submit,
                    true,
                    passwordIssue
                )
            )
            actions.Add(
                Button(
                    "Create",
                    submit,
                    Working() || name.Trim().Length == 0 || password.Length == 0 || filePassword.Length == 0,
                    true
                )
            )
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "view-only",
            ModalDialog{
                Open: true,
                CreateRoot: DialogRoot,
                AccessibilityName: strings.Get("Create view-only"),
                Width: Math.Min(width - 48, 520),
                Header: Label(strings.Get("Create view-only"), 18, ink, ""),
                Content: content,
                Footer: ActionRow(actions.ToArray()),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func CreateViewOnly() {
        if Working() || name.Trim().Length == 0 || password.Length == 0 || filePassword.Length == 0 {
            return
        }
        passwordIssue = if password == filePassword {
            "View-only file password must differ from the wallet password"
        } else {
            WalletValidation.PasswordError(filePassword.ToCharArray(), confirmation.ToCharArray())
        }
        if passwordIssue.Length > 0 {
            Rebuild()
            return
        }
        let filename = WalletFile(name)
        let current = password.ToCharArray()
        let secret = filePassword.ToCharArray()
        Run(
            wallet.CreateViewOnlyAsync(filename, current, secret),
            () -> {
                ClearSecrets()
                name = ""
                viewOnlyOpen = true
                viewOnlyCreated = filename
            },
            current,
            secret
        )
    }
}
