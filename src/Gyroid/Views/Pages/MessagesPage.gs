package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
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
    var Wallet string
    var Network string
    var Address string
    var Mode MessengerMode
    var Locked bool
    var ViewOnly bool
    var Working bool
    var Error string
    var Request int64
    var State MessagesViewState
    var Contacts SortedDictionary[string, string]
    var Width float64
    var Drawer bool
    var OnOpen Action
    var OnClose Action
    var OnContacts Action
    var Revision int64
    var Privacy bool
    var Language string
}

class MessagesPage : Cell, IDisposable {
    private var input MessagesInput
    private var conversation Conversation?
    private var selected string = ""
    private var lifetime CancellationTokenSource?
    private var selection CancellationTokenSource?
    private var generation int64
    private var operationGeneration int64
    private var walletId string = ""
    private var ownAddress string = ""
    private var walletNetwork string = ""
    private var disposed bool
    private let configureThread Action[MessageThread]
    private let measureDraft Func[string, MessageEstimate]

    init() {
        measureDraft = text -> {
            if let current = conversation {
                return input.Session.Messages.Measure(current, text)
            }
            throw InvalidOperationException("No conversation selected")
        }
        configureThread = child -> child.Accept(
            MessageThreadInput{
                Ui: input.Ui,
                Conversation: conversation,
                Width: input.Drawer ? input.Width: input.Width - Math.Clamp(input.Width * 0.25, 200.0, 300.0),
                Revision: input.Revision,
                Privacy: input.Privacy,
                Language: input.Language,
                Request: input.State.Request,
                MessageId: input.State.MessageId,
                CanRetry: input.Mode == MessengerMode.Send && !busy && !input.Working,
                OnOpen: message -> {
                    detail = message
                    Rebuild()
                },
                OnRetry: message -> {
                    if let current = conversation {
                        let service = input.Session.Messages
                        Run(input, ct -> service.Resend(current, message, ct))
                    }
                }
            }
        )
    }

    func Accept(next MessagesInput) {
        if disposed || next == input {
            return
        }
        let reset = walletId != next.Wallet || ownAddress != next.Address || walletNetwork != next.Network
        if reset {
            walletId = next.Wallet
            ownAddress = next.Address
            walletNetwork = next.Network
            operationGeneration++
            busy = false
            issue = ""
            dialog = ""
            detail = nil
        }
        input = next
        let owner = lifetime ?? CancellationTokenSource.CreateLinkedTokenSource(
            next.Ui.Actions.window?.Closed ?? CancellationToken.None
        )
        lifetime = owner
        let current = next
            .Session
            .Messages
            .Conversations
            .FirstOrDefault(item -> item.Id == next.State.ConversationId) ??
            next
            .State
            .NewConversation
        conversation = current ?? (!next.Drawer ? next.Session.Messages.Conversations.FirstOrDefault(): nil)
        let id = conversation?.Id ?? ""
        if reset || id != selected {
            selected = id
            next.State.ConversationId = id
            detail = nil
            selection?.Cancel()
            selection?.Dispose()
            let active = CancellationTokenSource.CreateLinkedTokenSource(owner.Token)
            selection = active
            generation++
            if let value = conversation {
                let version = generation
                let token = active.Token
                let window = next.Ui.Actions.window
                go SelectThread(next, value, version, token, window)
            }
        }
        Rebuild()
    }

    private async func SelectThread(
        source MessagesInput,
        current Conversation,
        version int64,
        token CancellationToken,
        window Window?
    ) {
        let service = source.Session.Messages
        try {
            token.ThrowIfCancellationRequested()
            if source
                .Session
                .Settings
                .ActiveWallet != source.Wallet ||
                service.Network != source.Network ||
                service.OwnAddress != source.Address {
                return
            }
            await service.Select(current, token)
        } catch (failure OperationCanceledException) when token.IsCancellationRequested { } catch (failure Exception) {
            let error = failure.Message
            window?.TryPost(
                () -> {
                    if !disposed &&
                        version == generation &&
                        service.OwnAddress == ownAddress &&
                        service.Network == walletNetwork &&
                        input
                        .Session
                        .Settings
                        .ActiveWallet == walletId {
                        issue = error
                        Rebuild()
                    }
                }
            )
        }
    }
    private var detail Message?
    private var dialog string = ""
    private var address string = ""
    private var issue string = ""
    private var busy bool

    func Dispose() {
        disposed = true
        generation++
        operationGeneration++
        selection?.Cancel()
        selection?.Dispose()
        lifetime?.Cancel()
        lifetime?.Dispose()
    }

    private func Run(input MessagesInput, action Func[CancellationToken, Task]) {
        busy = true
        issue = ""
        operationGeneration++
        let version = operationGeneration
        let identity = ownAddress
        input.Ui.Actions.Background(ct -> Execute(input, action, version, identity, ct))
        Rebuild()
    }

    private async func Execute(
        input MessagesInput,
        action Func[CancellationToken, Task],
        version int64,
        identity string,
        ct CancellationToken
    ) {
        var error = ""
        try {
            await action(ct)
        } catch (failure Exception) when !(failure is OperationCanceledException) {
            error = failure.Message
        }
        input
            .Ui
            .Actions
            .window
            ?.TryPost(
            () -> {
                if disposed ||
                    version != operationGeneration ||
                    identity != ownAddress ||
                    input
                    .Session
                    .Settings
                    .ActiveWallet != walletId ||
                    input
                    .Session
                    .Messages
                    .Network != walletNetwork ||
                    input
                    .Session
                    .Messages
                    .OwnAddress != identity {
                    return
                }
                busy = false
                issue = error
                Rebuild()
            }
        )
    }

    private func Select(input MessagesInput, conversation Conversation) {
        input.State.ConversationId = conversation.Id
        input.State.MessageId = ""
        input.State.NewConversation = conversation
        input.State.Request++
        Accept(MessagesInput{... input, Request: input.State.Request})
    }

    override func Build() Blob {
        let ui = input.Ui
        let service = input.Session.Messages
        let conversations = service.Conversations
        let listWidth = Math.Clamp(input.Width * 0.25, 200.0, 300.0)
        let threadWidth = input.Drawer ? input.Width: input.Width - listWidth
        let root = Container{
            Width: Percent(100),
            Height: Percent(100),
            MinHeight: 0,
            MinWidth: 0,
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space12
        }
        if !input.Drawer {
            root.Add(
                Cell.Mount[MessagesListInput, MessageConversationList](
                    "conversations",
                    MessagesListInput{
                        Ui: ui,
                        Conversations: conversations,
                        Selected: selected,
                        Width: listWidth,
                        Busy: busy || input.Working,
                        CanSend: input.Mode == MessengerMode.Send,
                        Privacy: input.Privacy,
                        Language: input.Language,
                        Revision: input.Revision,
                        OnSelect: current -> Select(input, current),
                        OnBegin: kind -> Begin(kind)
                    }
                )
            )
        }
        let thread = WalletParts.Card(ui, AppTheme.Space0, AppTheme.Space0, AppTheme.Radius6)
        thread.FlexGrow = 1
        thread.FlexBasis = 0
        thread.MinWidth = 0
        thread.MinHeight = 0
        thread.Overflow = Overflow.Hidden
        if let current = conversation {
            thread.Add(Header(input, current))
            thread.Add(Cell.Mount[MessageThread]("thread:" + current.Id, configureThread))
            let draft = input.State.Drafts.GetValueOrDefault(current.Id, "")
            thread.Add(
                Cell.Mount[MessageComposerInput, MessageComposer](
                    "composer:" + current.Id,
                    MessageComposerInput{
                        Ui: ui,
                        Revision: input.Revision,
                        ConversationId: current.Id,
                        Recipients: current.Members.Count(member -> member != input.Address),
                        CanSend: input.Mode == MessengerMode.Send,
                        Unavailable: input.Locked ? "Wallet is locked":
                        input.ViewOnly ? "View-only wallet": "Node not connected",
                        Measure: measureDraft,
                        Privacy: input.Privacy,
                        Language: input.Language,
                        Draft: draft,
                        Width: threadWidth,
                        OnDraft: value -> {
                            input.State.Drafts[current.Id] = value
                        },
                        OnSend: text -> Run(input, ct -> service.Send(current, text, ct))
                    }
                )
            )
        } else {
            thread.Add(
                Container{
                    Padding: AppTheme.Space16,
                    Label(ui, ui.Strings.Get("messages"), AppTheme.Type17, AppTheme.Ink, "")
                }
            )
            thread.Add(
                Container{
                    FlexGrow: 1,
                    JustifyContent: JustifyContent.Center,
                    AlignItems: AlignItems.Center,
                    Label(ui, ui.Strings.Get("No conversations"), AppTheme.Type13, AppTheme.Dim, "")
                }
            )
        }
        let error = issue.Length > 0 ? issue: input.Error
        if error.Length > 0 {
            thread.Add(
                Container{
                    Padding: AppTheme.Space12,
                    FlexShrink: 0,
                    Text{
                        Content: ui.Strings.Explain(error),
                        FontFamily: AppTheme.Font,
                        FontSize: AppTheme.Type12,
                        Color: AppTheme.Pink,
                        TextWrap: TextWrap.Wrap
                    }
                }
            )
        }
        root.Add(thread)
        if dialog.Length > 0 {
            root.Add(
                Cell.Mount[MessageDialogInput, MessageDialog](
                    "message-dialog:" + dialog,
                    MessageDialogInput{
                        Ui: ui,
                        Session: input.Session,
                        Revision: input.Revision,
                        Working: input.Working,
                        WalletId: walletId,
                        Network: walletNetwork,
                        Contacts: input.Contacts,
                        Conversation: conversation,
                        Kind: dialog,
                        Address: address,
                        Privacy: input.Privacy,
                        Language: input.Language,
                        OnContacts: input.OnContacts,
                        OnSelect: current -> {
                            dialog = ""
                            if current == nil {
                                input.State.ConversationId = ""
                                input.State.NewConversation = nil
                                input.State.Request++
                                Accept(MessagesInput{... input, Request: input.State.Request})
                            } else {
                                Select(input, current)
                            }
                        },
                        OnClose: () -> {
                            dialog = ""
                            Rebuild()
                        }
                    }
                )
            )
        }
        if let message = detail {
            root.Add(
                Cell.Mount[MessageDetailsInput, MessageDetails](
                    "message-details",
                    MessageDetailsInput{
                        Ui: ui,
                        Message: message,
                        Revision: input.Revision,
                        Working: input.Working,
                        CanAddContact: !message.Outgoing &&
                            message
                            .SenderAddress
                            .Length > 0 &&
                            !input
                            .Contacts
                            .Values
                            .Contains(message.SenderAddress),
                        Privacy: input.Privacy,
                        Language: input.Language,
                        OnClose: () -> {
                            detail = nil
                            Rebuild()
                        },
                        OnContact: () -> {
                            detail = nil
                            Begin("contact")
                            address = message.SenderAddress
                        }
                    }
                )
            )
        }
        return root
    }

    private func Begin(kind string) {
        dialog = kind
        address = ""
        issue = ""
        Rebuild()
    }

    private func Header(input MessagesInput, conversation Conversation) Blob {
        let ui = input.Ui
        let header = WalletParts.Header(
            Grow(
                Container{
                    Gap: AppTheme.Space4,
                    MinWidth: 0,
                    Label(ui, Hidden(ui.Privacy, conversation.Title), AppTheme.Type16, AppTheme.Ink, ""),
                    Label(
                        ui,
                        Hidden(
                            ui.Privacy,
                            conversation.IsGroup ? (
                                conversation.Members.Count(member -> member != input.Address) + 1
                            ).ToString() + " " + ui.Strings.Get("members"): conversation.Handle
                        ),
                        AppTheme.Type11,
                        AppTheme.Dim,
                        ""
                    )
                }
            ),
            AppTheme.Space6
        )
        header.Padding = AppTheme.Space14
        header.BorderWidth = Edges{Bottom: AppTheme.Border1}
        header.BorderColor = AppTheme.Rule
        if !conversation.IsGroup && !input.Contacts.Values.Contains(conversation.Id) {
            header.Add(
                Icon(
                    ui,
                    MaterialIcons.Create("person_add", AppTheme.Icon16, AppTheme.Body),
                    ui.Strings.Get("Add contact"),
                    () -> {
                        Begin("contact")
                        address = conversation.Id
                    },
                    busy,
                    size: AppTheme.ControlCompact,
                    style: AppTheme.IconButtonStyle
                )
            )
        }
        header.Add(
            Icon(
                ui,
                MaterialIcons.Create("delete", AppTheme.Icon16, busy ? AppTheme.Dim: AppTheme.Body),
                ui.Strings.Get("Remove conversation"),
                () -> Begin("remove"),
                busy,
                size: AppTheme.ControlCompact,
                style: AppTheme.IconButtonStyle
            )
        )
        if input.Drawer {
            header.Add(
                Icon(
                    ui,
                    MaterialIcons.Create("open_in_full", AppTheme.Icon16, AppTheme.Body),
                    ui.Strings.Get("Open messages"),
                    input.OnOpen,
                    size: AppTheme.ControlCompact,
                    style: AppTheme.IconButtonStyle
                )
            )
            header.Add(
                Icon(
                    ui,
                    MaterialIcons.Create("close", AppTheme.Icon16, AppTheme.Body),
                    ui.Strings.Get("Close"),
                    input.OnClose,
                    size: AppTheme.ControlCompact,
                    style: AppTheme.IconButtonStyle
                )
            )
        }
        return header
    }

    shared {
        func Preview(text string) string -> text.Replace("\r", " ").Replace("\n", " ")
    }
}

data struct MessagesListInput {
    var Ui Presentation
    var Conversations IReadOnlyList[Conversation]
    var Selected string
    var Width float64
    var Busy bool
    var CanSend bool
    var Privacy bool
    var Language string
    var Revision int64
    var OnSelect Action[Conversation]
    var OnBegin Action[string]
}

class MessageConversationList : Cell[MessagesListInput] {
    protected override func Build(input MessagesListInput) Blob {
        let ui = input.Ui
        let panel = WalletParts.Card(ui, AppTheme.Space10, AppTheme.Space8, AppTheme.Radius6)
        panel.Width = input.Width
        panel.FlexShrink = 0
        panel.MinHeight = 0
        panel.Add(
            WalletParts.Header(
                Grow(Label(ui, ui.Strings.Get("messages"), AppTheme.Type17, AppTheme.Ink, "")),
                AppTheme.Space4,
                value: Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: AppTheme.Space4,
                    Icon(
                        ui,
                        MaterialIcons.Create("person_add", AppTheme.Icon16, AppTheme.Body),
                        ui.Strings.Get("New conversation"),
                        () -> input.OnBegin("direct"),
                        input.Busy,
                        size: AppTheme.ControlCompact,
                        style: AppTheme.IconButtonStyle
                    ),
                    Icon(
                        ui,
                        MaterialIcons.Create("group_add", AppTheme.Icon16, AppTheme.Body),
                        ui.Strings.Get("New group"),
                        () -> input.OnBegin("group"),
                        input.Busy || !input.CanSend,
                        size: AppTheme.ControlCompact,
                        style: AppTheme.IconButtonStyle
                    )
                }
            )
        )
        let list = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Theme.Read().Scrollbar
        }
        for conversation in input.Conversations {
            let latest = conversation.Messages.LastOrDefault()
            let row = Goo
                .Button{
                BasedOn: AppTheme.ListRowStyle,
                FlexDirection: FlexDirection.Column,
                Key: conversation.Id,
                Width: Percent(100),
                AlignItems: AlignItems.Stretch,
                Padding: Edges{
                    Top: AppTheme.Space14,
                    Bottom: AppTheme.Space14,
                    Left: AppTheme.Space8,
                    Right: AppTheme.Space8
                },
                FlexShrink: 0,
                MinWidth: 0,
                Gap: AppTheme.Space6,
                BackgroundColor: conversation.Id == input.Selected ? AppTheme.LimeQuiet: Color.Transparent,
                Hover: Style{BackgroundColor: AppTheme.Rule},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.Button,
                    Name: Hidden(ui.Privacy, conversation.Title) +
                        (conversation.Unread > 0 ? " " + conversation.Unread.ToString(): ""),
                    Selected: conversation.Id == input.Selected
                },
                OnClick: () -> input.OnSelect(conversation),
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space8,
                    MaterialIcons.Create(
                        conversation.IsGroup ? "group": "person",
                        AppTheme.Icon16,
                        conversation.Unread > 0 ? AppTheme.Lime: AppTheme.Dim
                    ),
                    Grow(
                        Label(
                            ui,
                            Hidden(ui.Privacy, conversation.Title),
                            AppTheme.Type13,
                            conversation.Id == input.Selected ? AppTheme.Lime: AppTheme.Ink,
                            ""
                        )
                    ),
                    Label(ui, latest?.SentAt.ToLocalTime().ToString("HH:mm") ?? "", AppTheme.Type10, AppTheme.Dim, "")
                },
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: AppTheme.Space8,
                    Padding: Edges{Left: AppTheme.Space22},
                    MinWidth: 0,
                    Grow(MessageParts.Preview(ui, latest?.Text ?? conversation.Handle, AppTheme.Type11, AppTheme.Dim)),
                    Label(
                        ui,
                        conversation.Unread > 0 ? conversation.Unread.ToString(): "",
                        AppTheme.Type11,
                        AppTheme.Lime,
                        ""
                    )
                }
            }
            WidgetKeyBindings.BindActivation(row)
            list.Add(row)
        }
        panel.Add(ListParts.Viewport(list))
        return panel
    }
}

data struct MessageThreadInput {
    var Ui Presentation
    var Conversation Conversation?
    var Width float64
    var Revision int64
    var Privacy bool
    var Language string
    var Request int64
    var MessageId string
    var CanRetry bool
    var OnOpen Action[Message]
    var OnRetry Action[Message]
}

class MessageThread : Cell, IDisposable {
    private var input MessageThreadInput
    private var request int64 = -1
    private var highlight string = ""
    private var lastMessage string = ""
    private var initialized bool
    private var following bool = true
    private let seen HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private var previousMessages IReadOnlyList[Message] = Array.Empty[Message]()
    private let messageKeys Dictionary[string, string] = Dictionary[string, string](StringComparer.Ordinal)
    private let handles Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle](StringComparer.Ordinal)
    private let scroll ElementHandle = ElementHandle()
    private var scrollTimer WindowTimer?
    private var highlightTimer WindowTimer?

    func Dispose() {
        scrollTimer?.Dispose()
        highlightTimer?.Dispose()
    }

    func Accept(next MessageThreadInput) {
        if next == input {
            return
        }
        let latest = next.Conversation?.Messages.LastOrDefault()?.Key ?? ""
        following = scroll.ScrollRange.Y - scroll.ScrollOffset.Y < AppTheme.Space16
        input = next
        if !initialized || request != next.Request {
            highlight = next.MessageId
            highlightTimer?.Dispose()
            highlightTimer = nil
            if highlight.Length > 0 {
                highlightTimer = next
                    .Ui
                    .Actions
                    .Delay(
                    1800,
                    () -> {
                        highlight = ""
                        Rebuild()
                    }
                )
            }
            Scroll(next.MessageId)
        } else if latest != lastMessage && following {
            Scroll("")
        }
        request = next.Request
        lastMessage = latest
        Rebuild()
    }

    private func Scroll(key string) {
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

    override func Build() Blob {
        let ui = input.Ui
        let current = input.Conversation
        let rows = Container{
            Handle: scroll,
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            MinWidth: 0,
            Padding: Edges{Left: AppTheme.Space16, Right: AppTheme.Space16, Bottom: AppTheme.Space16},
            OverflowY: Overflow.Scroll,
            OverflowX: Overflow.Hidden,
            ScrollbarY: Theme.Read().Scrollbar
        }
        if current == nil {
            return rows
        }
        let messages = current.Messages
        for message in previousMessages {
            if message.Txid.Length > 0 {
                seen.Add(message.Txid)
                messageKeys.TryAdd(message.Txid, message.Key)
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
                        Margin: Edges{Top: AppTheme.Space14},
                        Label(ui, message.SentAt.ToLocalTime().ToString("HH:mm"), AppTheme.Type10, AppTheme.Dim, "")
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
                        Revision: input.Revision,
                        Privacy: input.Privacy,
                        Language: input.Language,
                        Group: current.IsGroup,
                        First: first,
                        Last: last,
                        Animate: added && newTransaction && initialized && ui.Actions.playbackActive(),
                        Highlight: highlight == message.Key,
                        CanRetry: message.State == MessageState.Failed && input.CanRetry,
                        Width: input.Width,
                        Handle: handles[message.Key],
                        OnOpen: input.OnOpen,
                        OnRetry: input.OnRetry
                    }
                )
            )
        }
        initialized = true
        previousMessages = messages
        return rows
    }
}

data struct MessageDialogInput {
    var Ui Presentation
    var Session WalletSession
    var Contacts SortedDictionary[string, string]
    var Conversation Conversation?
    var Kind string
    var WalletId string
    var Network string
    var Address string
    var Privacy bool
    var Language string
    var Revision int64
    var Working bool
    var OnContacts Action
    var OnSelect Action[Conversation?]
    var OnClose Action
}

class MessageDialog : Cell[MessageDialogInput], IDisposable {
    private var name string = ""
    private var address string = ""
    private var initialized bool
    private var busy bool
    private var issue string = ""
    private let members List[string] = List[string]()
    private var lifetime CancellationTokenSource?
    private var generation int64
    private var disposed bool

    func Dispose() {
        disposed = true
        generation++
        lifetime?.Cancel()
        lifetime?.Dispose()
    }

    private func Submit(input MessageDialogInput) {
        if busy {
            return
        }
        busy = true
        issue = ""
        let owner = lifetime ?? CancellationTokenSource.CreateLinkedTokenSource(
            input.Ui.Actions.window?.Closed ?? CancellationToken.None
        )
        lifetime = owner
        generation++
        let title = name
        let destination = address
        let recipients = List[string](members)
        let identity = input.Session.Messages.OwnAddress
        let version = generation
        let observer = owner.Token
        input
            .Ui
            .Actions
            .Background(ct -> Execute(input, title, destination, recipients, version, identity, observer, ct))
        Rebuild()
    }

    private async func Execute(
        input MessageDialogInput,
        title string,
        destination string,
        recipients List[string],
        version int64,
        identity string,
        observer CancellationToken,
        token CancellationToken
    ) {
        var result Conversation?
        var error = ""
        let service = input.Session.Messages
        try {
            token.ThrowIfCancellationRequested()
            if input.Kind == "remove" {
                if let current = input.Conversation {
                    await service.RemoveConversation(current, token)
                }
            } else if input.Kind == "group" {
                result = await service.CreateGroup(title, recipients, token)
            } else if input.Kind == "contact" {
                result = await service.AddContact(title, destination, token)
            } else {
                result = await service.OpenConversation(title, destination, token)
            }
        } catch (failure Exception) when !(failure is OperationCanceledException) {
            error = failure.Message
        }
        input
            .Ui
            .Actions
            .window
            ?.TryPost(
            () -> {
                if disposed ||
                    observer.IsCancellationRequested ||
                    version != generation ||
                    service.OwnAddress != identity ||
                    service.Network != input.Network ||
                    input
                    .Session
                    .Settings
                    .ActiveWallet != input.WalletId {
                    return
                }
                busy = false
                issue = error
                if error.Length == 0 {
                    if input.Kind == "contact" {
                        input.OnContacts()
                        input.OnClose()
                    } else {
                        input.OnSelect(result)
                    }
                } else {
                    Rebuild()
                }
            }
        )
    }

    protected override func Build(input MessageDialogInput) Blob {
        if !initialized {
            initialized = true
            address = input.Address
        }
        let ui = input.Ui
        let group = input.Kind == "group"
        let remove = input.Kind == "remove"
        let contact = input.Kind == "contact"
        let maximum = Math.Max(0, Wire.MaxMembers(name))
        let cap = Math.Max(0, maximum - 1)
        let title = group ? "New group": remove ? "Remove conversation": contact ? "Add contact": "New conversation"
        let content = Container{Gap: AppTheme.Space12, MinHeight: 0}
        let form = WalletForm(ui, !busy, nil, []string{}, () -> Rebuild())
        let close Action = () -> {
            if busy {
                return
            }
            input.OnClose()
        }
        if remove {
            content.Add(
                Label(ui, Hidden(ui.Privacy, input.Conversation?.Title ?? ""), AppTheme.Type14, AppTheme.Ink, "")
            )
        } else {
            content.Add(
                form.Field(
                    "Name",
                    name,
                    value -> name = value,
                    disabled: busy,
                    labelled: false,
                    placeholder: ui.Strings.Get("Name"),
                    inheritDirection: true
                )
            )
            if !group {
                content.Add(
                    form.Field(
                        "Address",
                        address,
                        value -> address = value.Trim(),
                        disabled: busy,
                        labelled: false,
                        hidden: ui.Privacy,
                        placeholder: ui.Strings.Get("Address"),
                        inheritDirection: true
                    )
                )
            }
            if !contact {
                let choices = Container{
                    MaxHeight: 200,
                    MinHeight: 0,
                    OverflowY: Overflow.Scroll,
                    ScrollbarY: Theme.Read().Scrollbar,
                    Gap: AppTheme.Space4
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
                        AppTheme.Type12,
                        members.Count + 1 > maximum ? AppTheme.Pink: AppTheme.Dim,
                        ""
                    )
                )
            }
        }
        if issue.Length > 0 {
            content.Add(MessageParts.Problem(ui, issue))
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
                OnConfirm: () -> Submit(input),
                OnCancel: close,
                OnClose: close
            }
        )
    }
}

data struct MessageDetailsInput {
    var Ui Presentation
    var Message Message
    var CanAddContact bool
    var Privacy bool
    var Language string
    var Revision int64
    var Working bool
    var OnClose Action
    var OnContact Action
}

class MessageDetails : Cell[MessageDetailsInput] {
    protected override func Build(input MessageDetailsInput) Blob {
        let message = input.Message
        let ui = input.Ui
        let close = input.OnClose
        let verification = message.Verification.ToString()
        let content = Container{
            Gap: AppTheme.Space12,
            Label(ui, message.SentAt.ToLocalTime().ToString("g"), AppTheme.Type12, AppTheme.Dim, ""),
            Figure(ui, "fee", Amount(ui.Privacy, uint64(message.FeeAtomic)) + " BNT", AppTheme.Ink),
            Figure(ui, "memos", message.Outputs.ToString(), AppTheme.Ink),
            Figure(ui, "Confirmed", message.Confirmations.ToString() + "/10", AppTheme.Ink),
            Label(
                ui,
                ui.Strings.Get(verification),
                AppTheme.Type12,
                message.Verification == Verification.Invalid ? AppTheme.Pink: AppTheme.Dim,
                ""
            ),
            Copyable(ui, "transaction", message.Txid, Hidden(ui.Privacy, Short(message.Txid)))
        }
        if input.CanAddContact {
            content.Add(Button(ui, "Add contact", input.OnContact))
        }
        return WalletParts.Modal(
            ui,
            "message-details",
            ModalDialog{
                Open: true,
                AccessibilityName: ui.Strings.Get("Message details"),
                Width: 460,
                Content: content,
                Footer: Button(ui, "Close", close),
                OnCancel: close,
                OnClose: close
            }
        )
    }
}
