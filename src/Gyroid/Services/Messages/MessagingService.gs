package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Generic
import System.Linq
import System.Text.Json
import System.Threading

partial class MessagingService {
    private let session WalletSession
    private var store MessagingStore?
    private var conversations List[Conversation] = List[Conversation]()
    private let sending Dictionary[Message, string] = Dictionary[Message, string]()
    private var ownAddress string = ""
    private var selected string = ""
    private var viewOnly bool
    var Error string = ""
    var AverageBlockSeconds float64 = 300.0
    var TipHeight int64
    var TipTime DateTimeOffset

    prop Conversations IReadOnlyList[Conversation] -> conversations
    prop OwnAddress string -> ownAddress
    prop Network string -> session.settings.Network
    prop Mode MessengerMode -> if ownAddress.Length == 0 {
        MessengerMode.Disconnected
    } else if session.State != WalletState.Unlocked || viewOnly {
        MessengerMode.ReadOnly
    } else {
        MessengerMode.Send
    }

    init(session WalletSession) {
        this.session = session
    }

    func Thread(id string) IReadOnlyList[Message] {
        if let conversation = conversations.Find(item -> item.Id == id) {
            return conversation.Messages
        }
        return Array.Empty[Message]()
    }

    func Lookup(txid string) MessageReference? {
        if txid.Length == 0 {
            return nil
        }
        for conversation in conversations {
            for message in conversation.Messages {
                if message.Txid == txid {
                    return MessageReference(conversation.Id, message.Key)
                }
            }
        }
        return nil
    }

    func Measure(conversation Conversation, text string) MessageEstimate -> Prepare(
        conversation,
        text,
        false,
        false
    ).Estimate

    async func RefreshAsync(ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct, false)
        try {
            session.RequireUnlocked()
            using let address = await session.Node.Api.JsonAsync("wallet/address", ct: ct)
            await RefreshCoreAsync(address.RootElement, ct)
        } finally {
            session.End()
        }
    }

    async func Send(conversation Conversation, text string, ct CancellationToken = default(CancellationToken)) {
        if conversation.Id.StartsWith("$", StringComparison.Ordinal) {
            let resolved = await AddContact(conversation.Title, conversation.Id, ct)
            conversations = conversations.Where(item -> item.Id != conversation.Id).ToList()
            await Send(resolved, text, ct)
            return
        }
        let message = Message{
            Key: "sending:" + Guid.NewGuid().ToString("N"),
            Outgoing: true,
            SenderName: "You",
            Text: text,
            SentAt: DateTimeOffset.UtcNow,
            State: MessageState.InProgress
        }
        lock sending {
            sending[message] = conversation.Id
            let current = conversations.Find(item -> item.Id == conversation.Id) ?? conversation
            let messages = List[Message](current.Messages)
            messages.Add(message)
            current.Messages = messages
        }
        session.Changed?.Invoke()
        await Dispatch(conversation, message, ct)
    }

    async func Resend(conversation Conversation, message Message, ct CancellationToken = default(CancellationToken)) {
        lock sending {
            if !sending.ContainsKey(message) || sending[message] != conversation.Id {
                throw WalletException("Message is not available for retry")
            }
            if message.State != MessageState.Failed {
                throw WalletException("Only a message that was not sent can be retried")
            }
            message.State = MessageState.InProgress
        }
        session.Changed?.Invoke()
        await Dispatch(conversation, message, ct)
    }

    private async func Dispatch(conversation Conversation, message Message, ct CancellationToken) {
        try {
            await Transmit(conversation, message.Text, false, message, ct)
        } catch (error Exception) {
            message.State = MessageState.Failed
            session.Changed?.Invoke()
            throw error
        }
    }

    async func AddContact(
        name string,
        recipient string,
        ct CancellationToken = default(CancellationToken)
    ) Conversation {
        await session.BeginAsync(ct, false)
        try {
            let local = store ?? throw WalletException("Load a wallet first")
            var address = recipient.Trim()
            var handle = ""
            if address.StartsWith("$", StringComparison.Ordinal) || address.StartsWith("@", StringComparison.Ordinal) {
                RequireSend()
                handle = "$" + address.Substring(1)
                using let resolved = await session
                    .Node
                    .Api
                    .JsonAsync(
                    "wallet/send",
                    writer -> {
                        writer.WriteStartObject()
                        writer.WriteBoolean("dry_run", true)
                        writer.WriteStartArray("recipients")
                        writer.WriteStartObject()
                        writer.WriteString("address", handle)
                        writer.WriteNumber("amount", 1)
                        writer.WriteEndObject()
                        writer.WriteEndArray()
                        writer.WriteEndObject()
                    },
                    ct
                )
                let recipients = resolved.RootElement.GetProperty("recipients")
                if recipients.GetArrayLength() != 1 || !NodeJson.Flag(recipients[0], "resolver_verified") {
                    throw WalletException("Blocknet ID is not verified")
                }
                address = NodeJson.Text(recipients[0], "resolved_address")
                let canonical = NodeJson.Text(recipients[0], "resolved_handle")
                if canonical.Length > 0 {
                    handle = canonical.StartsWith("$", StringComparison.Ordinal) ? canonical: "$" + canonical
                }
            }
            Address.Decode(address, Network)
            let conversation = Conversation{
                Id: address,
                Title: name.Trim().Length > 0 ? name.Trim(): handle.Length > 0 ? handle: Address.Short(address),
                Handle: handle
            }
            conversation.Members.Add(address)
            SaveConversation(conversation)
            local.Save()
            return conversations.Find(item -> item.Id == address) ?? conversation
        } finally {
            session.End()
        }
    }

    async func CreateGroup(name string, members List[string], ct CancellationToken = default(CancellationToken)) {
        let conversation = Conversation{
            Id: Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(8)),
            Title: name.Trim(),
            IsGroup: true
        }
        for member in members {
            Address.Decode(member, Network)
            if member != OwnAddress && !conversation.Members.Contains(member) {
                conversation.Members.Add(member)
            }
        }
        if conversation.Members.Count == 0 {
            throw WalletException("A group requires another member")
        }
        await Transmit(conversation, "", true, nil, ct)
    }

    async func Select(conversation Conversation, ct CancellationToken = default(CancellationToken)) {
        selected = conversation.Id
        await MarkRead(conversation, ct)
    }

    async func MarkRead(conversation Conversation, ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct, false)
        try {
            let local = store ?? throw WalletException("Load a wallet first")
            conversation.Unread = 0
            local.MarkRead(conversation)
            local.Save()
        } finally {
            session.End()
        }
    }

    async func RemoveConversation(conversation Conversation, ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct, false)
        try {
            let local = store ?? throw WalletException("Load a wallet first")
            local.Removed[conversation.Id] = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            local.Contacts.TryRemove(conversation.Id, out _)
            if !conversation.IsGroup {
                let contacts = AddressBook.ReadContacts(
                    message -> {
                        throw WalletException(message)
                    }
                )
                for key in contacts.Where(pair -> pair.Value == conversation.Id).Select(pair -> pair.Key).ToList() {
                    contacts.Remove(key)
                }
                AddressBook.WriteContacts(contacts)
            }
            lock sending {
                conversations = conversations.Where(item -> item.Id != conversation.Id).ToList()
                for message in sending.Keys.Where(item -> sending[item] == conversation.Id).ToList() {
                    sending.Remove(message)
                }
            }
            local.Save()
        } finally {
            session.End()
        }
    }

    func Reset() {
        if session.State == WalletState.Locked || session.State == WalletState.Unknown {
            return
        }
        lock sending {
            sending.Clear()
            conversations = List[Conversation]()
        }
        ownAddress = ""
        selected = ""
        store = nil
        blockTimes.Clear()
        minedHeights.Clear()
        historyMemos.Clear()
        Error = ""
    }
}
