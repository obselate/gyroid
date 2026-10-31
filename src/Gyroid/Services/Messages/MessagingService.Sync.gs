package Gyroid.Services

import Gyroid.Models

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text.Json
import System.Threading
import System.Threading.Tasks

partial class MessagingService {
    private let blockTimes Dictionary[int64, DateTimeOffset] = Dictionary[int64, DateTimeOffset]()
    private let minedHeights Dictionary[string, int64] = Dictionary[string, int64](StringComparer.Ordinal)
    private var lastVerify DateTimeOffset
    private var historyMemos Dictionary[string, string] = Dictionary[string, string](StringComparer.Ordinal)

    func HistoryMemo(txid string, index int32, fallback string) string -> historyMemos.TryGetValue(
        txid + ":" + index.ToString(),
        out let memo
    ) ? memo: fallback

    async func RefreshCoreAsync(address JsonElement, ct CancellationToken) {
        let client = session.Node.Api
        let own = NodeJson.Text(address, "address")
        Address.Decode(own, Network)
        if own != OwnAddress || store == nil {
            store = MessagingStore(Network, own)
            blockTimes.Clear()
            minedHeights.Clear()
            lock sending {
                sending.Clear()
            }
        }
        ownAddress = own
        viewOnly = NodeJson.Flag(address, "view_only")
        let local = store ?? throw WalletException("Messaging store is unavailable")
        local.ReloadContacts(Network)
        let memos = Dictionary[string, string](StringComparer.Ordinal)
        using let status = await client.JsonAsync("status", ct: ct)
        using let stats = await client.JsonAsync("stats", ct: ct)
        let height = NodeJson.Integer(status.RootElement, "chain_height")
        let tip = await BlockTime(client, height, ct)
        var average = 300.0
        var averageField JsonElement
        if stats.RootElement.TryGetProperty("avg_block_time", out averageField) &&
            averageField.ValueKind == JsonValueKind.Number {
            average = averageField.GetDouble()
            if !double.IsFinite(average) || average <= 0 {
                average = 300.0
            }
        }
        let updated = Dictionary[string, Conversation](StringComparer.Ordinal)
        for pair in local.Contacts {
            let saved = pair.Value
            updated[saved.Id] = Conversation{
                Id: saved.Id,
                Title: saved.Title,
                Handle: saved.Handle,
                IsGroup: saved.IsGroup,
                Members: List[string](saved.Members)
            }
        }
        using let history = await client.JsonAsync("wallet/history", ct: ct)
        let incoming = Dictionary[string, List[JsonElement]](StringComparer.Ordinal)
        for output in history.RootElement.GetProperty("outputs").EnumerateArray() {
            if NodeJson.Text(output, "memo_hex").Length == 0 {
                continue
            }
            let txid = NodeJson.Text(output, "txid")
            if !incoming.ContainsKey(txid) {
                incoming[txid] = List[JsonElement]()
            }
            incoming[txid].Add(output)
        }
        for pair in incoming {
            let outputs = pair.Value
            outputs.Sort(
                (left, right) -> NodeJson.Integer(left, "output_index").CompareTo(
                    NodeJson.Integer(right, "output_index")
                )
            )
            using let stream = MemoryStream()
            for output in outputs {
                stream.Write(Convert.FromHexString(NodeJson.Text(output, "memo_hex")))
            }
            let decoded = DecodeWhisper(stream.ToArray(), Network)
            if decoded == nil {
                continue
            }
            for index in 0 ... outputs.Count {
                memos[
                    pair.Key + ":" + NodeJson.Integer(outputs[index], "output_index").ToString()
                ] = index == 0 ? decoded.Kind == 3 ? "Group invitation: " +
                    decoded.GroupName: decoded.Text: ""
            }
            await AddEnvelope(
                client,
                local,
                updated,
                decoded,
                pair.Key,
                own,
                false,
                "confirmed",
                height - NodeJson.Integer(outputs[0], "block_height") + 1,
                NodeJson.Integer(outputs[0], "block_height"),
                0,
                outputs.Count,
                average,
                own,
                ct
            )
        }
        var offset = 0
        while true {
            using let sends = await client.JsonAsync(
                "wallet/sends?limit=500&offset=" + offset.ToString() + "&order=asc",
                ct: ct
            )
            let entries = sends.RootElement.GetProperty("sends")
            for sent in entries.EnumerateArray() {
                let recipients = Dictionary[string, MemoryStream](StringComparer.Ordinal)
                try {
                    for output in sent.GetProperty("recipients").EnumerateArray() {
                        let memo = NodeJson.Text(output, "memo_hex")
                        if memo.Length == 0 {
                            continue
                        }
                        let recipient = NodeJson.Text(output, "address")
                        if !recipients.ContainsKey(recipient) {
                            recipients[recipient] = MemoryStream()
                        }
                        recipients[recipient].Write(Convert.FromHexString(memo))
                    }
                    let txid = NodeJson.Text(sent, "txid")
                    let state = NodeJson.Text(sent, "chain_state")
                    var mined int64
                    if state == "confirmed" && !minedHeights.TryGetValue(txid, out mined) {
                        using let transaction = await client.JsonAsync("tx/" + txid, ct: ct)
                        mined = NodeJson.Integer(transaction.RootElement, "block_height")
                        minedHeights[txid] = mined
                    }
                    let groups = HashSet[string](StringComparer.Ordinal)
                    for pair in recipients {
                        let envelope = DecodeWhisper(pair.Value.ToArray(), Network)
                        if envelope == nil {
                            continue
                        }
                        if envelope.Kind >= 2 && !groups.Add(Convert.ToHexStringLower(envelope.GroupId)) {
                            continue
                        }
                        await AddEnvelope(
                            client,
                            local,
                            updated,
                            envelope,
                            txid,
                            pair.Key,
                            true,
                            state,
                            NodeJson.Integer(sent, "confirmations"),
                            mined,
                            NodeJson.Integer(sent, "fee"),
                            int32(NodeJson.Integer(sent, "total_amount")),
                            average,
                            own,
                            ct
                        )
                    }
                } finally {
                    for pair in recipients {
                        pair.Value.Dispose()
                    }
                }
            }
            offset += entries.GetArrayLength()
            if entries.GetArrayLength() == 0 || int64(offset) >= NodeJson.Integer(sends.RootElement, "total") {
                break
            }
        }
        let result = List[Conversation](updated.Values)
        for conversation in result {
            conversation.Messages.Sort((left, right) -> left.SentAt.CompareTo(right.SentAt))
            var read int64
            local.ReadMarkers.TryGetValue(conversation.Id, out read)
            for message in conversation.Messages {
                if !message.Outgoing && message.SentAt.ToUnixTimeSeconds() > read {
                    conversation.Unread++
                }
            }
        }
        result.Sort((left, right) -> string.Compare(left.Title, right.Title, StringComparison.OrdinalIgnoreCase))
        local.Save()
        TipHeight = height
        TipTime = tip
        AverageBlockSeconds = average
        historyMemos = memos
        lock sending {
            for pair in sending {
                var conversation = result.Find(item -> item.Id == pair.Value)
                if conversation == nil {
                    conversation = this.conversations.Find(item -> item.Id == pair.Value)
                    if conversation != nil {
                        let saved = Conversation{
                            Id: conversation.Id,
                            Title: conversation.Title,
                            Handle: conversation.Handle,
                            IsGroup: conversation.IsGroup,
                            Members: List[string](conversation.Members)
                        }
                        result.Add(saved)
                        conversation = saved
                    }
                }
                conversation?.Messages.Add(pair.Key)
            }
            this.conversations = result
        }
        if let current = result.Find(item -> item.Id == selected) {
            current.Unread = 0
            local.MarkRead(current)
            local.Save()
        }
        Error = ""
    }

    private func DecodeWhisper(bytes[]uint8, network string) Envelope? {
        try {
            return Wire.Decode(bytes, network)
        } catch (error FormatException) {
            return nil
        } catch (error ArgumentException) {
            return nil
        } catch (error EndOfStreamException) {
            return nil
        }
    }

    private async func BlockTime(client NodeApi, height int64, ct CancellationToken) DateTimeOffset {
        if blockTimes.ContainsKey(height) {
            return blockTimes[height]
        }
        using let block = await client.JsonAsync("block/" + height.ToString(), ct: ct)
        let timestamp = DateTimeOffset.FromUnixTimeSeconds(NodeJson.Integer(block.RootElement, "timestamp"))
        blockTimes[height] = timestamp
        return timestamp
    }

    private async func AddEnvelope(
        client NodeApi,
        local MessagingStore,
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
        average float64,
        own string,
        ct CancellationToken
    ) {
        var sender = ""
        if outgoing {
            sender = own
        } else if envelope.Sender.Length == 68 {
            sender = Address.Encode(envelope.Sender)
        } else {
            let candidates = HashSet[string](StringComparer.Ordinal)
            for pair in local.Contacts {
                for member in pair.Value.Members {
                    if member.StartsWith("$", StringComparison.Ordinal) {
                        continue
                    }
                    if Enumerable.SequenceEqual(Address.Tag(Address.Decode(member, Network)), envelope.Tag) {
                        candidates.Add(member)
                    }
                }
            }
            for id in local.Removed.Keys {
                if id.Length >= 68 && Enumerable.SequenceEqual(Address.Tag(Address.Decode(id, Network)), envelope.Tag) {
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
            envelope.SigningString(Address.Decode(recipient, Network))
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
                using let verified = await client.JsonAsync(
                    "verify",
                    writer -> {
                        writer.WriteStartObject()
                        writer.WriteString("address", sender)
                        writer.WriteString("message", signing)
                        writer.WriteString("signature", Convert.ToHexStringLower(envelope.Signature))
                        writer.WriteEndObject()
                    },
                    ct
                )
                verification = if NodeJson.Flag(verified.RootElement, "valid") {
                    Verification.Verified
                } else {
                    Verification.Invalid
                }
                local.Verified[cacheKey] = verification
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
            await BlockTime(client, height, ct)
        } else {
            DateTimeOffset.UtcNow
        }
        let sentAt = Math.Min(int64(envelope.SentAt), arrived.ToUnixTimeSeconds())
        if local.Removed.TryGetValue(id, out let removedAt) && sentAt <= removedAt {
            return
        }
        if envelope.Kind == 2 && !outgoing && local.Contacts.ContainsKey(id) {
            if !local.Contacts[id].Members.Contains(sender) {
                verification = Verification.Invalid
            }
        }
        if verification == Verification.Invalid && !outgoing {
            return
        }
        if outgoing && envelope.Kind == 1 && chainState == "confirmed" {
            local.Introduced[recipient] = true
        }
        if envelope.Kind == 3 && verification == Verification.Verified && !local.Contacts.ContainsKey(id) {
            if !envelope.Members.Contains(recipient) || !envelope.Members.Contains(sender) {
                return
            }
            let group = Conversation{Id: id, Title: envelope.GroupName, IsGroup: true, Members: envelope.Members}
            local.SaveContact(group)
            if conversations.ContainsKey(id) {
                group.Messages = conversations[id].Messages
            }
            conversations[id] = group
        }
        if !conversations.ContainsKey(id) {
            let conversation = Conversation{
                Id: id,
                Title: if outgoing {
                    Address.Short(recipient)
                } else if sender.Length > 0 {
                    Address.Short(sender)
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
            if verification == Verification.Verified && envelope.Kind == 1 {
                local.SaveContact(conversation)
            }
        }
        var senderName = if outgoing {
            "You"
        } else if sender.Length > 0 {
            Address.Short(sender)
        } else {
            "Unknown sender"
        }
        if local.Contacts.ContainsKey(sender) {
            senderName = local.Contacts[sender].Title
        }
        let message = Message{
            Key: txid + ":" + id,
            Txid: txid,
            Outgoing: outgoing,
            SenderAddress: sender,
            SenderName: senderName,
            Text: if envelope.Kind == 3 {
                "Group invitation: " + envelope.GroupName
            } else {
                envelope.Text
            },
            SentAt: DateTimeOffset.FromUnixTimeSeconds(sentAt),
            State: if chainState == "mempool" {
                MessageState.Pending
            } else if chainState == "confirmed" {
                MessageState.Confirmed
            } else {
                MessageState.Failed
            },
            Confirmations: int32(confirmations),
            EtaSeconds: Wire.Eta(chainState, average),
            Verification: verification,
            FeeAtomic: fee,
            Outputs: outputs
        }
        if chainState == "confirmed" {
            message.ArrivedAt = arrived
        }
        conversations[id].Messages.Add(message)
    }
}
