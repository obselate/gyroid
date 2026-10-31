package Gyroid.Services

import System
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

        func Memo(hex string) string {
            if hex.Length == 0 {
                return ""
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
