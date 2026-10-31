package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Generic
import System.Globalization
import System.Text

class WalletText {
    shared {
        func Outcome(value SendOutcome) string -> if value.TxId.Length > 0 {
            "Submitted: " + value.TxId
        } else if let message = value.Error {
            "Send failed: " + message
        } else {
            ""
        }

        func Hidden(privacy bool, value string) string -> if privacy {
            "••••••••"
        } else {
            value
        }

        func SafeText(value string, limit int32 = 0) string {
            let count = limit > 0 ? Math.Min(value.Length, limit): value.Length
            let result = StringBuilder(count + 1)
            for index in 0 ... count {
                let character = value[index]
                result.Append(
                    char.IsControl(character) ||
                        character == '\u2028' ||
                        character == '\u2029' ||
                        character == '\u061c' ||
                        character == '\u200e' ||
                        character == '\u200f' ||
                        (character >= '\u202a' && character <= '\u202e') ||
                        (character >= '\u2066' && character <= '\u2069') ? ' ': character
                )
            }
            if count < value.Length {
                if count > 0 && char.IsHighSurrogate(result[result.Length - 1]) {
                    result.Length--
                }
                result.Append('…')
            }
            return result.ToString()
        }

        func Amount(privacy bool, value uint64) string -> Hidden(privacy, WalletAmount.Format(value))

        func Count(value uint64) string -> value.ToString("N0", CultureInfo.InvariantCulture)

        func Short(address string) string -> if address.Length > 13 {
            address.Substring(0, 8) + "…" + address.Substring(address.Length - 5)
        } else {
            address
        }

        func WalletName(filename string) string -> if filename.EndsWith(".wallet.dat", StringComparison.Ordinal) {
            filename.Substring(0, filename.Length - 11)
        } else {
            filename
        }

        func WalletFile(label string) string {
            let trimmed = label.Trim()
            return if trimmed.EndsWith(".wallet.dat", StringComparison.Ordinal) {
                trimmed
            } else {
                trimmed + ".wallet.dat"
            }
        }

        func Grouped(value string) string {
            let groups = List[string]()
            var start = 0
            while start < value.Length {
                groups.Add(value.Substring(start, Math.Min(8, value.Length - start)))
                start += 8
            }
            return String.Join(" ", groups)
        }

        func Time(seconds int64) string -> DateTimeOffset
            .FromUnixTimeSeconds(seconds)
            .ToLocalTime()
            .ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)

        func Clock(seconds int64) string -> DateTimeOffset
            .FromUnixTimeSeconds(seconds)
            .ToLocalTime()
            .ToString("HH:mm", CultureInfo.InvariantCulture)
    }
}
