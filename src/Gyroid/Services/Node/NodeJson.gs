package Gyroid.Services

import Gyroid.Models
import System
import System.IO
import System.Text
import System.Text.Json

class NodeJson {
    shared {
        func Text(value JsonElement, name string, fallback string = "") string {
            if value.TryGetProperty(name, out let found) && found.ValueKind == JsonValueKind.String {
                return found.GetString() ?? fallback
            }
            return fallback
        }

        func Flag(value JsonElement, name string) bool -> value.TryGetProperty(name, out let found) &&
            found.ValueKind == JsonValueKind.True

        func OptionalNumber(value JsonElement, name string) uint64? {
            if value.TryGetProperty(name, out let found) && found.TryGetUInt64(out let number) {
                return number
            }
            return nil
        }

        func Number(value JsonElement, name string) uint64 {
            if let number = OptionalNumber(value, name) {
                return number
            }
            throw WalletException("Daemon response omitted a required numeric field")
        }

        func Signed(value JsonElement, name string) int64 {
            if value.TryGetProperty(name, out let found) && found.TryGetInt64(out let number) {
                return number
            }
            throw WalletException("Daemon response omitted a required timestamp")
        }

        func Integer(value JsonElement, name string) int64 -> value.TryGetProperty(name, out let found) &&
            found.TryGetInt64(out let number) ? number: 0

        func MessageMemo(hex string, network string) string? {
            try {
                let envelope = Wire.Decode(Convert.FromHexString(hex), network)
                return envelope.Kind == 3 ? "Group invitation: " + envelope.GroupName: envelope.Text
            } catch (error FormatException) {
                return nil
            } catch (error ArgumentException) {
                return nil
            } catch (error EndOfStreamException) {
                return nil
            }
        }

        func Memo(hex string, network string = "") string {
            if hex.Length == 0 {
                return ""
            }
            if network.Length > 0 {
                if let message = MessageMemo(hex, network) {
                    return message
                }
            }
            try {
                return UTF8Encoding(false, true).GetString(Convert.FromHexString(hex))
            } catch (error FormatException) {
                return "[non-text memo]"
            } catch (error DecoderFallbackException) {
                return "[non-text memo]"
            }
        }
    }
}
