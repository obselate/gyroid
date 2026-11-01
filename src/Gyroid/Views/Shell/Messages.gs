package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Gyroid.Components
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Linq

partial class App {
    private let messagesState MessagesViewState = MessagesViewState()
    private var messageOverlay MessageOverlay?
    private var messagesWallet string = ""
    private var messagesAddress string = ""
    private let configureMessages Action[MessagesPage]
    private let configureMessageOverlay Action[MessageOverlay]

    private func ObserveMessages() {
        let identity = wallet.Settings.ActiveWallet
        let address = wallet.Messages.OwnAddress
        if messagesWallet != identity || messagesAddress != address {
            messagesWallet = identity
            messagesAddress = address
            messagesState.ConversationId = ""
            messagesState.MessageId = ""
            messagesState.NewConversation = nil
            messagesState.Drafts.Clear()
        }
        messageOverlay?.Accept(MessageOverlayInput())
    }

    private func MessageOverlayInput() MessagesOverlayInput -> MessagesOverlayInput{
        Ui: ui,
        Session: wallet,
        Network: wallet.Messages.Network,
        Address: wallet.Messages.OwnAddress,
        Mode: wallet.Messages.Mode,
        Locked: wallet.Snapshot.State == WalletState.Locked,
        ViewOnly: wallet.Snapshot.ViewOnly,
        Working: ui.Working(),
        Error: wallet.Messages.Error,
        State: messagesState,
        Contacts: contacts,
        Width: width,
        Page: screen,
        WalletId: wallet.Settings.ActiveWallet,
        Revision: wallet.Messages.Revision,
        Privacy: ui.Privacy,
        Language: ui.Strings.Language,
        OnOpen: () -> Open(AppPage.Messages),
        OnContacts: () -> {
            LoadContacts()
            Rebuild()
        }
    }

    private func MessagesPageInput() MessagesInput -> MessagesInput{
        Ui: ui,
        Session: wallet,
        Wallet: wallet.Settings.ActiveWallet,
        Network: wallet.Messages.Network,
        Address: wallet.Messages.OwnAddress,
        Mode: wallet.Messages.Mode,
        Locked: wallet.Snapshot.State == WalletState.Locked,
        ViewOnly: wallet.Snapshot.ViewOnly,
        Working: ui.Working(),
        Error: wallet.Messages.Error,
        Request: messagesState.Request,
        State: messagesState,
        Contacts: contacts,
        Width: width - 122,
        Revision: wallet.Messages.Revision,
        Privacy: ui.Privacy,
        Language: ui.Strings.Language,
        OnOpen: () -> Open(AppPage.Messages),
        OnClose: () -> messageOverlay?.CloseDrawer(),
        OnContacts: () -> {
            LoadContacts()
            Rebuild()
        }
    }

    private func OpenMessage(txid string) {
        if let reference = wallet.Messages.Lookup(txid) {
            messagesState.ConversationId = reference.ConversationId
            messagesState.MessageId = reference.MessageId
            messagesState.Request++
            messageOverlay?.CloseDrawer()
            Open(AppPage.Messages)
        }
    }

    private func MessagesView() Blob -> Cell.Mount[MessagesPage]("messages", configureMessages)
}

data struct MessagesOverlayInput {
    var Ui Presentation
    var Session WalletSession
    var Network string
    var Address string
    var Mode MessengerMode
    var Locked bool
    var ViewOnly bool
    var Working bool
    var Error string
    var State MessagesViewState
    var Contacts SortedDictionary[string, string]
    var Width float64
    var Page AppPage
    var WalletId string
    var Revision int64
    var Privacy bool
    var Language string
    var OnOpen Action
    var OnContacts Action
}

class MessageOverlay : Cell, IDisposable {
    private var input MessagesOverlayInput
    private let observed HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private var toast Conversation?
    private var drawer bool
    private var timer WindowTimer?
    private var disposed bool
    private let configureDrawer Action[MessagesPage]

    prop IsDrawerOpen bool -> drawer

    init() {
        configureDrawer = child -> child.Accept(
            MessagesInput{
                Ui: input.Ui,
                Session: input.Session,
                Wallet: input.WalletId,
                Network: input.Network,
                Address: input.Address,
                Mode: input.Mode,
                Locked: input.Locked,
                ViewOnly: input.ViewOnly,
                Working: input.Working,
                Error: input.Error,
                Request: input.State.Request,
                State: input.State,
                Contacts: input.Contacts,
                Width: Math.Min(480.0, input.Width - 112),
                Drawer: true,
                Revision: input.Revision,
                Privacy: input.Privacy,
                Language: input.Language,
                OnOpen: input.OnOpen,
                OnClose: () -> CloseDrawer(),
                OnContacts: input.OnContacts
            }
        )
    }

    func Dispose() {
        disposed = true
        timer?.Dispose()
    }

    func CloseDrawer() {
        if disposed {
            return
        }
        if drawer || toast != nil {
            drawer = false
            toast = nil
            timer?.Dispose()
            timer = nil
            input.Session.Messages.ClearSelection()
            Rebuild()
        }
    }

    func Accept(next MessagesOverlayInput) {
        if disposed || next == input {
            return
        }
        let changedMessages = input.Revision != next.Revision
        let reset = input.WalletId != next.WalletId || input.Address != next.Address || input.Network != next.Network
        input = next
        let service = next.Session.Messages
        if reset {
            observed.Clear()
            CloseDrawer()
        }
        if reset || changedMessages {
            for conversation in service.Conversations {
                for message in conversation.Messages {
                    if observed.Add(message.Key) &&
                        !reset &&
                        !message.Outgoing &&
                        conversation.Unread > 0 &&
                        next.Page != AppPage.Messages &&
                        !drawer {
                        toast = conversation
                        timer?.Dispose()
                        timer = next
                            .Ui
                            .Actions
                            .Delay(
                            7000,
                            () -> {
                                toast = nil
                                Rebuild()
                            }
                        )
                    }
                }
            }
        }
        Rebuild()
    }

    override func Build() Blob {
        let ui = input.Ui
        if input.Page == AppPage.Messages {
            return Container{}
        }
        if drawer {
            return Container{
                Position: PositionType.Absolute,
                Right: 20,
                Top: 50,
                Bottom: 20,
                Width: Math.Min(480.0, input.Width - 112),
                ZIndex: 20,
                Cell.Mount[MessagesPage]("message-drawer", configureDrawer)
            }
        }
        let conversation = toast
        let latest = conversation?.Messages.LastOrDefault(item -> !item.Outgoing)
        let root = Container{
            Position: PositionType.Absolute,
            Right: 24,
            Bottom: 24,
            Width: Math.Min(360.0, input.Width - 132),
            ZIndex: 20
        }
        if conversation != nil && latest != nil {
            let notification = Goo
                .Button{
                BasedOn: AppTheme.InformationCardStyle,
                Gap: AppTheme.Space6,
                MinWidth: 0,
                AlignItems: AlignItems.Stretch,
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.Button,
                    Name: ui.Strings.Get("Reply") + " " + Hidden(ui.Privacy, conversation.Title)
                },
                OnClick: () -> {
                    input.State.ConversationId = conversation.Id
                    input.State.MessageId = ""
                    input.State.NewConversation = conversation
                    input.State.Request++
                    drawer = true
                    toast = nil
                    timer?.Dispose()
                    timer = nil
                },
                WalletParts.Header(
                    Grow(
                        Text{
                            Content: Hidden(ui.Privacy, conversation.Title),
                            FontFamily: AppTheme.Font,
                            FontSize: AppTheme.Type13,
                            Color: AppTheme.Ink,
                            TextWrap: TextWrap.Wrap,
                            MinWidth: 0
                        }
                    ),
                    AppTheme.Space8,
                    value: Container{
                        FlexShrink: 0,
                        Label(ui, ui.Strings.Get("Reply"), AppTheme.Type11, AppTheme.Lime, "")
                    },
                    leading: MaterialIcons.Create("chat_bubble", AppTheme.Icon16, AppTheme.Lime)
                ),
                MessageParts.Preview(ui, latest.Text, AppTheme.Type12, AppTheme.Body)
            }
            WidgetKeyBindings.BindActivation(notification)
            root.Add(notification)
        }
        return root
    }
}
