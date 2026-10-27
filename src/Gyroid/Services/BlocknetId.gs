package Gyroid.Services

import Gyroid.Model
import NSec.Cryptography
import System
import System.IO
import System.Net
import System.Net.Http
import System.Text
import System.Text.Json
import System.Threading

class BlocknetId(handle string, address string) {
    let Handle string = handle
    let Address string = address

    shared {
        private let signingKey PublicKey = PublicKey.Import(
            SignatureAlgorithm.Ed25519,
            ReadOnlySpan[uint8](Convert.FromBase64String("XKI+V1wDIoyYxSM5itVKn1sr2L4VcCaijfXO5vvqisI=")),
            KeyBlobFormat.RawPublicKey
        )

        func Normalize(recipient string) string {
            if !recipient.StartsWith("$", StringComparison.Ordinal) || recipient.Length < 2 || recipient.Length > 65 {
                throw WalletException(
                    "Invalid Blocknet ID. Use $ followed by 1 to 64 letters, digits, dots, underscores or hyphens"
                )
            }
            let handle = recipient.Substring(1).ToLowerInvariant()
            for ch in handle {
                if !(ch >= 'a' && ch <= 'z') && !(ch >= '0' && ch <= '9') && ch != '.' && ch != '_' && ch != '-' {
                    throw WalletException(
                        "Invalid Blocknet ID. Use $ followed by 1 to 64 letters, digits, dots, underscores or hyphens"
                    )
                }
            }
            return handle
        }

        async func ResolveAsync(
            recipient string,
            cancellation CancellationToken = default(CancellationToken)
        ) BlocknetId {
            let handle = Normalize(recipient)
            using let deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)
            deadline.CancelAfter(TimeSpan.FromSeconds(8))
            let ct = deadline.Token
            using let http = HttpClient(
                SocketsHttpHandler{AllowAutoRedirect: false, UseProxy: false, UseCookies: false}
            )
            try {
                using let response = await http.GetAsync(
                    "https://blocknet.id/api/v1/resolve/" + handle,
                    HttpCompletionOption.ResponseHeadersRead,
                    ct
                )
                if response.StatusCode == HttpStatusCode.NotFound {
                    throw WalletException("Blocknet ID was not found")
                }
                if !response.IsSuccessStatusCode {
                    throw WalletException("Blocknet ID resolver is unavailable")
                }
                using let stream = await response.Content.ReadAsStreamAsync(ct)
                let buffer = [16385]uint8
                var count = 0
                while count < buffer.Length {
                    let read = await stream.ReadAsync(buffer, count, buffer.Length - count, ct)
                    if read == 0 {
                        break
                    }
                    count = count + read
                }
                if count > 16384 {
                    throw WalletException("Blocknet ID response exceeds the supported size")
                }
                using let document = JsonDocument.Parse(
                    ReadOnlyMemory[uint8](buffer, 0, count),
                    JsonDocumentOptions{MaxDepth: 8}
                )
                return Verify(document.RootElement, handle)
            } catch (error WalletException) {
                throw error
            } catch (error OperationCanceledException) {
                throw WalletException("Blocknet ID request was cancelled or timed out")
            } catch (error HttpRequestException) {
                throw WalletException("Cannot reach the Blocknet ID resolver")
            } catch (error IOException) {
                throw WalletException("Cannot read the Blocknet ID response")
            } catch (error Exception) {
                throw WalletException("Could not verify the Blocknet ID destination")
            }
        }

        func Verify(response JsonElement, requestedHandle string) BlocknetId {
            try {
                let payload = response.GetProperty("payload").GetString() ?? ""
                let signature = Convert.FromBase64String(response.GetProperty("sig").GetString() ?? "")
                if payload.Length == 0 ||
                    payload.Length > 8192 ||
                    signature.Length != 64 ||
                    !SignatureAlgorithm
                    .Ed25519
                    .Verify(
                    signingKey,
                    ReadOnlySpan[uint8](Encoding.UTF8.GetBytes(payload)),
                    ReadOnlySpan[uint8](signature)
                ) {
                    throw WalletException("Could not verify the Blocknet ID destination")
                }
                using let document = JsonDocument.Parse(payload, JsonDocumentOptions{MaxDepth: 4})
                let signed = document.RootElement
                let handle = signed.GetProperty("handle").GetString() ?? ""
                let address = signed.GetProperty("address").GetString() ?? ""
                let updated = signed.GetProperty("updated_at_unix").GetInt64()
                if handle != Normalize("$" + requestedHandle) || address.Length == 0 || address != address.Trim() ||
                    updated < 0 ||
                    updated > DateTimeOffset
                    .UtcNow
                    .ToUnixTimeSeconds() {
                    throw WalletException("Could not verify the Blocknet ID destination")
                }
                WalletController.ValidateAddress(address)
                return BlocknetId("$" + handle, address)
            } catch (error WalletException) {
                throw error
            } catch (error Exception) {
                throw WalletException("Could not verify the Blocknet ID destination")
            }
        }
    }
}
