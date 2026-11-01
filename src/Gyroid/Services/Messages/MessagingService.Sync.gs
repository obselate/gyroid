package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Generic
import System.Linq
import System.Text.Json
import System.Threading
import System.Threading.Tasks

partial class MessagingService {
    private let blockTimes Dictionary[string, DateTimeOffset] = Dictionary[string, DateTimeOffset](
        StringComparer.Ordinal
    )
    private let minedHeights Dictionary[string, int64] = Dictionary[string, int64](StringComparer.Ordinal)
    private var lastVerify DateTimeOffset
    private var receivedMessages Dictionary[string, Message] = Dictionary[string, Message](StringComparer.Ordinal)
    private var sentMessages Dictionary[string, Message] = Dictionary[string, Message](StringComparer.Ordinal)

    func HistoryMessage(txid string, recipient string, outgoing bool) Message? {
        var message Message? = nil
        if outgoing {
            if sentMessages.TryGetValue(txid + ":" + recipient, out let sent) {
                message = sent
            }
        } else if receivedMessages.TryGetValue(txid, out let received) {
            message = received
        }
        let local = store
        if message != nil && local != nil && local.Removed.TryGetValue(message.ConversationId, out let removedAt) &&
            message
            .SentAt
            .ToUnixTimeSeconds() <= removedAt {
            return nil
        }
        return message
    }

    private func KnownConversations(local MessagingStore, network string) Dictionary[string, Conversation] {
        let known = Dictionary[string, Conversation](local.Conversations, StringComparer.Ordinal)
        try {
            for entry in AddressBook.ReadContacts(_ -> { }) {
                var address = entry.Value
                var handle = ""
                if address.StartsWith("$", StringComparison.Ordinal) {
                    handle = address
                    let saved = known.Values.FirstOrDefault(item -> item.Handle == handle)
                    if saved != nil {
                        address = saved.Id
                    }
                }
                if !address.StartsWith("$", StringComparison.Ordinal) {
                    try {
                        Address.Decode(address, network)
                    } catch (error ArgumentException) {
                        continue
                    }
                }
                let conversation = Conversation{Id: address, Title: entry.Key, Handle: handle}
                conversation.Members.Add(address)
                known[address] = conversation
            }
        } catch (error WalletException) { }
        return known
    }

    private async func RefreshCoreAsync(ct CancellationToken) {
        var own string
        var network string
        var version int64
        var currentRevision int64
        var local MessagingStore?
        var received Dictionary[string, DecodedMemo]
        var sent[]JsonElement
        var decodedSent Dictionary[string, Dictionary[string, DecodedMemo]]
        lock sending {
            if ownAddress.Length == 0 || appliedRevision == revision {
                return
            }
            own = ownAddress
            network = Network
            version = generation
            currentRevision = revision
            local = store
            received = receivedRows
            sent = sentRows
            decodedSent = sentMemos
        }
        try {
            await Synchronize(
                own,
                network,
                version,
                currentRevision,
                local ?? throw WalletException("Messaging store is unavailable"),
                received,
                sent,
                decodedSent,
                ct
            )
        } catch (error Exception) {
            lock sending {
                if generation == version {
                    Error = error.Message
                }
            }
            session.Changed?.Invoke()
            throw error
        }
    }

    private async func Synchronize(
        own string,
        network string,
        version int64,
        currentRevision int64,
        local MessagingStore,
        received Dictionary[string, DecodedMemo],
        sent[]JsonElement,
        decodedSent Dictionary[string, Dictionary[string, DecodedMemo]],
        ct CancellationToken
    ) {
        let client = session.Node.Api
        using let status = await client.JsonAsync("status", ct: ct)
        let height = int64(NodeJson.Number(status.RootElement, "chain_height"))
        let tip = await BlockTime(client, network, height, ct)
        let known = KnownConversations(local, network)
        let updated = Dictionary[string, Conversation](StringComparer.Ordinal)
        for pair in known {
            let saved = pair.Value
            if !local.Removed.ContainsKey(saved.Id) {
                updated[saved.Id] = Conversation{
                    Id: saved.Id,
                    Title: saved.Title,
                    Handle: saved.Handle,
                    IsGroup: saved.IsGroup,
                    Members: List[string](saved.Members)
                }
            }
        }
        let acceptedReceived = Dictionary[string, Message](StringComparer.Ordinal)
        let acceptedSent = Dictionary[string, Message](StringComparer.Ordinal)
        for pair in received {
            if generation != version {
                return
            }
            let decoded = pair.Value
            let mined = decoded.BlockHeight
            let message = await AddEnvelope(
                client,
                local,
                known,
                network,
                updated,
                decoded.Envelope,
                pair.Key,
                own,
                false,
                "confirmed",
                height - mined + 1,
                mined,
                0,
                decoded.OutputIndices.Length,
                own,
                ct
            )
            if message != nil {
                message.OutputIndices = decoded.OutputIndices
                acceptedReceived[pair.Key] = message
            }
        }
        for entry in sent {
            if generation != version {
                return
            }
            let txid = NodeJson.Text(entry, "txid")
            if !decodedSent.TryGetValue(txid, out let decoded) || decoded.Count == 0 {
                continue
            }
            let chainState = NodeJson.Text(entry, "chain_state")
            var mined int64
            let cacheKey = network + ":" + txid
            if chainState == "confirmed" && !minedHeights.TryGetValue(cacheKey, out mined) {
                using let transaction = await client.JsonAsync("tx/" + txid, ct: ct)
                mined = int64(NodeJson.Number(transaction.RootElement, "block_height"))
                minedHeights[cacheKey] = mined
            }
            for pair in decoded {
                let message = await AddEnvelope(
                    client,
                    local,
                    known,
                    network,
                    updated,
                    pair.Value.Envelope,
                    txid,
                    pair.Key,
                    true,
                    chainState,
                    int64(NodeJson.Number(entry, "confirmations")),
                    mined,
                    int64(NodeJson.Number(entry, "fee")),
                    entry.GetProperty("recipients").GetArrayLength(),
                    own,
                    ct
                )
                if message != nil {
                    acceptedSent[txid + ":" + pair.Key] = message
                }
            }
        }
        let result = List[Conversation](updated.Values)
        for conversation in result {
            conversation.Messages.Sort((left, right) -> left.SentAt.CompareTo(right.SentAt))
            if conversation.Id == selected {
                conversation.Unread = 0
                local.MarkRead(conversation)
            }
        }
        result.Sort((left, right) -> string.Compare(left.Title, right.Title, StringComparison.OrdinalIgnoreCase))
        if generation != version {
            return
        }
        local.Save()
        await session.gate.WaitAsync(ct)
        try {
            if generation != version || session.State != WalletState.Unlocked || session.disposed {
                return
            }
            lock sending {
                result.RemoveAll(
                    conversation -> {
                        if local.Removed.TryGetValue(conversation.Id, out let removedAt) {
                            conversation.Messages.RemoveAll(message -> message.SentAt.ToUnixTimeSeconds() <= removedAt)
                            return conversation.Messages.Count == 0
                        }
                        return false
                    }
                )
                for saved in local.Conversations.Values {
                    if !local.Removed.ContainsKey(saved.Id) && !result.Any(item -> item.Id == saved.Id) {
                        result.Add(
                            Conversation{
                                Id: saved.Id,
                                Title: saved.Title,
                                Handle: saved.Handle,
                                IsGroup: saved.IsGroup,
                                Members: List[string](saved.Members)
                            }
                        )
                    }
                }
                for pair in sending.ToArray() {
                    let conversation = result.Find(item -> item.Id == pair.Value)
                    if pair.Key.Txid.Length > 0 && conversation?.Messages.Any(
                        item -> item.Txid == pair.Key.Txid && item.Outgoing
                    ) == true {
                        sending.Remove(pair.Key)
                        if sendCancellations.Remove(pair.Key, out let cancellation) {
                            cancellation.Dispose()
                        }
                        continue
                    }
                    if conversation != nil {
                        conversation.Messages.Add(pair.Key)
                    } else if let previous = conversations.Find(item -> item.Id == pair.Value) {
                        let saved = Conversation{
                            Id: previous.Id,
                            Title: previous.Title,
                            Handle: previous.Handle,
                            IsGroup: previous.IsGroup,
                            Members: List[string](previous.Members)
                        }
                        saved.Messages.Add(pair.Key)
                        result.Add(saved)
                    }
                }
                for conversation in result {
                    local.ReadMarkers.TryGetValue(conversation.Id, out let read)
                    conversation.Unread = conversation.Messages.Count(
                        message -> !message.Outgoing && message.SentAt.ToUnixTimeSeconds() > read
                    )
                }
                conversations = result
                receivedMessages = acceptedReceived
                sentMessages = acceptedSent
                appliedRevision = currentRevision
                TipHeight = height
                TipTime = tip
                Error = local.Error
            }
            session.History.ApplyMessages()
        } finally {
            session.gate.Release()
        }
        session.Changed?.Invoke()
    }

    private async func BlockTime(client NodeApi, network string, height int64, ct CancellationToken) DateTimeOffset {
        let key = network + ":" + height.ToString()
        if blockTimes.TryGetValue(key, out let cached) {
            return cached
        }
        using let block = await client.JsonAsync("block/" + height.ToString(), ct: ct)
        let timestamp = DateTimeOffset.FromUnixTimeSeconds(NodeJson.Signed(block.RootElement, "timestamp"))
        blockTimes[key] = timestamp
        return timestamp
    }

    private async func AddEnvelope(
        client NodeApi,
        local MessagingStore,
        known Dictionary[string, Conversation],
        network string,
        conversations Dictionary[string, Conversation],
        envelope Envelope,
        txid string,
        recipient string,
        outgoing bool,
        chainState string,
        confirmations int64,
        height int64,
        fee int64,
        outputs int32,
        own string,
        ct CancellationToken
    ) Message? {
        var sender = ""
        if outgoing {
            sender = own
        } else if envelope.Sender.Length == 68 {
            sender = Address.Encode(envelope.Sender)
        } else {
            let candidates = HashSet[string](StringComparer.Ordinal)
            for pair in known {
                for member in pair.Value.Members {
                    if member.StartsWith("$", StringComparison.Ordinal) {
                        continue
                    }
                    if Enumerable.SequenceEqual(Address.Tag(Address.Decode(member, network)), envelope.Tag) {
                        candidates.Add(member)
                    }
                }
            }
            for id in local.Removed.Keys {
                if id.Length >= 68 && Enumerable.SequenceEqual(Address.Tag(Address.Decode(id, network)), envelope.Tag) {
                    candidates.Add(id)
                }
            }
            if candidates.Count == 1 {
                sender = candidates.First()
            }
        }
        var verification = Verification.Unverified
        let cacheKey = txid + ":" + recipient
        let signing = if sender.Length > 0 {
            envelope.SigningString(Address.Decode(recipient, network))
        } else {
            ""
        }
        if signing.Length > 1024 {
            verification = Verification.Invalid
        } else if sender.Length > 0 {
            if !local.Verified.TryGetValue(cacheKey, out verification) {
                let wait = 220.0 - (DateTimeOffset.UtcNow - lastVerify).TotalMilliseconds
                if wait > 0 {
                    await Task.Delay(TimeSpan.FromMilliseconds(wait), ct)
                }
                lastVerify = DateTimeOffset.UtcNow
                let valid = await session.Proofs.VerifyCoreAsync(
                    sender,
                    signing,
                    Convert.ToHexStringLower(envelope.Signature),
                    ct
                )
                verification = valid ? Verification.Verified: Verification.Invalid
                local.RecordVerification(cacheKey, verification)
            }
        }
        let id = if envelope.Kind >= 2 {
            Convert.ToHexStringLower(envelope.GroupId)
        } else if outgoing {
            recipient
        } else if sender.Length > 0 {
            sender
        } else {
            "unknown:" + Convert.ToHexStringLower(envelope.Tag)
        }
        let arrived = if chainState == "confirmed" {
            await BlockTime(client, network, height, ct)
        } else {
            DateTimeOffset.UtcNow
        }
        let sentAt = Math.Min(int64(envelope.SentAt), arrived.ToUnixTimeSeconds())
        if local.Removed.TryGetValue(id, out let removedAt) && sentAt <= removedAt {
            return nil
        }
        if envelope.Kind == 2 && !outgoing && known.ContainsKey(id) {
            if !known[id].Members.Contains(sender) {
                verification = Verification.Invalid
            }
        }
        if verification == Verification.Invalid && !outgoing {
            return nil
        }
        if outgoing && envelope.Kind == 1 && chainState == "confirmed" {
            local.Introduced[recipient] = true
        }
        if envelope.Kind == 3 && verification == Verification.Verified && !known.ContainsKey(id) {
            if !envelope.Members.Contains(recipient) || !envelope.Members.Contains(sender) {
                return nil
            }
            let group = Conversation{Id: id, Title: envelope.GroupName, IsGroup: true, Members: envelope.Members}
            local.Conversations[id] = group
            known[id] = group
            if conversations.ContainsKey(id) {
                group.Messages = conversations[id].Messages
            }
            conversations[id] = group
        }
        if !conversations.ContainsKey(id) {
            let conversation = Conversation{
                Id: id,
                Title: if outgoing {
                    WalletText.Short(recipient)
                } else if sender.Length > 0 {
                    WalletText.Short(sender)
                } else {
                    "Unknown sender"
                },
                IsGroup: envelope.Kind >= 2
            }
            if sender.Length > 0 {
                conversation.Members.Add(
                    if outgoing {
                        recipient
                    } else {
                        sender
                    }
                )
            }
            conversations[id] = conversation
            if envelope.Kind < 2 {
                local.Conversations[id] = conversation
                known[id] = conversation
            }
        }
        var senderName = if outgoing {
            "You"
        } else if sender.Length > 0 {
            WalletText.Short(sender)
        } else {
            "Unknown sender"
        }
        if known.ContainsKey(sender) {
            senderName = known[sender].Title
        }
        let message = Message{
            Key: txid + ":" + id,
            ConversationId: id,
            Txid: txid,
            Outgoing: outgoing,
            SenderAddress: sender,
            SenderName: senderName,
            Text: envelope.DisplayText,
            SentAt: DateTimeOffset.FromUnixTimeSeconds(sentAt),
            State: if chainState == "mempool" {
                MessageState.Pending
            } else if chainState == "confirmed" {
                MessageState.Confirmed
            } else {
                MessageState.Failed
            },
            Confirmations: int32(confirmations),
            Height: height,
            Verification: verification,
            FeeAtomic: fee,
            Outputs: outputs
        }
        if chainState == "confirmed" {
            message.ArrivedAt = arrived
        }
        if !conversations[id].Messages.Any(item -> item.Key == message.Key) {
            conversations[id].Messages.Add(message)
        }
        return message
    }
}
