package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Concurrent
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Threading.Tasks

class MessagingStore {
    private let path string
    private let account string
    let Contacts ConcurrentDictionary[string, Conversation] = ConcurrentDictionary[string, Conversation](
        StringComparer.Ordinal
    )
    let Verified ConcurrentDictionary[string, Verification] = ConcurrentDictionary[string, Verification](
        StringComparer.Ordinal
    )
    let ReadMarkers ConcurrentDictionary[string, int64] = ConcurrentDictionary[string, int64](StringComparer.Ordinal)
    let Introduced ConcurrentDictionary[string, bool] = ConcurrentDictionary[string, bool](StringComparer.Ordinal)
    let Removed ConcurrentDictionary[string, int64] = ConcurrentDictionary[string, int64](StringComparer.Ordinal)
    let Handles ConcurrentDictionary[string, string] = ConcurrentDictionary[string, string](StringComparer.Ordinal)

    init(network string, address string) {
        let directory = Path.GetDirectoryName(SettingsStore.ConfigurationPath()) ??
            throw WalletException("Settings file must have a parent directory")
        path = Path.Combine(directory, "messages.json")
        account = network + ":" + address
        if File.Exists(path) {
            using let document = JsonDocument.Parse(PrivateFiles.ReadText(path, 1048576))
            if document.RootElement.TryGetProperty(account, out let data) {
                for entry in data.GetProperty("groups").EnumerateArray() {
                    let group = Conversation{
                        Id: NodeJson.Text(entry, "id"),
                        Title: NodeJson.Text(entry, "name"),
                        IsGroup: true
                    }
                    for member in entry.GetProperty("members").EnumerateArray() {
                        let value = member.GetString() ?? ""
                        Address.Decode(value, network)
                        group.Members.Add(value)
                    }
                    Contacts[group.Id] = group
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
                for entry in data.GetProperty("handles").EnumerateObject() {
                    Handles[entry.Name] = entry.Value.GetString() ?? ""
                }
            }
        }
        ReloadContacts(network)
    }

    func ReloadContacts(network string) {
        for pair in Contacts {
            if !pair.Value.IsGroup {
                Contacts.TryRemove(pair.Key, out _)
            }
        }
        for entry in AddressBook.ReadContacts(
            message -> {
                throw WalletException(message)
            }
        ) {
            let unresolved = entry.Value.StartsWith("$", StringComparison.Ordinal)
            if !unresolved {
                if WalletValidation.AddressIssue(entry.Value, network).Length > 0 {
                    continue
                }
                Address.Decode(entry.Value, network)
            }
            Handles.TryGetValue(entry.Value, out let handle)
            let contact = Conversation{
                Id: entry.Value,
                Title: entry.Key,
                Handle: unresolved ? entry.Value: handle ?? ""
            }
            contact.Members.Add(entry.Value)
            Contacts[contact.Id] = contact
        }
    }

    func SaveContact(conversation Conversation) {
        if conversation.IsGroup {
            Contacts[conversation.Id] = conversation
            return
        }
        let contacts = AddressBook.ReadContacts(
            message -> {
                throw WalletException(message)
            }
        )
        if conversation.Handle.Length > 0 {
            for entry in contacts {
                if string.Equals(entry.Value, conversation.Handle, StringComparison.OrdinalIgnoreCase) {
                    contacts[entry.Key] = conversation.Id
                    conversation.Title = entry.Key
                    AddressBook.WriteContacts(contacts)
                    Contacts.TryRemove(entry.Value, out _)
                    break
                }
            }
        }
        if !contacts.ContainsValue(conversation.Id) {
            var title = conversation.Title
            var suffix = 2
            while contacts.ContainsKey(title) && contacts[title] != conversation.Id {
                title = conversation.Title + " " + suffix.ToString()
                suffix++
            }
            conversation.Title = title
            contacts[title] = conversation.Id
            AddressBook.WriteContacts(contacts)
        }
        if conversation.Handle.Length > 0 {
            Handles[conversation.Id] = conversation.Handle
        }
        Contacts[conversation.Id] = conversation
    }

    func MarkRead(conversation Conversation) {
        var latest int64
        for message in conversation.Messages {
            latest = Math.Max(latest, message.SentAt.ToUnixTimeSeconds())
        }
        ReadMarkers[conversation.Id] = latest
    }

    func Save() {
        using let previous = if File.Exists(path) {
            JsonDocument.Parse(PrivateFiles.ReadText(path, 1048576))
        } else {
            JsonDocument.Parse("{}")
        }
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? "")
        PrivateFiles
            .WriteAtomic(
            path,
            stream -> {
                using let writer = Utf8JsonWriter(stream)
                writer.WriteStartObject()
                for entry in previous.RootElement.EnumerateObject() {
                    if entry.Name != account {
                        entry.WriteTo(writer)
                    }
                }
                writer.WriteStartObject(account)
                writer.WriteStartArray("groups")
                for pair in Contacts {
                    let conversation = pair.Value
                    if !conversation.IsGroup {
                        continue
                    }
                    writer.WriteStartObject()
                    writer.WriteString("id", conversation.Id)
                    writer.WriteString("name", conversation.Title)
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
                writer.WriteStartObject("removed")
                for pair in Removed {
                    writer.WriteNumber(pair.Key, pair.Value)
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
                writer.WriteStartObject("handles")
                for pair in Handles {
                    writer.WriteString(pair.Key, pair.Value)
                }
                writer.WriteEndObject()
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
