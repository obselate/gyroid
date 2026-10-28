package Gyroid.Contacts

import Gyroid.Platform
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Threading.Tasks

class AddressBook {
    shared {
        private func ContactsPath() string {
            let directory = Path.GetDirectoryName(AppSettings.ConfigurationPath()) ??
                throw WalletException("Settings file must have a parent directory")
            return Path.Combine(directory, "contacts.json")
        }

        func ReadContacts() SortedDictionary[string, string] {
            let contacts = SortedDictionary[string, string](StringComparer.Ordinal)
            let path = ContactsPath()
            if !File.Exists(path) {
                return contacts
            }
            try {
                using let json = JsonDocument.Parse(PrivateFiles.ReadText(path, 1048576))
                for entry in json.RootElement.EnumerateObject() {
                    contacts[entry.Name] = WalletValidation.ValidateDestination(entry.Value.GetString() ?? "")
                }
            } catch (error Exception) {
                throw WalletException("Address book file is invalid")
            }
            return contacts
        }

        func WriteContacts(contacts SortedDictionary[string, string]) {
            let path = ContactsPath()
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? "")
            PrivateFiles
                .WriteAtomic(
                path,
                stream -> {
                    using let writer = Utf8JsonWriter(stream)
                    writer.WriteStartObject()
                    for entry in contacts {
                        writer.WriteString(entry.Key, entry.Value)
                    }
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
}
