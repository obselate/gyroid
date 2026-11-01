package Gyroid.Services

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Threading.Tasks

class AddressBook {
    shared {
        func IsDestination(value string) bool {
            try {
                WalletValidation.ValidateDestination(value)
                return true
            } catch (error WalletException) {
                return false
            }
        }

        func Resolve(contacts SortedDictionary[string, string], value string) string {
            let text = value.Trim()
            if let payment = PaymentLink.Parse(text) {
                return payment.Address
            }
            return !IsDestination(text) && contacts.TryGetValue(text, out let destination) ? destination: text
        }

        private func ContactsPath() string {
            let directory = Path.GetDirectoryName(SettingsStore.ConfigurationPath()) ??
                throw WalletException("Settings file must have a parent directory")
            return Path.Combine(directory, "contacts.json")
        }

        func ReadContacts(report Action[string]) SortedDictionary[string, string] {
            let contacts = SortedDictionary[string, string](StringComparer.Ordinal)
            let path = ContactsPath()
            if !File.Exists(path) {
                return contacts
            }
            try {
                using let json = JsonDocument.Parse(PrivateFiles.ReadText(path, 1048576))
                for entry in json.RootElement.EnumerateObject() {
                    try {
                        contacts[entry.Name] = WalletValidation.ValidateDestination(entry.Value.GetString() ?? "")
                    } catch (error Exception) {
                        report("Address book file is invalid")
                    }
                }
            } catch (error Exception) {
                throw WalletException("Address book file is invalid")
            }
            return contacts
        }

        func WriteContacts(contacts SortedDictionary[string, string]) {
            ReadContacts(
                message -> {
                    throw WalletException(message)
                }
            )
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
