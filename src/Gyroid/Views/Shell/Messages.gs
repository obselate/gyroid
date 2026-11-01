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
    private let configureMessages Action[MessagesPage]
    private let configureMessageOverlay Action[MessageOverlay]

    private func ObserveMessages() {
        messagesState.Revision++
        messageOverlay?.Accept(MessageOverlayInput())
    }

    private func MessageOverlayInput() MessagesOverlayInput -> MessagesOverlayInput{
        Ui: ui,
        Session: wallet,
        State: messagesState,
        Contacts: contacts,
        Width: width,
        Page: screen,
        WalletId: wallet.Settings.ActiveWallet,
        Revision: messagesState.Revision,
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
        State: messagesState,
        Contacts: contacts,
        Width: width - 122,
        Revision: messagesState.Revision,
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
    private var walletId string = ""
    private var ownAddress string = ""
    private var toast Conversation?
    private var drawer bool
    private var timer WindowTimer?
    private var revision int64 = -1
    private var disposed bool
    private let configureDrawer Action[MessagesPage]

    prop IsDrawerOpen bool -> drawer

    init() {
        configureDrawer = child -> child.Accept(
            MessagesInput{
                Ui: input.Ui,
                Session: input.Session,
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
        if disposed {
            return
        }
        let changed = revision != next.Revision ||
            input.Width != next.Width ||
            input.Page != next.Page ||
            input.Privacy != next.Privacy ||
            input.Language != next.Language ||
            input.Contacts != next.Contacts
        input = next
        let service = next.Session.Messages
        let reset = walletId != next.WalletId || ownAddress != service.OwnAddress
        if reset {
            walletId = next.WalletId
            ownAddress = service.OwnAddress
            observed.Clear()
            CloseDrawer()
            next.State.ConversationId = ""
            next.State.MessageId = ""
            next.State.NewConversation = nil
            next.State.Drafts.Clear()
        }
        if reset || revision != next.Revision {
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
        revision = next.Revision
        if changed || reset {
            Rebuild()
        }
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
