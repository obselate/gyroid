package Gyroid.Services

import Gyroid.Models
import NSec.Cryptography
import System
import System.Collections.Concurrent
import System.Collections.Generic
import System.IO
import System.Security.Cryptography
import System.Text
import System.Text.Json
import System.Threading.Tasks

class MessagingStore : IDisposable {
    private let path string?
    private let key Key?
    private let verificationOrder Queue[string] = Queue[string]()
    private var canSave bool
    var Error string = ""
    let Conversations ConcurrentDictionary[string, Conversation] = ConcurrentDictionary[string, Conversation](
        StringComparer.Ordinal
    )
    let Verified ConcurrentDictionary[string, Verification] = ConcurrentDictionary[string, Verification](
        StringComparer.Ordinal
    )
    let ReadMarkers ConcurrentDictionary[string, int64] = ConcurrentDictionary[string, int64](StringComparer.Ordinal)
    let Introduced ConcurrentDictionary[string, bool] = ConcurrentDictionary[string, bool](StringComparer.Ordinal)
    let Removed ConcurrentDictionary[string, int64] = ConcurrentDictionary[string, int64](StringComparer.Ordinal)

    init(network string, address string, viewPrivate[]char) {
        if viewPrivate.Length == 0 {
            return
        }
        canSave = true
        let directory = Path.GetDirectoryName(SettingsStore.ConfigurationPath()) ??
            throw WalletException("Settings file must have a parent directory")
        let secret = Convert.FromHexString(ReadOnlySpan[char](viewPrivate))
        let material = HKDF.DeriveKey(
            HashAlgorithmName.SHA256,
            secret,
            32,
            info: Encoding.UTF8.GetBytes("gyroid/messages-store/v1/" + network)
        )
        try {
            let creation = KeyCreationParameters()
            key = Key.Import(
                AeadAlgorithm.XChaCha20Poly1305,
                ReadOnlySpan[uint8](material),
                KeyBlobFormat.RawSymmetricKey,
                in creation
            )
            let account = Convert.ToHexStringLower(
                HMACSHA256.HashData(material, Encoding.UTF8.GetBytes("gyroid/messages-store/path/v1/" + network))
            )
            path = Path.Combine(directory, "messages-" + network + "-" + account + ".json")
        } finally {
            CryptographicOperations.ZeroMemory(Span[uint8](secret))
            CryptographicOperations.ZeroMemory(Span[uint8](material))
        }
        guard let path = path else {
            return
        }
        let legacy = Path.Combine(
            directory,
            "messages-" + network + "-" + Convert.ToHexStringLower(SHA3_256.HashData(Encoding.UTF8.GetBytes(address))) +
                ".json"
        )
        let encrypted = File.Exists(path)
        let migrate = File.Exists(legacy)
        if !encrypted && !migrate {
            return
        }
        var plaintext[]uint8 = []uint8{}
        try {
            if !encrypted {
                plaintext = Encoding.UTF8.GetBytes(PrivateFiles.ReadText(legacy, 4194304))
            } else {
                using let stream = PrivateFiles.OpenRead(path)
                if stream.Length < 41 || stream.Length > 4194345 {
                    throw FormatException("Invalid encrypted messaging store size")
                }
                let bytes = [int32(stream.Length)]uint8
                stream.ReadExactly(Span[uint8](bytes))
                if bytes[0] != 1 {
                    throw FormatException("Unsupported messaging store version")
                }
                plaintext = AeadAlgorithm.XChaCha20Poly1305.Decrypt(
                    key,
                    ReadOnlySpan[uint8](bytes, 1, 24),
                    ReadOnlySpan[uint8](bytes, 0, 25),
                    ReadOnlySpan[uint8](bytes, 25, bytes.Length - 25)
                ) ??
                    throw CryptographicException("Messaging store authentication failed")
            }
            using let document = JsonDocument.Parse(ReadOnlyMemory[uint8](plaintext))
            let data = document.RootElement
            for entry in ReadField(data, "conversations", JsonValueKind.Array).EnumerateArray() {
                let members = ReadField(entry, "members", JsonValueKind.Array)
                let conversation = Conversation{
                    Id: NodeJson.Text(entry, "id"),
                    Title: NodeJson.Text(entry, "name"),
                    Handle: NodeJson.Text(entry, "handle"),
                    IsGroup: NodeJson.Flag(entry, "group")
                }
                for member in members.EnumerateArray() {
                    if member.ValueKind != JsonValueKind.String {
                        throw JsonException("Invalid messaging store member")
                    }
                    let value = member.GetString() ?? ""
                    try {
                        Address.Decode(value, network)
                    } catch (error ArgumentException) {
                        throw FormatException(error.Message, error)
                    }
                    conversation.Members.Add(value)
                }
                if entry.TryGetProperty("failed", out _) {
                    for message in ReadField(entry, "failed", JsonValueKind.Array).EnumerateArray() {
                        conversation.Messages.Add(
                            Message{
                                Key: NodeJson.Text(message, "key"),
                                ConversationId: conversation.Id,
                                IdempotencyKey: NodeJson.Text(message, "idempotency_key"),
                                SendPayload: Convert.FromBase64String(NodeJson.Text(message, "payload")),
                                Outgoing: true,
                                SenderAddress: address,
                                SenderName: "You",
                                FailureReason: NodeJson.Text(message, "failure_reason"),
                                Text: NodeJson.Text(message, "text"),
                                SentAt: DateTimeOffset.FromUnixTimeSeconds(
                                    ReadNumber(ReadField(message, "sent_at", JsonValueKind.Number))
                                ),
                                State: MessageState.Failed
                            }
                        )
                    }
                }
                Conversations[conversation.Id] = conversation
            }
            for entry in ReadField(data, "verified", JsonValueKind.Object).EnumerateObject() {
                let value = ReadNumber(entry.Value)
                if value < 0 || value > int64(Verification.Invalid) {
                    throw FormatException("Invalid messaging verification state")
                }
                RecordVerification(entry.Name, Verification(value))
            }
            for entry in ReadField(data, "read", JsonValueKind.Object).EnumerateObject() {
                ReadMarkers[entry.Name] = ReadNumber(entry.Value)
            }
            for entry in ReadField(data, "introduced", JsonValueKind.Array).EnumerateArray() {
                if entry.ValueKind != JsonValueKind.String {
                    throw JsonException("Invalid messaging introduction")
                }
                Introduced[entry.GetString() ?? ""] = true
            }
            for entry in ReadField(data, "removed", JsonValueKind.Object).EnumerateObject() {
                Removed[entry.Name] = ReadNumber(entry.Value)
            }
            if migrate {
                Save()
                File.Delete(legacy)
            }
        } catch (error Exception) {
            Error = "Messaging store is unreadable: " + error.Message
            Conversations.Clear()
            Verified.Clear()
            verificationOrder.Clear()
            ReadMarkers.Clear()
            Introduced.Clear()
            Removed.Clear()
            canSave = false
        } finally {
            CryptographicOperations.ZeroMemory(Span[uint8](plaintext))
        }
    }

    private func ReadField(value JsonElement, name string, kind JsonValueKind) JsonElement {
        if value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(name, out let field) ||
            field.ValueKind != kind {
            throw JsonException("Invalid messaging store field: " + name)
        }
        return field
    }

    private func ReadNumber(value JsonElement) int64 {
        if value.ValueKind != JsonValueKind.Number {
            throw JsonException("Invalid messaging store number")
        }
        return value.GetInt64()
    }

    func RecordVerification(key string, value Verification) {
        if Verified.TryAdd(key, value) {
            verificationOrder.Enqueue(key)
        } else {
            Verified[key] = value
        }
    }

    func MarkRead(conversation Conversation) {
        var latest int64
        for message in conversation.Messages {
            latest = Math.Max(latest, message.SentAt.ToUnixTimeSeconds())
        }
        ReadMarkers[conversation.Id] = latest
    }

    func Save() {
        lock verificationOrder {
            while verificationOrder.Count > 4096 {
                Verified.TryRemove(verificationOrder.Dequeue(), out _)
            }
            if !canSave {
                return
            }
            guard let path = path else {
                return
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? "")
            PrivateFiles
                .WriteAtomic(
                path,
                stream -> {
                    using let payload = MemoryStream()
                    using let writer = Utf8JsonWriter(payload)
                    writer.WriteStartObject()
                    writer.WriteStartArray("conversations")
                    for pair in Conversations {
                        let conversation = pair.Value
                        writer.WriteStartObject()
                        writer.WriteString("id", conversation.Id)
                        writer.WriteString("name", conversation.Title)
                        writer.WriteString("handle", conversation.Handle)
                        writer.WriteBoolean("group", conversation.IsGroup)
                        writer.WriteStartArray("members")
                        for member in conversation.Members {
                            writer.WriteStringValue(member)
                        }
                        writer.WriteEndArray()
                        writer.WriteStartArray("failed")
                        for message in conversation.Messages {
                            if message.Outgoing && message.Txid.Length == 0 && message.State == MessageState.Failed {
                                writer.WriteStartObject()
                                writer.WriteString("key", message.Key)
                                writer.WriteString("idempotency_key", message.IdempotencyKey)
                                writer.WriteBase64String("payload", ReadOnlySpan[uint8](message.SendPayload))
                                writer.WriteString("text", message.Text)
                                writer.WriteString("failure_reason", message.FailureReason)
                                writer.WriteNumber("sent_at", message.SentAt.ToUnixTimeSeconds())
                                writer.WriteEndObject()
                            }
                        }
                        writer.WriteEndArray()
                        writer.WriteEndObject()
                    }
                    writer.WriteEndArray()
                    writer.WriteStartObject("verified")
                    for key in verificationOrder {
                        writer.WriteNumber(key, int32(Verified[key]))
                    }
                    writer.WriteEndObject()
                    writer.WriteStartObject("read")
                    for pair in ReadMarkers {
                        writer.WriteNumber(pair.Key, pair.Value)
                    }
                    writer.WriteEndObject()
                    writer.WriteStartArray("introduced")
                    for pair in Introduced {
                        writer.WriteStringValue(pair.Key)
                    }
                    writer.WriteEndArray()
                    writer.WriteStartObject("removed")
                    for pair in Removed {
                        writer.WriteNumber(pair.Key, pair.Value)
                    }
                    writer.WriteEndObject()
                    writer.WriteEndObject()
                    writer.Flush()
                    let header = [25]uint8
                    header[0] = 1
                    RandomNumberGenerator.Fill(Span[uint8](header, 1, 24))
                    try {
                        let encrypted = AeadAlgorithm.XChaCha20Poly1305.Encrypt(
                            key,
                            ReadOnlySpan[uint8](header, 1, 24),
                            ReadOnlySpan[uint8](header),
                            ReadOnlySpan[uint8](payload.GetBuffer(), 0, int32(payload.Length))
                        )
                        stream.Write(header, 0, header.Length)
                        stream.Write(encrypted, 0, encrypted.Length)
                    } finally {
                        CryptographicOperations.ZeroMemory(Span[uint8](payload.GetBuffer()))
                    }
                    return Task.CompletedTask
                },
                true,
                false
            )
                .GetAwaiter()
                .GetResult()
        }
    }

    func Dispose() {
        lock verificationOrder {
            canSave = false
            key?.Dispose()
        }
    }
}
