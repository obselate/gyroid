package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Concurrent
import System.Collections.Generic
import System.IO
import System.Security.Cryptography
import System.Text
import System.Text.Json
import System.Threading.Tasks

class MessagingStore {
    private let path string
    private let verificationOrder Queue[string] = Queue[string]()
    private var canSave bool = true
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

    init(network string, address string) {
        let directory = Path.GetDirectoryName(SettingsStore.ConfigurationPath()) ??
            throw WalletException("Settings file must have a parent directory")
        let account = Convert.ToHexStringLower(SHA3_256.HashData(Encoding.UTF8.GetBytes(address)))
        path = Path.Combine(directory, "messages-" + network + "-" + account + ".json")
        if !File.Exists(path) {
            return
        }
        try {
            using let document = JsonDocument.Parse(PrivateFiles.ReadText(path, 4194304))
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
        } catch (error Exception) when error is JsonException || error is FormatException {
            Error = "Messaging store is unreadable: " + error.Message
            Conversations.Clear()
            Verified.Clear()
            verificationOrder.Clear()
            ReadMarkers.Clear()
            Introduced.Clear()
            Removed.Clear()
            try {
                File.Move(path, path + ".unreadable-" + Guid.NewGuid().ToString("N"))
            } catch (moveError IOException) {
                Error += ". " + moveError.Message
                canSave = false
            } catch (moveError UnauthorizedAccessException) {
                Error += ". " + moveError.Message
                canSave = false
            }
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
        while verificationOrder.Count > 4096 {
            Verified.TryRemove(verificationOrder.Dequeue(), out _)
        }
        if !canSave {
            return
        }
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? "")
        PrivateFiles
            .WriteAtomic(
            path,
            stream -> {
                using let writer = Utf8JsonWriter(stream)
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
                return Task.CompletedTask
            },
            true,
            false
        )
            .GetAwaiter()
            .GetResult()
    }
}
