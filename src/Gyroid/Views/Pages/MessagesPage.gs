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
    private var selection CancellationTokenSource?
    private var generation int64
    private var operationGeneration int64
    private let configureThread Action[MessageThread]
    private let configureList Action[MessageConversationList]
    private let configureComposer Action[MessageComposer]
    private let measureDraft Func[string, MessageEstimate]
    private var threadWidth float64
    private var listWidth float64
    private var projection MessagesProjection

    init() {
        projection = MessagesProjection{Conversations: []ConversationView{}, Thread: []MessageThreadRow{}}
        measureDraft = text -> input
            .Session
            .Messages
            .Measure(conversation ?? throw InvalidOperationException("No conversation selected"), text)
        configureThread = child -> child.Accept(
            MessageThreadInput{
                Ui: input.Ui,
                Conversation: conversation,
                Rows: projection.Thread,
                Width: threadWidth,
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
        configureList = child -> child.Accept(
            MessagesListInput{
                Ui: input.Ui,
                Conversations: projection.Conversations,
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
        configureComposer = child -> {
            if let current = conversation {
                child.Accept(
                    MessageComposerInput{
                        Ui: input.Ui,
                        Revision: input.Revision,
                        Recipients: projection.Recipients,
                        CanSend: input.Mode == MessengerMode.Send,
                        Unavailable: input.Locked ? "Wallet is locked":
                        input.ViewOnly ? "View-only wallet": "Node not connected",
                        Measure: measureDraft,
                        Language: input.Language,
                        Draft: input.State.Drafts.GetValueOrDefault(current.Id, ""),
                        Width: threadWidth,
                        OnDraft: value -> input.State.Drafts[selected] = value,
                        OnSend: text -> {
                            if let current = conversation {
                                let service = input.Session.Messages
                                Run(input, ct -> service.Send(current, text, ct))
                            }
                        }
                    }
                )
            }
        }
    }

    func Accept(next MessagesInput) {
        if next == input {
            return
        }
        let reset = input.Wallet != next.Wallet || input.Address != next.Address || input.Network != next.Network
        let prepare = reset ||
            input.Revision != next.Revision ||
            input.Request != next.Request ||
            input.Drawer != next.Drawer ||
            input.Privacy != next.Privacy ||
            input.Language != next.Language ||
            input.Contacts != next.Contacts ||
            conversation == nil
        if reset {
            operationGeneration++
            busy = false
            issue = ""
            dialog = ""
            detail = nil
            projection = MessagesProjection{Conversations: []ConversationView{}, Thread: []MessageThreadRow{}}
            conversation = nil
            selected = ""
        }
        input = next
        listWidth = Math.Clamp(next.Width * 0.25, 200.0, 300.0)
        threadWidth = next.Drawer ? next.Width: next.Width - listWidth - AppTheme.Space12
        if prepare {
            selection?.Cancel()
            selection?.Dispose()
            let active = CancellationTokenSource.CreateLinkedTokenSource(
                next.Ui.Actions.window?.Closed ?? CancellationToken.None
            )
            selection = active
            generation++
            let version = generation
            let token = active.Token
            let window = next.Ui.Actions.window
            let id = next.State.ConversationId
            let fallback = next.State.NewConversation
            let previous = projection
            go PrepareView(next, id, fallback, previous, version, token, window)
        }
        Rebuild()
    }

    private func PrepareView(
        source MessagesInput,
        id string,
        fallback Conversation?,
        previous MessagesProjection,
        version int64,
        token CancellationToken,
        window Window?
    ) {
        try {
            let result = source
                .Session
                .Messages
                .Project(
                id,
                fallback,
                !source.Drawer,
                previous,
                source.Privacy,
                source.Language,
                source.Contacts,
                token
            )
            window?.TryPost(
                () -> {
                    if version != generation || token.IsCancellationRequested {
                        return
                    }
                    projection = result
                    conversation = result.Conversation
                    let currentId = conversation?.Id ?? ""
                    if currentId != selected {
                        selected = currentId
                        input.State.ConversationId = currentId
                        detail = nil
                        if let current = conversation {
                            let request = input
                            input.Ui.Actions.Background(ct -> SelectThread(request, current, version, ct, window))
                        }
                    }
                    Rebuild()
                }
            )
        } catch (failure OperationCanceledException) when token.IsCancellationRequested { } catch (failure Exception) {
            let error = failure.Message
            window?.TryPost(
                () -> {
                    if version == generation {
                        issue = error
                        Rebuild()
                    }
                }
            )
        }
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
                    if version == generation &&
                        service.OwnAddress == input.Address &&
                        service.Network == input.Network &&
                        input
                        .Session
                        .Settings
                        .ActiveWallet == input.Wallet {
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
        generation++
        operationGeneration++
        selection?.Cancel()
        selection?.Dispose()
    }

    private func Run(input MessagesInput, action Func[CancellationToken, Task]) {
        busy = true
        issue = ""
        operationGeneration++
        let version = operationGeneration
        input.Ui.Actions.Background(ct -> Execute(input, action, version, ct))
        Rebuild()
    }

    private async func Execute(
        input MessagesInput,
        action Func[CancellationToken, Task],
        version int64,
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
                if version != operationGeneration ||
                    input
                    .Session
                    .Settings
                    .ActiveWallet != input.Wallet ||
                    input
                    .Session
                    .Messages
                    .Network != input.Network ||
                    input
                    .Session
                    .Messages
                    .OwnAddress != input.Address {
                    return
                }
                busy = false
                issue = error
                Rebuild()
            }
        )
    }

    private func Select(input MessagesInput, conversation Conversation?) {
        input.State.ConversationId = conversation?.Id ?? ""
        input.State.MessageId = ""
        input.State.NewConversation = conversation
        input.State.Request++
        Accept(MessagesInput{... input, Request: input.State.Request})
    }

    override func Build() Blob {
        let ui = input.Ui
        let root = Container{
            Width: Percent(100),
            Height: Percent(100),
            MinHeight: 0,
            MinWidth: 0,
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space12
        }
        if !input.Drawer {
            root.Add(Cell.Mount[MessageConversationList]("conversations", configureList))
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
            thread.Add(Cell.Mount[MessageComposer]("composer:" + current.Id, configureComposer))
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
                Cell.Mount[MessageDialog](
                    "message-dialog:" + dialog,
                    child -> child.Accept(
                        MessageDialogInput{
                            Ui: input.Ui,
                            Session: input.Session,
                            Revision: input.Revision,
                            WalletId: input.Wallet,
                            Network: input.Network,
                            Contacts: input.Contacts,
                            Conversation: conversation,
                            Kind: dialog,
                            Address: address,
                            Privacy: input.Privacy,
                            Language: input.Language,
                            OnContacts: input.OnContacts,
                            OnSelect: current -> {
                                dialog = ""
                                Select(input, current)
                            },
                            OnClose: () -> {
                                dialog = ""
                                Rebuild()
                            }
                        }
                    )
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
                        CanAddContact: !message.Outgoing &&
                            message
                            .SenderAddress
                            .Length > 0 &&
                            !projection
                            .Contacts
                            .Contains(message.SenderAddress),
                        Privacy: input.Privacy,
                        Language: input.Language,
                        OnClose: () -> {
                            detail = nil
                            Rebuild()
                        },
                        OnContact: () -> {
                            Begin("contact")
                            address = detail?.SenderAddress ?? ""
                            detail = nil
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
                            conversation.IsGroup ? (projection.Recipients + 1).ToString() + " " + ui.Strings.Get(
                                "members"
                            ): conversation.Handle
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
        if !conversation.IsGroup && !projection.Contacts.Contains(conversation.Id) {
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
    var Conversations[]ConversationView
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

class MessageConversationList : Cell {
    private var input MessagesListInput
    private let rowKey Func[ConversationView, string]
    private let rowBuilder Func[ConversationView, Blob]

    init() {
        rowKey = row -> row.Id
        rowBuilder = row -> Row(row)
    }

    func Accept(next MessagesListInput) {
        if input == next {
            return
        }
        input = next
        Rebuild()
    }

    override func Build() Blob {
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
        let list = VirtualRows(input.Conversations, 72, rowKey, rowBuilder, false)
        list.MinHeight = 0
        list.FlexGrow = 1
        list.FlexBasis = 0
        panel.Add(ListParts.Viewport(list))
        return panel
    }

    private func Row(conversation ConversationView) Blob {
        let ui = input.Ui
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
            BackgroundColor: conversation.Selected ? AppTheme.LimeQuiet: Color.Transparent,
            Hover: Style{BackgroundColor: AppTheme.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: Hidden(conversation.Privacy, conversation.Title) +
                    (conversation.Unread > 0 ? " " + conversation.Unread.ToString(): ""),
                Selected: conversation.Selected
            },
            OnClick: () -> input.OnSelect(conversation.Source),
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
                        Hidden(conversation.Privacy, conversation.Title),
                        AppTheme.Type13,
                        conversation.Selected ? AppTheme.Lime: AppTheme.Ink,
                        ""
                    )
                ),
                Label(ui, conversation.Time, AppTheme.Type10, AppTheme.Dim, "")
            },
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: AppTheme.Space8,
                Padding: Edges{Left: AppTheme.Space22},
                MinWidth: 0,
                Grow(
                    Label(
                        ui,
                        Hidden(
                            conversation.Privacy,
                            MessageParts.Content(ui, conversation.Text, conversation.InvitationName)
                        ),
                        AppTheme.Type11,
                        AppTheme.Dim,
                        ""
                    )
                ),
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
        return row
    }
}

data struct MessageThreadInput {
    var Ui Presentation
    var Conversation Conversation?
    var Rows[]MessageThreadRow
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

data struct MessageDisplayRow {
    var Key string
    var Time string
    var Bubble MessageBubbleInput
}

class MessageThread : Cell, IDisposable {
    private var input MessageThreadInput
    private var rows[]MessageDisplayRow = []MessageDisplayRow{}
    private var seen HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private var arrivals HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private var following bool = true
    private var generation int64
    private var lifetime CancellationTokenSource?
    private let scroll ElementHandle = ElementHandle()
    private let rowKey Func[MessageDisplayRow, string]
    private let rowBuilder Func[MessageDisplayRow, Blob]
    private var scrollTimer WindowTimer?
    private var highlightTimer WindowTimer?
    private var highlight string = ""
    private var jumpKey string = ""
    private var jumpRequested bool

    init() {
        rowKey = row -> row.Key
        rowBuilder = row -> Row(row)
        scroll.MetricsChanged += metrics -> {
            following = metrics.ScrollRange.Y - metrics.ScrollOffset.Y < AppTheme.Space16
        }
    }

    func Dispose() {
        generation++
        lifetime?.Cancel()
        lifetime?.Dispose()
        scrollTimer?.Dispose()
        highlightTimer?.Dispose()
    }

    func Accept(next MessageThreadInput) {
        if next == input {
            return
        }
        let jump = input.Request != next.Request || input.Conversation?.Id != next.Conversation?.Id
        input = next
        if jump {
            jumpRequested = true
            highlight = next.MessageId
            highlightTimer?.Dispose()
            if highlight.Length > 0 {
                highlightTimer = next
                    .Ui
                    .Actions
                    .Delay(
                    1800,
                    () -> {
                        highlight = ""
                        Refresh()
                    }
                )
            }
        }
        Refresh()
    }

    private func Refresh() {
        if let window = input.Ui.Actions.window {
            let active = lifetime ?? CancellationTokenSource.CreateLinkedTokenSource(window.Closed)
            lifetime = active
            generation++
            let source = input
            let version = generation
            let token = active.Token
            let previous = seen
            let oldRows = rows
            let follow = following
            let selected = highlight
            go PrepareRows(source, previous, oldRows, follow, selected, version, token, window)
        }
    }

    private func PrepareRows(
        source MessageThreadInput,
        previous HashSet[string],
        oldRows[]MessageDisplayRow,
        follow bool,
        selected string,
        version int64,
        token CancellationToken,
        window Window
    ) {
        try {
            let prepared = List[MessageDisplayRow]()
            let accepted = HashSet[string](previous, StringComparer.Ordinal)
            let added = HashSet[string](StringComparer.Ordinal)
            var selectedKey = ""
            for row in source.Rows {
                if selected == row.Key || selected == row.Message.Key {
                    selectedKey = row.Key
                }
                token.ThrowIfCancellationRequested()
                let fresh = accepted.Add(row.Key)
                if fresh && previous.Count > 0 && follow {
                    added.Add(row.Key)
                }
                if row.Header.Length > 0 {
                    prepared.Add(MessageDisplayRow{Key: "time:" + row.Key, Time: row.Header})
                }
                prepared.Add(
                    MessageDisplayRow{
                        Key: row.Key,
                        Time: "",
                        Bubble: MessageBubbleInput{
                            Ui: source.Ui,
                            Message: row.Message,
                            Privacy: source.Privacy,
                            Language: source.Language,
                            Group: source.Conversation?.IsGroup ?? false,
                            First: row.First,
                            Last: row.Last,
                            Highlight: selected == row.Message.Key || selected == row.Key,
                            CanRetry: source.CanRetry,
                            Width: source.Width,
                            OnOpen: source.OnOpen,
                            OnRetry: source.OnRetry
                        }
                    }
                )
            }
            let result = prepared.SequenceEqual(oldRows) ? oldRows: prepared.ToArray()
            window.TryPost(
                () -> {
                    if version != generation || token.IsCancellationRequested {
                        return
                    }
                    rows = result
                    seen = accepted
                    jumpKey = selectedKey
                    arrivals = added
                    Rebuild()
                    if jumpRequested {
                        jumpRequested = false
                        Scroll(highlight)
                    }
                }
            )
        } catch (error OperationCanceledException) when token.IsCancellationRequested { }
    }

    private func Scroll(key string) {
        scrollTimer?.Dispose()
        scrollTimer = input
            .Ui
            .Actions
            .Delay(
            0,
            () -> {
                if key.Length > 0 {
                    if jumpKey.Length > 0 {
                        scroll.ScrollToItem(jumpKey)
                    }
                } else if following {
                    scroll.JumpTo(0, scroll.ScrollRange.Y)
                }
            }
        )
    }

    private func Row(row MessageDisplayRow) Blob {
        if row.Time.Length > 0 {
            return Container{
                AlignItems: AlignItems.Center,
                Margin: Edges{Top: AppTheme.Space14},
                Label(input.Ui, row.Time, AppTheme.Type10, AppTheme.Dim, "")
            }
        }
        let animate = arrivals.Remove(row.Key) && input.Ui.Actions.playbackActive()
        return Cell.Mount[MessageBubbleInput, MessageBubble](row.Key, row.Bubble with{Animate = animate})
    }

    override func Build() Blob {
        let list = VirtualRows(rows, 64, rowKey, rowBuilder, following)
        list.Handle = scroll
        list.MinHeight = 0
        list.FlexGrow = 1
        list.FlexBasis = 0
        list.MinWidth = 0
        list.Padding = Edges{Left: AppTheme.Space16, Right: AppTheme.Space16, Bottom: AppTheme.Space16}
        return ListParts.Viewport(list)
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
    var OnContacts Action
    var OnSelect Action[Conversation?]
    var OnClose Action
}

class MessageDialog : Cell, IDisposable {
    private var name string = ""
    private var address string = ""
    private var initialized bool
    private var busy bool
    private var issue string = ""
    private let members List[string] = List[string]()
    private var generation int64
    private var input MessageDialogInput
    private var contacts[]MessageContactView = []MessageContactView{}
    private var contactGeneration int64
    private var lifetime CancellationTokenSource?
    private let rowKey Func[MessageContactView, string]
    private let rowBuilder Func[MessageContactView, Blob]

    init() {
        rowKey = row -> row.Name
        rowBuilder = row -> Button(
            input.Ui,
            (input.Kind == "group" && row.Chosen ? "✓ ": "") + Hidden(row.Privacy, row.Name),
            () -> {
                if input.Kind == "group" {
                    if members.Contains(row.Destination) {
                        members.Remove(row.Destination)
                    } else if members.Count < Math.Max(0, Wire.MaxMembers(name) - 1) {
                        members.Add(row.Destination)
                    }
                } else {
                    name = row.Name
                    address = row.Destination
                }
                RefreshContacts()
                Rebuild()
            },
            row.Disabled
        )
    }

    func Accept(next MessageDialogInput) {
        if next == input {
            return
        }
        input = next
        if !initialized {
            initialized = true
            address = next.Address
        }
        RefreshContacts()
        Rebuild()
    }

    private func RefreshContacts() {
        if let window = input.Ui.Actions.window {
            let active = lifetime ?? CancellationTokenSource.CreateLinkedTokenSource(window.Closed)
            lifetime = active
            contactGeneration++
            let source = input
            let selected = members.ToArray()
            let cap = Math.Max(0, Wire.MaxMembers(name) - 1)
            let working = busy
            let version = contactGeneration
            let token = active.Token
            let previous = contacts
            go PrepareContacts(source, selected, cap, working, version, token, window, previous)
        }
    }

    private func PrepareContacts(
        source MessageDialogInput,
        selected[]string,
        cap int32,
        working bool,
        version int64,
        token CancellationToken,
        window Window,
        previous[]MessageContactView
    ) {
        try {
            let result = source
                .Session
                .Messages
                .PrepareContacts(
                source.Contacts,
                selected,
                cap,
                source.Kind == "group",
                working,
                source.Privacy,
                source.Language,
                token
            )
            let rows = result.SequenceEqual(previous) ? previous: result
            window.TryPost(
                () -> {
                    if version == contactGeneration && !token.IsCancellationRequested {
                        contacts = rows
                        Rebuild()
                    }
                }
            )
        } catch (error OperationCanceledException) when token.IsCancellationRequested { } catch (error Exception) {
            let message = error.Message
            window.TryPost(
                () -> {
                    if version == contactGeneration {
                        issue = message
                        Rebuild()
                    }
                }
            )
        }
    }

    func Dispose() {
        generation++
        contactGeneration++
        lifetime?.Cancel()
        lifetime?.Dispose()
    }

    private func Submit(input MessageDialogInput) {
        if busy {
            return
        }
        busy = true
        RefreshContacts()
        issue = ""
        generation++
        let title = name
        let destination = address
        let recipients = List[string](members)
        let identity = input.Session.Messages.OwnAddress
        let version = generation
        input.Ui.Actions.Background(ct -> Execute(input, title, destination, recipients, version, identity, ct))
        Rebuild()
    }

    private async func Execute(
        input MessageDialogInput,
        title string,
        destination string,
        recipients List[string],
        version int64,
        identity string,
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
                if version != generation ||
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

    override func Build() Blob {
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
                    value -> {
                        name = value
                        RefreshContacts()
                    },
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
                let choices = VirtualRows(contacts, 36, rowKey, rowBuilder, false)
                choices.Height = Math.Min(200, contacts.Length * 36)
                choices.MinHeight = 0
                choices.FlexShrink = 1
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
            Figure(ui, "Confirmed", Math.Clamp(message.Confirmations, 0, 10).ToString() + "/10", AppTheme.Ink),
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
