package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Gyroid.Components
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Linq

partial class App {
    private let messagesState MessagesViewState = MessagesViewState()
    private let observedMessages HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private var messagesWallet string = ""
    private var messageToast Conversation?
    private var messageDrawer bool
    private var messageToastTimer WindowTimer?

    private func ObserveMessages() {
        let service = wallet.Messages
        let reset = messagesWallet != service.OwnAddress || wallet.Settings.ActiveWallet != lastWallet
        if reset {
            messagesWallet = service.OwnAddress
            observedMessages.Clear()
            messageToast = nil
            messageDrawer = false
            messagesState.ConversationId = ""
            messagesState.NewConversation = nil
            messagesState.Drafts.Clear()
        }
        for conversation in service.Conversations {
            for message in conversation.Messages {
                if observedMessages.Add(message.Key) &&
                    !reset &&
                    !message.Outgoing &&
                    conversation.Unread > 0 &&
                    screen != AppPage.Messages &&
                    !messageDrawer {
                    messageToast = conversation
                    messageToastTimer?.Dispose()
                    messageToastTimer = ui.Actions.Delay(
                        7000,
                        () -> {
                            messageToast = nil
                            Rebuild()
                        }
                    )
                }
            }
        }
    }

    private func OpenMessage(txid string) {
        if let reference = wallet.Messages.Lookup(txid) {
            messagesState.ConversationId = reference.ConversationId
            messagesState.MessageId = reference.MessageId
            messagesState.Request++
            messageToast = nil
            Open(AppPage.Messages)
        }
    }

    private func MessagesView(drawer bool) Blob -> Cell.Mount[MessagesInput, MessagesPage](
        drawer ? "message-drawer": "messages",
        MessagesInput{
            Ui: ui,
            Session: wallet,
            State: messagesState,
            Contacts: contacts,
            Width: drawer ? Math.Min(480.0, width - 112): width - 122,
            Drawer: drawer,
            OnOpen: () -> Open(AppPage.Messages),
            OnClose: () -> {
                messageDrawer = false
                wallet.Messages.ClearSelection()
                Rebuild()
            },
            OnContacts: () -> {
                LoadContacts()
                Rebuild()
            }
        }
    )

    private func MessageOverlay() Blob {
        if messageDrawer {
            return Container{
                Position: PositionType.Absolute,
                Right: 20,
                Top: 50,
                Bottom: 20,
                Width: Math.Min(480.0, width - 112),
                ZIndex: 20,
                MessagesView(true)
            }
        }
        let conversation = messageToast
        let latest = conversation?.Messages.LastOrDefault(item -> !item.Outgoing)
        let root = Container{
            Position: PositionType.Absolute,
            Right: 24,
            Bottom: 24,
            Width: Math.Min(360.0, width - 132),
            ZIndex: 20
        }
        if conversation != nil && latest != nil {
            let toast = Goo
                .Button{
                BasedOn: AppTheme.InformationCardStyle,
                Gap: AppTheme.Space6,
                MinWidth: 0,
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.Button,
                    Name: ui.Strings.Get("Reply") + " " + Hidden(ui.Privacy, conversation.Title)
                },
                OnClick: () -> {
                    messagesState.ConversationId = conversation.Id
                    messagesState.MessageId = ""
                    messagesState.NewConversation = conversation
                    messagesState.Request++
                    messageDrawer = true
                    messageToast = nil
                    Rebuild()
                },
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: AppTheme.Space8,
                    MaterialIcons.Create("chat_bubble", AppTheme.Icon16, AppTheme.Lime),
                    Grow(Label(ui, Hidden(ui.Privacy, conversation.Title), AppTheme.Type13, AppTheme.Ink, "")),
                    Label(ui, ui.Strings.Get("Reply"), AppTheme.Type11, AppTheme.Lime, "")
                },
                Label(ui, Hidden(ui.Privacy, MessagesPage.Preview(latest.Text)), AppTheme.Type12, AppTheme.Body, "")
            }
            WidgetKeyBindings.BindActivation(toast)
            root.Add(toast)
        }
        return root
    }
}
