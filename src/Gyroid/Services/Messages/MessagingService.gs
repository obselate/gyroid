package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Generic
import System.Linq
import System.Text.Json
import System.Threading

partial class MessagingService {
    private let session WalletSession
    private let syncGate SemaphoreSlim = SemaphoreSlim(1, 1)
    private let refreshRequested chan[bool] = chan[bool](1)
    private var syncLifetime CancellationTokenSource = CancellationTokenSource()
    private var store MessagingStore?
    private var conversations List[Conversation] = List[Conversation]()
    private let sending Dictionary[Message, string] = Dictionary[Message, string]()
    private let sendCancellations Dictionary[Message, CancellationTokenSource] =
    Dictionary[Message, CancellationTokenSource]()
    private var receivedRows Dictionary[string, DecodedMemo] = Dictionary[string, DecodedMemo](StringComparer.Ordinal)
    private var sentRows[]JsonElement = Array.Empty[JsonElement]()
    private var sentMemos Dictionary[string, Dictionary[string, DecodedMemo]] =
    Dictionary[string, Dictionary[string, DecodedMemo]](StringComparer.Ordinal)
    private var ownAddress string = ""
    private var selected string = ""
    private var viewOnly bool
    private var generation int64
    private var revision int64
    private var appliedRevision int64 = -1
    var Error string = ""
    var TipHeight int64
    var TipTime DateTimeOffset

    prop Conversations IReadOnlyList[Conversation] -> conversations
    prop OwnAddress string -> ownAddress
    prop Network string -> session.settings.Network
    prop Mode MessengerMode -> if session.State == WalletState.Locked {
        MessengerMode.ReadOnly
    } else if ownAddress.Length == 0 {
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
        if txid.Length > 0 {
            for conversation in conversations {
                for message in conversation.Messages {
                    if message.Txid == txid {
                        return MessageReference(conversation.Id, message.Key)
                    }
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

    func UpdateWallet(address JsonElement) {
        let own = NodeJson.Text(address, "address")
        if own != OwnAddress {
            Reset()
            Address.Decode(own, Network)
            let local = MessagingStore(Network, own)
            lock sending {
                store = local
                ownAddress = own
                Error = local.Error
            }
        }
        viewOnly = NodeJson.Flag(address, "view_only")
    }

    func QueueRefresh(
        received Dictionary[string, DecodedMemo],
        sent[]JsonElement,
        decodedSent Dictionary[string, Dictionary[string, DecodedMemo]]
    ) {
        lock sending {
            receivedRows = received
            sentRows = sent
            sentMemos = decodedSent
            revision++
        }
        refreshRequested.Writer.TryWrite(true)
    }

    func Sync(sessionContext Context) {
        while !sessionContext.IsCancelled {
            <-refreshRequested
            try {
                await RefreshAsync(sessionContext.Token)
            } catch (error OperationCanceledException) when sessionContext.IsCancelled {
                return
            } catch (error Exception) { }
        }
    }

    async func RefreshAsync(ct CancellationToken = default(CancellationToken)) {
        var walletToken CancellationToken
        lock sending {
            walletToken = syncLifetime.Token
        }
        using let linked = CancellationTokenSource.CreateLinkedTokenSource(ct, walletToken)
        await syncGate.WaitAsync(linked.Token)
        try {
            await RefreshCoreAsync(linked.Token)
        } finally {
            syncGate.Release()
        }
    }

    async func Send(conversation Conversation, text string, ct CancellationToken = default(CancellationToken)) {
        RequireSend()
        let message = Message{
            Key: "sending:" + Guid.NewGuid().ToString("N"),
            ConversationId: conversation.Id,
            IdempotencyKey: Guid.NewGuid().ToString("N"),
            Outgoing: true,
            SenderAddress: OwnAddress,
            SenderName: "You",
            Text: text,
            SentAt: DateTimeOffset.UtcNow,
            State: MessageState.InProgress
        }
        var version int64
        lock sending {
            version = generation
            sending[message] = conversation.Id
            sendCancellations[message] = CancellationTokenSource()
            let current = conversations.Find(item -> item.Id == conversation.Id) ??
                Conversation{
                Id: conversation.Id,
                Title: conversation.Title,
                Handle: conversation.Handle,
                IsGroup: conversation.IsGroup,
                Members: List[string](conversation.Members)
            }
            let messages = List[Message](current.Messages)
            messages.Add(message)
            current.Messages = messages
            if !conversations.Any(item -> item.Id == current.Id) {
                let updated = List[Conversation](conversations)
                updated.Add(current)
                conversations = updated
            }
        }
        session.Changed?.Invoke()
        await Dispatch(conversation, message, version, ct)
    }

    async func Resend(conversation Conversation, message Message, ct CancellationToken = default(CancellationToken)) {
        var version int64
        lock sending {
            if !sending.TryGetValue(message, out let id) ||
                id != conversation.Id ||
                message.State != MessageState.Failed {
                throw WalletException("Message is not available for retry")
            }
            version = generation
            message.State = MessageState.InProgress
        }
        session.Changed?.Invoke()
        await Dispatch(conversation, message, version, ct)
    }

    private async func Dispatch(conversation Conversation, message Message, version int64, ct CancellationToken) {
        try {
            var token CancellationToken
            lock sending {
                if version != generation {
                    throw OperationCanceledException("The wallet session changed")
                }
                if !sendCancellations.TryGetValue(message, out let cancellation) {
                    return
                }
                token = cancellation.Token
            }
            using let linked = CancellationTokenSource.CreateLinkedTokenSource(ct, token)
            await Transmit(conversation, message.Text, false, message, version, linked.Token)
        } catch (error Exception) {
            lock sending {
                if version != generation {
                    throw OperationCanceledException("The wallet session changed", error)
                }
                if !sending.ContainsKey(message) {
                    return
                }
            }
            message.State = MessageState.Failed
            session.Changed?.Invoke()
            throw error
        }
    }

    private async func ResolveConversation(name string, recipient string, ct CancellationToken) Conversation {
        var address = recipient.Trim()
        var handle = ""
        if address.StartsWith("$", StringComparison.Ordinal) || address.StartsWith("@", StringComparison.Ordinal) {
            let client = RequireSend()
            handle = "$" + address.Substring(1)
            using let resolved = await client.JsonAsync(
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
            Title: name.Trim().Length > 0 ? name.Trim(): handle.Length > 0 ? handle: WalletText.Short(address),
            Handle: handle
        }
        conversation.Members.Add(address)
        return conversation
    }

    async func OpenConversation(
        name string,
        recipient string,
        ct CancellationToken = default(CancellationToken)
    ) Conversation {
        await syncGate.WaitAsync(ct)
        try {
            await session.BeginAsync(ct, false)
            try {
                let local = store ?? throw WalletException("Load a wallet first")
                let conversation = await ResolveConversation(name, recipient, ct)
                local.Removed.TryRemove(conversation.Id, out _)
                SaveConversation(conversation)
                local.Save()
                return conversations.Find(item -> item.Id == conversation.Id) ?? conversation
            } finally {
                session.End()
            }
        } finally {
            syncGate.Release()
        }
    }

    async func AddContact(
        name string,
        recipient string,
        ct CancellationToken = default(CancellationToken)
    ) Conversation {
        await syncGate.WaitAsync(ct)
        try {
            await session.BeginAsync(ct, false)
            try {
                let local = store ?? throw WalletException("Load a wallet first")
                let conversation = await ResolveConversation(name, recipient, ct)
                let contacts = AddressBook.ReadContacts(_ -> { })
                let existing = contacts.FirstOrDefault(
                    pair -> pair.Value == conversation.Id || string.Equals(
                        pair.Value,
                        conversation.Handle,
                        StringComparison.OrdinalIgnoreCase
                    )
                )
                if existing.Key != nil {
                    conversation.Title = existing.Key
                    contacts[existing.Key] = conversation.Id
                } else {
                    var title = conversation.Title
                    var suffix = 2
                    while contacts.ContainsKey(title) {
                        title = conversation.Title + " " + suffix.ToString()
                        suffix++
                    }
                    conversation.Title = title
                    contacts[title] = conversation.Id
                }
                AddressBook.WriteContacts(contacts)
                local.Removed.TryRemove(conversation.Id, out _)
                SaveConversation(conversation)
                local.Save()
                return conversations.Find(item -> item.Id == conversation.Id) ?? conversation
            } finally {
                session.End()
            }
        } finally {
            syncGate.Release()
        }
    }

    async func CreateGroup(
        name string,
        members List[string],
        ct CancellationToken = default(CancellationToken)
    ) Conversation {
        let version = generation
        let conversation = Conversation{
            Id: Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(8)),
            Title: name.Trim(),
            IsGroup: true
        }
        for member in members {
            var recipient = member
            if member.StartsWith("$", StringComparison.Ordinal) || member.StartsWith("@", StringComparison.Ordinal) {
                let resolved = await ResolveConversation("", member, ct)
                recipient = resolved.Id
            }
            Address.Decode(recipient, Network)
            if recipient != OwnAddress && !conversation.Members.Contains(recipient) {
                conversation.Members.Add(recipient)
            }
        }
        if conversation.Members.Count == 0 {
            throw WalletException("A group requires another member")
        }
        await Transmit(conversation, "", true, nil, version, ct)
        return conversations.Find(item -> item.Id == conversation.Id) ?? conversation
    }

    async func Select(conversation Conversation, ct CancellationToken = default(CancellationToken)) {
        selected = conversation.Id
        await MarkRead(conversation, ct)
    }

    func ClearSelection() {
        selected = ""
    }

    async func MarkRead(conversation Conversation, ct CancellationToken = default(CancellationToken)) {
        let local = store ?? throw WalletException("Load a wallet first")
        conversation.Unread = 0
        local.MarkRead(conversation)
        session.Changed?.Invoke()
        await Persist(local, ct)
    }

    async func RemoveConversation(conversation Conversation, ct CancellationToken = default(CancellationToken)) {
        let local = store ?? throw WalletException("Load a wallet first")
        local.Removed[conversation.Id] = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
        local.Conversations.TryRemove(conversation.Id, out _)
        let cancelled = List[CancellationTokenSource]()
        lock sending {
            conversations = conversations.Where(item -> item.Id != conversation.Id).ToList()
            for message in sending.Keys.Where(item -> sending[item] == conversation.Id).ToList() {
                sending.Remove(message)
                if sendCancellations.Remove(message, out let cancellation) {
                    cancelled.Add(cancellation)
                }
            }
        }
        for cancellation in cancelled {
            cancellation.Cancel()
            cancellation.Dispose()
        }
        session.Changed?.Invoke()
        await session.gate.WaitAsync(ct)
        try {
            if object.ReferenceEquals(local, store) && session.State == WalletState.Unlocked {
                session.History.ApplyMessages()
            }
        } finally {
            session.gate.Release()
        }
        await Persist(local, ct)
    }

    private async func Persist(local MessagingStore, ct CancellationToken) {
        await syncGate.WaitAsync(ct)
        try {
            if object.ReferenceEquals(local, store) {
                local.Save()
            }
        } finally {
            syncGate.Release()
        }
    }

    func Reset() {
        var previous CancellationTokenSource
        var cancelled[]CancellationTokenSource
        lock sending {
            previous = syncLifetime
            syncLifetime = CancellationTokenSource()
            generation++
            appliedRevision = -1
            cancelled = sendCancellations.Values.ToArray()
            sendCancellations.Clear()
            sending.Clear()
            conversations = List[Conversation]()
            receivedMessages = Dictionary[string, Message](StringComparer.Ordinal)
            sentMessages = Dictionary[string, Message](StringComparer.Ordinal)
            receivedRows = Dictionary[string, DecodedMemo](StringComparer.Ordinal)
            sentRows = Array.Empty[JsonElement]()
            sentMemos = Dictionary[string, Dictionary[string, DecodedMemo]](StringComparer.Ordinal)
            ownAddress = ""
            selected = ""
            store = nil
            Error = ""
        }
        for cancellation in cancelled {
            cancellation.Cancel()
            cancellation.Dispose()
        }
        previous.Cancel()
        previous.Dispose()
    }
}
