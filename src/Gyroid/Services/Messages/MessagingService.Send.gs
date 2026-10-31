package Gyroid.Services

import Gyroid.Models

import System
import System.Collections.Generic
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
            let headerBytes = 9 + (kind >= 2 ? 8: 0) + (kind == 1 || kind == 3 ? 68: 0)
            if headerBytes + body.Length + (kind < 2 ? 68: 0) > 512 {
                prepared.Estimate.Fits = false
                if enforce {
                    throw ArgumentException("Message exceeds the core signing limit")
                }
            }
            let size = headerBytes + 64 + body.Length
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

    private async func Transmit(
        conversation Conversation,
        text string,
        invite bool,
        message Message?,
        ct CancellationToken
    ) {
        if !invite && string.IsNullOrWhiteSpace(text) {
            throw ArgumentException("Message is empty")
        }
        await session.BeginAsync(ct, false)
        try {
            let client = RequireSend()
            let prepared = Prepare(conversation, text, invite)
            for i in 0 ... prepared.Envelopes.Count {
                let envelope = prepared.Envelopes[i]
                let signing = envelope.SigningString(Address.Decode(prepared.Addresses[i], Network))
                using let signed = await client.JsonAsync(
                    "wallet/sign",
                    writer -> {
                        writer.WriteStartObject()
                        writer.WriteString("message", signing)
                        writer.WriteEndObject()
                    },
                    ct
                )
                envelope.Signature = Convert.FromHexString(NodeJson.Text(signed.RootElement, "signature"))
                if envelope.Signature.Length != 64 {
                    throw FormatException("Core returned an invalid signature")
                }
            }
            using let sent = await client.JsonAsync(
                "wallet/send",
                writer -> WriteRecipients(writer, prepared),
                ct,
                Guid.NewGuid().ToString("N"),
                true
            )
            if let item = message {
                item.Txid = NodeJson.Text(sent.RootElement, "txid")
                item.State = MessageState.Pending
                item.EtaSeconds = AverageBlockSeconds
                lock sending {
                    sending.Remove(item)
                }
            }
            if invite {
                SaveConversation(conversation)
                store?.Save()
            }
            try {
                using let address = await client.JsonAsync("wallet/address", ct: ct)
                await RefreshCoreAsync(address.RootElement, ct)
            } catch (error Exception) {
                Error = error.Message
            }
        } finally {
            session.End()
        }
    }

    private func SaveConversation(conversation Conversation) {
        let local = store ?? throw WalletException("Load a wallet first")
        let current = conversations.Find(item -> item.Id == conversation.Id)
        if current != nil && conversation.Messages.Count == 0 {
            conversation.Messages = current.Messages
            conversation.Unread = current.Unread
        }
        local.SaveContact(conversation)
        let list = List[Conversation](conversations)
        list.RemoveAll(item -> item.Id == conversation.Id)
        list.Add(conversation)
        conversations = list
    }
}
