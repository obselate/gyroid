package Gyroid.Contacts

import Gyroid.Platform
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.IO
import System.Text.Json

class AddressBook {
    shared {
        private func ContactsPath() string {
            let directory = Path.GetDirectoryName(WalletSettings.ConfigurationPath()) ??
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
            let temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp"
            try {
                using let stream = PrivateFiles.CreatePrivate(temporary)
                using let writer = Utf8JsonWriter(stream)
                writer.WriteStartObject()
                for (name, address) in contacts {
                    writer.WriteString(name, address)
                }
                writer.WriteEndObject()
                writer.Flush()
                writer.Dispose()
                stream.Flush(true)
                stream.Dispose()
                File.Move(temporary, path, true)
            } finally {
                if File.Exists(temporary) {
                    File.Delete(temporary)
                }
            }
        }
    }
}
