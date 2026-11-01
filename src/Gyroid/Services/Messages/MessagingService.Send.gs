package Gyroid.Services

import Gyroid.Models

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text.Json
import System.Threading

class PreparedSend {
    let Addresses List[string] = List[string]()
    let Envelopes List[Envelope] = List[Envelope]()
    let Estimate MessageEstimate = MessageEstimate()
}

partial class MessagingService {
    private func RequireSend() NodeApi {
        if Mode != MessengerMode.Send {
            throw InvalidOperationException("Sending requires an unlocked spend wallet")
        }
        session.RequireUnlocked()
        return session.Node.Api
    }

    private func Prepare(conversation Conversation, text string, invite bool, enforce bool = true) PreparedSend {
        if OwnAddress.Length == 0 {
            throw InvalidOperationException("Core is disconnected")
        }
        let sender = Address.Decode(OwnAddress, Network)
        let prepared = PreparedSend()
        let recipients = List[string]()
        for member in conversation.Members {
            if member != OwnAddress && !recipients.Contains(member) {
                recipients.Add(member)
            }
        }
        if recipients.Count == 0 {
            throw ArgumentException("Conversation has no recipients")
        }
        let members = List[string](recipients)
        members.Add(OwnAddress)
        let body = if invite {
            Wire.InviteBody(conversation.Title, members, Network)
        } else {
            TextCodec.Encode(text)
        }
        prepared.Estimate.BodyBytes = body.Length
        for recipient in recipients {
            if enforce {
                Address.Decode(recipient, Network)
            }
            var introduced = false
            if let local = store {
                introduced = local.Introduced.ContainsKey(recipient)
            }
            let kind = if invite {
                uint8(3)
            } else if conversation.IsGroup {
                uint8(2)
            } else if introduced {
                uint8(0)
            } else {
                uint8(1)
            }
            let envelope = Envelope{
                Kind: kind,
                Tag: Address.Tag(sender),
                SentAt: uint32(DateTimeOffset.UtcNow.ToUnixTimeSeconds()),
                Body: body
            }
            if kind == 1 || kind == 3 {
                envelope.Sender = sender
            }
            if kind >= 2 {
                envelope.GroupId = Convert.FromHexString(conversation.Id)
            }
            let headerBytes = envelope.HeaderLength
            if headerBytes + body.Length + (kind < 2 ? 68: 0) > 512 {
                prepared.Estimate.Fits = false
                if enforce {
                    throw ArgumentException("Message exceeds the core signing limit")
                }
            }
            let size = envelope.EncodedLength
            prepared.Addresses.Add(recipient)
            prepared.Envelopes.Add(envelope)
            prepared.Estimate.BytesUsed += size
            prepared.Estimate.Outputs += (size + 123) / 124
        }
        if prepared.Estimate.Outputs > 255 {
            prepared.Estimate.Fits = false
            if enforce {
                throw ArgumentException("Message exceeds the transaction output limit")
            }
        }
        prepared.Estimate.Capacity = prepared.Estimate.Outputs * 124
        prepared.Estimate.AmountAtomic = int64(prepared.Estimate.Outputs)
        return prepared
    }

    private func WriteRecipients(writer Utf8JsonWriter, prepared PreparedSend) {
        writer.WriteStartObject()
        writer.WriteBoolean("dry_run", false)
        writer.WriteStartArray("recipients")
        for i in 0 ... prepared.Envelopes.Count {
            for memo in prepared.Envelopes[i].Split() {
                writer.WriteStartObject()
                writer.WriteString("address", prepared.Addresses[i])
                writer.WriteNumber("amount", 1)
                writer.WriteString("memo_hex", memo)
                writer.WriteEndObject()
            }
        }
        writer.WriteEndArray()
        writer.WriteEndObject()
    }

    private func IsCurrent(message Message?, version int64) bool {
        lock sending {
            if version != generation {
                throw OperationCanceledException("The wallet session changed")
            }
            return message == nil || sending.ContainsKey(message)
        }
    }

    private async func Transmit(
        conversation Conversation,
        text string,
        invite bool,
        message Message?,
        version int64,
        ct CancellationToken
    ) {
        if !invite && string.IsNullOrWhiteSpace(text) {
            throw ArgumentException("Message is empty")
        }
        let account = OwnAddress
        await session.BeginAsync(ct, false)
        try {
            if !IsCurrent(message, version) {
                return
            }
            if account != OwnAddress || (message != nil && message.SenderAddress != OwnAddress) {
                throw WalletException("The wallet changed before the message was sent")
            }
            let client = RequireSend()
            session.Touch()
            var target = conversation
            if conversation.Id.StartsWith("$", StringComparison.Ordinal) {
                target = await ResolveConversation(conversation.Title, conversation.Id, ct)
                lock sending {
                    if message != nil {
                        if !IsCurrent(message, version) {
                            return
                        }
                        sending[message] = target.Id
                        message.ConversationId = target.Id
                    }
                    target.Messages = conversations.Find(item -> item.Id == conversation.Id)
                        ?.Messages ??
                        List[Message]()
                    conversations = conversations.Where(item -> item.Id != conversation.Id).ToList()
                }
            }
            store?.Removed.TryRemove(target.Id, out _)
            if !invite {
                SaveConversation(target)
            }
            var payload = message?.SendPayload ?? Array.Empty[uint8]()
            if payload.Length == 0 {
                let prepared = Prepare(target, text, invite)
                for i in 0 ... prepared.Envelopes.Count {
                    let envelope = prepared.Envelopes[i]
                    let signing = envelope.SigningString(Address.Decode(prepared.Addresses[i], Network))
                    let signature = await session.Proofs.SignCoreAsync(signing, ct)
                    envelope.Signature = Convert.FromHexString(signature)
                    if envelope.Signature.Length != 64 {
                        throw FormatException("Core returned an invalid signature")
                    }
                }
                using let stream = MemoryStream()
                using let writer = Utf8JsonWriter(stream)
                WriteRecipients(writer, prepared)
                writer.Flush()
                payload = stream.ToArray()
                if message != nil {
                    message.Outputs = prepared.Estimate.Outputs
                    message.SendPayload = payload
                }
            }
            if !IsCurrent(message, version) {
                return
            }
            using let sent = await client.JsonAsync(
                "wallet/send",
                writer -> writer.WriteRawValue(ReadOnlySpan[uint8](payload), true),
                ct,
                message?.IdempotencyKey ?? Guid.NewGuid().ToString("N"),
                true
            )
            if message != nil {
                message.Txid = NodeJson.Text(sent.RootElement, "txid")
                message.FeeAtomic = int64(NodeJson.Number(sent.RootElement, "fee"))
                message.State = MessageState.Pending
            }
            if invite {
                SaveConversation(target)
            }
        } finally {
            session.End()
        }
        try {
            if message != nil {
                if let local = store {
                    await Persist(local, CancellationToken.None)
                }
            }
            await session.RefreshAsync(ct)
        } catch (error Exception) {
            Error = error.Message
            session.Changed?.Invoke()
        }
    }

    private func SaveConversation(conversation Conversation) {
        let local = store ?? throw WalletException("Load a wallet first")
        lock sending {
            let current = conversations.Find(item -> item.Id == conversation.Id)
            if current != nil {
                conversation.Messages = current.Messages
                conversation.Unread = current.Unread
            }
            local.Conversations[conversation.Id] = conversation
            let list = List[Conversation](conversations)
            list.RemoveAll(item -> item.Id == conversation.Id)
            list.Add(conversation)
            conversations = list
        }
    }
}
