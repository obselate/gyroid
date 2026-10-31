package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Concurrent
import System.IO
import System.Security.Cryptography
import System.Text
import System.Text.Json
import System.Threading.Tasks

class MessagingStore {
    private let path string
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
            for entry in data.GetProperty("conversations").EnumerateArray() {
                let conversation = Conversation{
                    Id: NodeJson.Text(entry, "id"),
                    Title: NodeJson.Text(entry, "name"),
                    Handle: NodeJson.Text(entry, "handle"),
                    IsGroup: NodeJson.Flag(entry, "group")
                }
                for member in entry.GetProperty("members").EnumerateArray() {
                    let value = member.GetString() ?? ""
                    Address.Decode(value, network)
                    conversation.Members.Add(value)
                }
                Conversations[conversation.Id] = conversation
            }
            for entry in data.GetProperty("verified").EnumerateObject() {
                Verified[entry.Name] = Verification(entry.Value.GetInt32())
            }
            for entry in data.GetProperty("read").EnumerateObject() {
                ReadMarkers[entry.Name] = entry.Value.GetInt64()
            }
            for entry in data.GetProperty("introduced").EnumerateArray() {
                Introduced[entry.GetString() ?? ""] = true
            }
            for entry in data.GetProperty("removed").EnumerateObject() {
                Removed[entry.Name] = entry.Value.GetInt64()
            }
        } catch (error Exception) {
            Conversations.Clear()
            Verified.Clear()
            ReadMarkers.Clear()
            Introduced.Clear()
            Removed.Clear()
            File.Move(path, path + ".unreadable-" + Guid.NewGuid().ToString("N"))
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
        var excess = Verified.Count - 4096
        for key in Verified.Keys {
            if excess <= 0 {
                break
            }
            if Verified.TryRemove(key, out _) {
                excess--
            }
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
                for pair in Verified {
                    writer.WriteNumber(pair.Key, int32(pair.Value))
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
