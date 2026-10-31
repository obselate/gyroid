package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Linq
import System.Threading
import System.Threading.Tasks

class MessagesViewState {
    var ConversationId string = ""
    var MessageId string = ""
    var Request int64
    var NewConversation Conversation?
    let Drafts Dictionary[string, string] = Dictionary[string, string](StringComparer.Ordinal)
}

data struct MessagesInput {
    var Ui Presentation
    var Session WalletSession
    var State MessagesViewState
    var Contacts SortedDictionary[string, string]
    var Width float64
    var Drawer bool
    var OnOpen Action
    var OnClose Action
    var OnContacts Action
}

class MessagesPage : Cell[MessagesInput], IDisposable {
    private var selected string = ""
    private var request int64 = -1
    private let seen HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private var previousMessages IReadOnlyList[Message] = Array.Empty[Message]()
    private let messageKeys Dictionary[string, string] = Dictionary[string, string](StringComparer.Ordinal)
    private let handles Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle](StringComparer.Ordinal)
    private let scroll ElementHandle = ElementHandle()
    private var scrollTimer WindowTimer?
    private var highlightTimer WindowTimer?
    private var highlight string = ""
    private var detail Message?
    private var dialog string = ""
    private var name string = ""
    private var address string = ""
    private var issue string = ""
    private var busy bool
    private let members List[string] = List[string]()

    func Dispose() {
        scrollTimer?.Dispose()
        highlightTimer?.Dispose()
    }

    private func Run(input MessagesInput, action Func[CancellationToken, Task], done Action? = nil) {
        busy = true
        issue = ""
        input.Ui.Actions.Background(ct -> Execute(input, action, done, ct))
        Rebuild()
    }

    private async func Execute(
        input MessagesInput,
        action Func[CancellationToken, Task],
        done Action?,
        ct CancellationToken
    ) {
        var error = ""
        try {
            await action(ct)
        } catch (failure Exception) {
            error = failure.Message
        }
        input
            .Ui
            .Actions
            .window
            ?.TryPost(
            () -> {
                busy = false
                issue = error
                if error.Length == 0 {
                    done?.Invoke()
                }
                Rebuild()
            }
        )
    }

    private func Select(input MessagesInput, conversation Conversation) {
        input.State.ConversationId = conversation.Id
        input.State.MessageId = ""
        input.State.NewConversation = conversation
        input.State.Request++
        detail = nil
        Rebuild()
    }

    protected override func Build(input MessagesInput) Blob {
        let ui = input.Ui
        let service = input.Session.Messages
        let conversations = service.Conversations
        var conversation = conversations.FirstOrDefault(item -> item.Id == input.State.ConversationId) ??
            input
            .State
            .NewConversation
        if conversation == nil && conversations.Count > 0 && !input.Drawer {
            conversation = conversations[0]
            input.State.ConversationId = conversation.Id
        }
        let changed = selected != conversation?.Id
        if changed {
            selected = conversation?.Id ?? ""
            seen.Clear()
            handles.Clear()
            messageKeys.Clear()
            detail = nil
            if let current = conversation {
                ui.Actions.Background(ct -> Execute(input, token -> service.Select(current, token), nil, ct))
            }
        }
        let root = Container{
            Width: Percent(100),
            Height: Percent(100),
            MinHeight: 0,
            MinWidth: 0,
            FlexDirection: FlexDirection.Row,
            Gap: 12
        }
        if !input.Drawer {
            root.Add(Conversations(input, conversations))
        }
        let thread = WalletParts.Card(ui, 0, 0, 6)
        thread.FlexGrow = 1
        thread.FlexBasis = 0
        thread.MinWidth = 0
        thread.MinHeight = 0
        thread.Overflow = Overflow.Hidden
        if let current = conversation {
            thread.Add(Header(input, current))
            let rows = Container{
                Handle: scroll,
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                MinWidth: 0,
                Padding: Edges{Left: 16, Right: 16, Bottom: 16},
                OverflowY: Overflow.Scroll,
                OverflowX: Overflow.Hidden,
                ScrollbarY: Theme.Read().Scrollbar
            }
            let messages = current.Messages
            let lastOwn = messages.LastOrDefault(item -> item.Outgoing)
            if !changed {
                for message in previousMessages {
                    if message.Txid.Length > 0 {
                        seen.Add(message.Txid)
                        messageKeys.TryAdd(message.Txid, message.Key)
                    }
                }
            }
            for index in 0 ... messages.Count {
                let message = messages[index]
                let previous = index > 0 ? messages[index - 1]: nil
                let next = index + 1 < messages.Count ? messages[index + 1]: nil
                let first = previous == nil ||
                    previous.SenderAddress != message.SenderAddress ||
                    (message.SentAt - previous.SentAt).TotalMinutes > 5
                let last = next == nil ||
                    next.SenderAddress != message.SenderAddress ||
                    (next.SentAt - message.SentAt).TotalMinutes > 5
                if previous == nil || (message.SentAt - previous.SentAt).TotalMinutes > 15 {
                    rows.Add(
                        Container{
                            Key: "time:" + message.Key,
                            AlignItems: AlignItems.Center,
                            Margin: Edges{Top: 14},
                            Label(ui, message.SentAt.ToLocalTime().ToString("HH:mm"), 10, ui.Dim, "")
                        }
                    )
                }
                if !handles.ContainsKey(message.Key) {
                    handles[message.Key] = ElementHandle()
                }
                let added = seen.Add(message.Key)
                let newTransaction = message.Txid.Length == 0 || seen.Add(message.Txid)
                rows.Add(
                    Cell.Mount[MessageBubbleInput, MessageBubble](
                        message.Txid.Length > 0 ? messageKeys.GetValueOrDefault(message.Txid, message.Key): message.Key,
                        MessageBubbleInput{
                            Ui: ui,
                            Message: message,
                            Group: current.IsGroup,
                            First: first,
                            Last: last,
                            ShowState: last && Object.ReferenceEquals(message, lastOwn),
                            Animate: added && newTransaction && !changed && ui.Actions.playbackActive(),
                            Highlight: highlight == message.Key,
                            CanRetry: service.Mode == MessengerMode.Send && !busy,
                            Width: input.Drawer ? input.Width: input.Width - Math.Clamp(
                                input.Width * 0.25,
                                200.0,
                                300.0
                            ),
                            Handle: handles[message.Key],
                            OnOpen: () -> {
                                detail = message
                                Rebuild()
                            },
                            OnRetry: () -> Run(input, ct -> service.Resend(current, message, ct))
                        }
                    )
                )
                if added && newTransaction && !changed {
                    Scroll(input, message.Key)
                }
            }
            previousMessages = messages
            thread.Add(rows)
            if request != input.State.Request || changed {
                request = input.State.Request
                highlight = input.State.MessageId
                if highlight.Length > 0 {
                    highlightTimer?.Dispose()
                    highlightTimer = ui.Actions.Delay(
                        1800,
                        () -> {
                            highlight = ""
                            Rebuild()
                        }
                    )
                }
                Scroll(input, input.State.MessageId)
            }
            let draft = input.State.Drafts.GetValueOrDefault(current.Id, "")
            thread.Add(
                Cell.Mount[MessageComposerInput, MessageComposer](
                    "composer:" + current.Id,
                    MessageComposerInput{
                        Ui: ui,
                        Session: input.Session,
                        Conversation: current,
                        Draft: draft,
                        Width: input.Drawer ? input.Width: input.Width - Math.Clamp(input.Width * 0.25, 200.0, 300.0),
                        OnDraft: value -> {
                            input.State.Drafts[current.Id] = value
                            Rebuild()
                        },
                        OnSend: text -> Run(input, ct -> service.Send(current, text, ct))
                    }
                )
            )
        } else {
            thread.Add(Container{Padding: 16, Label(ui, ui.Strings.Get("messages"), 17, ui.Ink, "")})
            thread.Add(
                Container{
                    FlexGrow: 1,
                    JustifyContent: JustifyContent.Center,
                    AlignItems: AlignItems.Center,
                    Label(ui, ui.Strings.Get("No conversations"), 13, ui.Dim, "")
                }
            )
        }
        let error = issue.Length > 0 ? issue: service.Error
        if error.Length > 0 {
            thread.Add(
                Container{
                    Padding: 12,
                    FlexShrink: 0,
                    Text{
                        Content: ui.Strings.Explain(error),
                        FontFamily: ui.Font,
                        FontSize: 12,
                        Color: ui.Pink,
                        TextWrap: TextWrap.Wrap
                    }
                }
            )
        }
        root.Add(thread)
        if dialog.Length > 0 {
            root.Add(Dialog(input, conversation))
        }
        if let message = detail {
            root.Add(Details(input, message))
        }
        return root
    }

    private func Scroll(input MessagesInput, key string) {
        scrollTimer?.Dispose()
        scrollTimer = input
            .Ui
            .Actions
            .Delay(
            0,
            () -> {
                if key.Length > 0 && handles.TryGetValue(key, out let handle) {
                    handle.ScrollIntoView()
                } else {
                    scroll.JumpTo(0, scroll.ScrollRange.Y)
                }
            }
        )
    }

    private func Begin(kind string) {
        dialog = kind
        name = ""
        address = ""
        members.Clear()
        issue = ""
        Rebuild()
    }

    private func Conversations(input MessagesInput, conversations IReadOnlyList[Conversation]) Blob {
        let ui = input.Ui
        let panel = WalletParts.Card(ui, 10, 8, 6)
        panel.Width = Math.Clamp(input.Width * 0.25, 200.0, 300.0)
        panel.FlexShrink = 0
        panel.MinHeight = 0
        panel.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 4,
                Grow(Label(ui, ui.Strings.Get("messages"), 17, ui.Ink, "")),
                WalletParts.Square(
                    ui,
                    "person_add",
                    ui.Strings.Get("New conversation"),
                    false,
                    busy,
                    () -> Begin("direct"),
                    28,
                    ui.Body
                ),
                WalletParts.Square(
                    ui,
                    "group_add",
                    ui.Strings.Get("New group"),
                    false,
                    busy || input.Session.Messages.Mode != MessengerMode.Send,
                    () -> Begin("group"),
                    28,
                    ui.Body
                )
            }
        )
        let list = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Theme.Read().Scrollbar
        }
        for conversation in conversations {
            let latest = conversation.Messages.LastOrDefault()
            let row = Goo
                .Button{
                Key: conversation.Id,
                Width: Percent(100),
                AlignItems: AlignItems.Stretch,
                Padding: Edges{Top: 14, Bottom: 14, Left: 8, Right: 8},
                FlexShrink: 0,
                MinWidth: 0,
                Gap: 6,
                BorderWidth: Edges{Bottom: 1},
                BorderColor: ui.Rule,
                BackgroundColor: conversation.Id == input.State.ConversationId ? ui.Active: Color.Transparent,
                Hover: Style{BackgroundColor: ui.Rule},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.Button,
                    Name: Hidden(ui.Privacy, conversation.Title) + " " + conversation.Unread.ToString(),
                    Selected: conversation.Id == selected
                },
                OnClick: () -> Select(input, conversation),
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 7,
                    MaterialIcons.Create(
                        conversation.IsGroup ? "group": "person",
                        16,
                        conversation.Unread > 0 ? ui.Lime: ui.Dim
                    ),
                    Grow(
                        Label(
                            ui,
                            Hidden(ui.Privacy, conversation.Title),
                            13,
                            conversation.Id == selected ? ui.Lime: ui.Ink,
                            ""
                        )
                    ),
                    Label(ui, latest?.SentAt.ToLocalTime().ToString("HH:mm") ?? "", 10, ui.Dim, "")
                },
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: 8,
                    Padding: Edges{Left: 23},
                    MinWidth: 0,
                    Grow(Label(ui, Hidden(ui.Privacy, Preview(latest?.Text ?? conversation.Handle)), 11, ui.Dim, "")),
                    Label(ui, conversation.Unread > 0 ? conversation.Unread.ToString(): "", 11, ui.Lime, "")
                }
            }
            WidgetKeyBindings.BindActivation(row)
            list.Add(row)
        }
        panel.Add(list)
        return panel
    }

    private func Header(input MessagesInput, conversation Conversation) Blob {
        let ui = input.Ui
        let header = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 6,
            Padding: 14,
            FlexShrink: 0,
            BorderWidth: Edges{Bottom: 1},
            BorderColor: ui.Rule,
            Grow(
                Container{
                    Gap: 4,
                    MinWidth: 0,
                    Label(ui, Hidden(ui.Privacy, conversation.Title), 16, ui.Ink, ""),
                    Label(
                        ui,
                        Hidden(
                            ui.Privacy,
                            conversation.IsGroup ? (
                                conversation.Members.Count(member -> member != input.Session.Messages.OwnAddress) + 1
                            ).ToString() + " " + ui.Strings.Get("members"): conversation.Handle
                        ),
                        11,
                        ui.Dim,
                        ""
                    )
                }
            )
        }
        if !conversation.IsGroup && !input.Contacts.Values.Contains(conversation.Id) {
            header.Add(
                WalletParts.Square(
                    ui,
                    "person_add",
                    ui.Strings.Get("Add contact"),
                    false,
                    busy,
                    () -> {
                        Begin("contact")
                        address = conversation.Id
                    },
                    30,
                    ui.Body
                )
            )
        }
        header.Add(
            WalletParts.Square(
                ui,
                "delete",
                ui.Strings.Get("Remove conversation"),
                false,
                busy,
                () -> Begin("remove"),
                30,
                ui.Dim
            )
        )
        if input.Drawer {
            header.Add(
                WalletParts.Square(
                    ui,
                    "open_in_full",
                    ui.Strings.Get("Open messages"),
                    false,
                    false,
                    input.OnOpen,
                    30,
                    ui.Body
                )
            )
            header.Add(
                WalletParts.Square(ui, "close", ui.Strings.Get("Close"), false, false, input.OnClose, 30, ui.Body)
            )
        }
        return header
    }

    private func Dialog(input MessagesInput, conversation Conversation?) Blob {
        let ui = input.Ui
        let group = dialog == "group"
        let remove = dialog == "remove"
        let contact = dialog == "contact"
        let maximum = Math.Max(0, Wire.MaxMembers(name))
        let cap = Math.Max(0, maximum - 1)
        let title = group ? "New group": remove ? "Remove conversation": contact ? "Add contact": "New conversation"
        let content = Container{Gap: 12, MinHeight: 0}
        let close Action = () -> {
            if busy {
                return
            }
            dialog = ""
            Rebuild()
        }
        if remove {
            content.Add(Label(ui, Hidden(ui.Privacy, conversation?.Title ?? ""), 14, ui.Ink, ""))
        } else {
            content.Add(
                Entry(
                    ui,
                    TextField{
                        Value: name,
                        Controlled: true,
                        Disabled: busy,
                        Placeholder: ui.Strings.Get("Name"),
                        AccessibilityName: ui.Strings.Get("Name"),
                        OnChange: value -> {
                            name = value
                            Rebuild()
                        }
                    }
                )
            )
            if !group {
                content.Add(
                    Entry(
                        ui,
                        TextField{
                            Value: address,
                            Controlled: true,
                            Disabled: busy,
                            Password: ui.Privacy,
                            Placeholder: ui.Strings.Get("Address"),
                            AccessibilityName: ui.Strings.Get("Address"),
                            OnChange: value -> {
                                address = value.Trim()
                                Rebuild()
                            }
                        }
                    )
                )
            }
            if !contact {
                let choices = Container{
                    MaxHeight: 200,
                    MinHeight: 0,
                    OverflowY: Overflow.Scroll,
                    ScrollbarY: Theme.Read().Scrollbar,
                    Gap: 3
                }
                for (label, destination) in input.Contacts {
                    if destination == input.Session.Messages.OwnAddress {
                        continue
                    }
                    let chosen = members.Contains(destination)
                    choices.Add(
                        Button(
                            ui,
                            (group ? (chosen ? "✓ ": ""): "") + Hidden(ui.Privacy, label),
                            () -> {
                                if group {
                                    if chosen {
                                        members.Remove(destination)
                                    } else {
                                        members.Add(destination)
                                    }
                                } else {
                                    name = label
                                    address = destination
                                }
                                Rebuild()
                            },
                            busy || group && !chosen && members.Count >= cap
                        )
                    )
                }
                content.Add(choices)
            }
            if group {
                content.Add(
                    Label(
                        ui,
                        (members.Count + 1).ToString() + "/" + maximum.ToString() + " " + ui.Strings.Get("members"),
                        12,
                        members.Count + 1 > maximum ? ui.Pink: ui.Dim,
                        ""
                    )
                )
            }
        }
        if issue.Length > 0 {
            content.Add(Label(ui, ui.Strings.Explain(issue), 12, ui.Pink, ""))
        }
        return WalletParts.Modal(
            ui,
            "message-dialog",
            ModalDialog{
                Open: true,
                Preset: ModalDialogPreset.Confirm,
                AccessibilityName: ui.Strings.Get(title),
                Width: 440,
                Content: content,
                ConfirmText: ui.Strings.Get(remove ? "Remove": group ? "Create": contact ? "Save": "Open"),
                CancelText: ui.Strings.Get("Cancel"),
                ConfirmDisabled: busy ||
                    (
                    !remove &&
                        (
                        group ? name.Trim()
                            .Length == 0 ||
                            members.Count == 0 ||
                            members.Count > cap: address.Length == 0 ||
                            contact &&
                            name
                            .Trim().Length == 0
                    )
                ),
                OnConfirm: () -> {
                    if remove && conversation != nil {
                        Run(
                            input,
                            ct -> input.Session.Messages.RemoveConversation(conversation, ct),
                            () -> {
                                input.State.ConversationId = ""
                                input.State.NewConversation = nil
                                close.Invoke()
                            }
                        )
                    } else if group {
                        Run(input, ct -> CreateGroup(input, ct), close)
                    } else if contact {
                        Run(
                            input,
                            ct -> SaveContact(input, ct),
                            () -> {
                                input.OnContacts()
                                close.Invoke()
                            }
                        )
                    } else {
                        Run(input, ct -> OpenConversation(input, ct), close)
                    }
                },
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private async func SaveContact(input MessagesInput, ct CancellationToken) {
        await input.Session.Messages.AddContact(name, address, ct)
    }

    private async func OpenConversation(input MessagesInput, ct CancellationToken) {
        let conversation = await input.Session.Messages.OpenConversation(name, address, ct)
        input.Ui.Actions.window?.TryPost(() -> Select(input, conversation))
    }

    private async func CreateGroup(input MessagesInput, ct CancellationToken) {
        let conversation = await input.Session.Messages.CreateGroup(name, members, ct)
        input.Ui.Actions.window?.TryPost(() -> Select(input, conversation))
    }

    private func Details(input MessagesInput, message Message) Blob {
        let ui = input.Ui
        let close Action = () -> {
            detail = nil
            Rebuild()
        }
        let verification = switch message.Verification {
            case Verification.Checking: "Checking"
            case Verification.Verified: "Verified"
            case Verification.Unverified: "Unverified"
            case Verification.Invalid: "Invalid"
        }
        let content = Container{
            Gap: 12,
            Label(ui, message.SentAt.ToLocalTime().ToString("g"), 12, ui.Dim, ""),
            Figure(
                ui,
                "fee",
                Hidden(ui.Privacy, (message.FeeAtomic / 100000000.0).ToString("0.00000000") + " BNT"),
                ui.Ink
            ),
            Figure(ui, "memos", message.Outputs.ToString(), ui.Ink),
            Figure(ui, "Confirmed", message.Confirmations.ToString() + "/10", ui.Ink),
            Label(
                ui,
                ui.Strings.Get(verification),
                12,
                message.Verification == Verification.Invalid ? ui.Pink: ui.Dim,
                ""
            ),
            Copyable(ui, "transaction", message.Txid, Hidden(ui.Privacy, Short(message.Txid)))
        }
        if !message.Outgoing &&
            message
            .SenderAddress
            .Length > 0 &&
            !input
            .Contacts
            .Values
            .Contains(message.SenderAddress) {
            content.Add(
                Button(
                    ui,
                    "Add contact",
                    () -> {
                        detail = nil
                        Begin("contact")
                        address = message.SenderAddress
                    }
                )
            )
        }
        content.Add(Button(ui, "Close", close))
        return WalletParts.Modal(
            ui,
            "message-details",
            ModalDialog{
                Open: true,
                AccessibilityName: ui.Strings.Get("Message details"),
                Width: 460,
                Content: content,
                OnClose: close
            }
        )
    }

    shared {
        func Preview(text string) string -> text.Replace("\r", " ").Replace("\n", " ")
    }
}
