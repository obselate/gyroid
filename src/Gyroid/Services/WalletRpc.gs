package Gyroid.Services

import Gyroid.Model
import System
import System.Diagnostics
import System.IO
import System.Net
import System.Net.Http
import System.Net.Http.Headers
import System.Net.Sockets
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class WalletRpc : IDisposable {
    let settings WalletSettings
    var verifiedPid int32
    var verifiedStart int64
    let http HttpClient

    init(settings WalletSettings) {
        this.settings = settings
        http = NewHttp()
    }

    private func NewHttp() HttpClient {
        settings.Validate()
        let handler = SocketsHttpHandler{AllowAutoRedirect: false, UseProxy: false}
        handler.ConnectCallback = (context, ct) -> ValueTask[Stream](ConnectVerifiedAsync(ct))
        let client = HttpClient(handler)
        client.BaseAddress = Uri(settings.Endpoint)
        client.Timeout = TimeSpan.FromSeconds(180)
        return client
    }

    private func VerifyListener() int32 {
        try {
            let pid = WalletCore.Listener(Uri(settings.Endpoint))
            if settings.OwnedProcessId != 0 && pid != settings.OwnedProcessId {
                throw WalletException("API listener is not the app-owned core process")
            }
            using let process = Process.GetProcessById(pid)
            let started = process.StartTime.ToUniversalTime().Ticks
            if pid != verifiedPid || started != verifiedStart {
                WalletCore.VerifyExecutable(WalletCore.ProcessExecutable(pid))
                verifiedPid = pid
                verifiedStart = started
            }
            return pid
        } catch (error Exception) {
            if error is WalletException {
                throw error
            }
            throw WalletException("API listener identity could not be verified")
        }
    }

    private async func ConnectVerifiedAsync(ct CancellationToken) Stream {
        let pid = VerifyListener()
        let endpoint = Uri(settings.Endpoint)
        let address = IPAddress.Parse(endpoint.Host.Trim('[', ']'))
        let socket = Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp)
        try {
            await socket.ConnectAsync(IPEndPoint(address, endpoint.Port), ct)
            if VerifyListener() != pid {
                throw WalletException("API listener identity changed during connection")
            }
            return NetworkStream(socket, true)
        } catch (error Exception) {
            socket.Dispose()
            throw error
        }
    }

    prop ListenerStarted int64 {
        get {
            VerifyListener()
            return verifiedStart
        }
    }

    async func EventsAsync(receive Func[string, Task], ct CancellationToken) {
        using let client = NewHttp()
        client.Timeout = Timeout.InfiniteTimeSpan
        using let request = HttpRequestMessage(HttpMethod.Get, "api/events")
        VerifyListener()
        request
            .Headers
            .Authorization = AuthenticationHeaderValue(
            "Bearer",
            WalletFiles.Cookie(Path.Combine(settings.DataDirectory, "api.cookie"))
        )
        request.Headers.Accept.Add(MediaTypeWithQualityHeaderValue("text/event-stream"))
        using let response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct)
        response.EnsureSuccessStatusCode()
        using let stream = await response.Content.ReadAsStreamAsync(ct)
        using let reader = StreamReader(stream)
        var eventName = ""
        while !ct.IsCancellationRequested {
            let line = await reader.ReadLineAsync(ct)
            if line == nil {
                return
            }
            if line.Length == 0 {
                if eventName == "connected" || eventName == "new_block" || eventName == "mined_block" {
                    await receive(eventName)
                }
                eventName = ""
            } else if line.StartsWith("event:", StringComparison.Ordinal) {
                eventName = line.Substring(6).Trim()
            }
        }
    }

    async func JsonAsync(
        path string,
        body Action[Utf8JsonWriter]? = nil,
        ct CancellationToken = default(CancellationToken),
        idempotencyKey string = "",
        submitting bool = false
    ) JsonDocument {
        let bytes = await BytesAsync(path, body, ct, idempotencyKey, submitting)
        try {
            try {
                using let stream = MemoryStream(bytes, false)
                return JsonDocument.Parse(stream)
            } catch (error JsonException) {
                throw WalletException("Daemon returned an invalid response", 0, submitting)
            }
        } finally {
            Array.Clear(bytes)
        }
    }

    async func BytesAsync(
        path string,
        body Action[Utf8JsonWriter]? = nil,
        cancellation CancellationToken = default(CancellationToken),
        idempotencyKey string = "",
        submitting bool = false
    )[]uint8 {
        using let deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)
        deadline.CancelAfter(TimeSpan.FromSeconds(180))
        let ct = deadline.Token
        using let payload = MemoryStream()
        using let request = HttpRequestMessage(
            if body == nil {
                HttpMethod.Get
            } else {
                HttpMethod.Post
            },
            "api/" + path
        )
        try {
            VerifyListener()
            try {
                if let write = body {
                    using let writer = Utf8JsonWriter(payload)
                    write(writer)
                    writer.Flush()
                    let content = ByteArrayContent(payload.GetBuffer(), 0, int32(payload.Length))
                    content.Headers.ContentType = MediaTypeHeaderValue("application/json")
                    request.Content = content
                }
                let token = WalletFiles.Cookie(Path.Combine(settings.DataDirectory, "api.cookie"))
                request.Headers.Authorization = AuthenticationHeaderValue("Bearer", token)
                if idempotencyKey.Length > 0 {
                    request.Headers.Add("Idempotency-Key", idempotencyKey)
                }
                using let response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct)
                let code = int32(response.StatusCode)
                if !response.IsSuccessStatusCode {
                    var message = switch code {
                        case 400: "Daemon rejected the request. Check the wallet inputs, funds and memo limits"
                        case 401: "Node access denied. Check the cookie configuration"
                        case 403: "Wallet is locked or this operation is not allowed"
                        case 404: "Wallet file or requested resource was not found"
                        case 409: "A wallet is already loaded or the target file already exists. Unload explicitly or choose another name"
                        case 429: "Too many attempts. Wait before trying again"
                        case 503: "No wallet is loaded or the daemon is not ready"
                        default: "Daemon request failed with HTTP " + code.ToString()
                    }
                    if code == 401 && (await response.Content.ReadAsStringAsync(ct)).Contains(
                        "password",
                        StringComparison.Ordinal
                    ) {
                        message = "Wrong wallet password"
                    }
                    throw WalletException(message, code, submitting && code >= 500)
                }
                using let stream = await response.Content.ReadAsStreamAsync(ct)
                using let output = MemoryStream()
                let buffer = [16384]uint8
                try {
                    while true {
                        let read = await stream.ReadAsync(buffer, 0, buffer.Length, ct)
                        if read == 0 {
                            break
                        }
                        if output.Length + read > 33554432 {
                            throw WalletException("Daemon response exceeds the supported size", 0, submitting)
                        }
                        output.Write(buffer, 0, read)
                    }
                    return output.ToArray()
                } finally {
                    Array.Clear(buffer)
                    Array.Clear(output.GetBuffer())
                }
            } catch (error OperationCanceledException) {
                throw WalletException(
                    if submitting {
                        "Send outcome is unknown. Refresh outgoing sends before any new attempt"
                    } else {
                        "Wallet request was cancelled or timed out"
                    },
                    0,
                    submitting
                )
            } catch (error HttpRequestException) {
                throw WalletException(
                    if submitting {
                        "Send outcome is unknown. Refresh outgoing sends before any new attempt"
                    } else {
                        "Cannot reach the configured daemon"
                    },
                    0,
                    submitting
                )
            } catch (error IOException) {
                throw WalletException(
                    if submitting {
                        "Send outcome is unknown. Refresh outgoing sends before any new attempt"
                    } else {
                        "Cannot read the configured wallet transport"
                    },
                    0,
                    submitting
                )
            } catch (error UnauthorizedAccessException) {
                throw WalletException("Access to the configured API cookie was denied")
            }
        } finally {
            if payload.Capacity > 0 {
                Array.Clear(payload.GetBuffer())
            }
        }
    }

    async func SeedAsync(password[]char, ct CancellationToken)[]char {
        let bytes = await BytesAsync(
            "wallet/seed",
            writer -> {
                writer.WriteStartObject()
                writer.WriteString("password", ReadOnlySpan[char](password))
                writer.WriteEndObject()
            },
            ct
        )
        try {
            try {
                return ReadSeed(bytes)
            } catch (error JsonException) {
                throw WalletException("Daemon returned an invalid recovery phrase response")
            }
        } finally {
            Array.Clear(bytes)
        }
    }

    private func ReadSeed(bytes[]uint8)[]char {
        let reader = Utf8JsonReader(ReadOnlySpan[uint8](bytes), true, JsonReaderState())
        while reader.Read() {
            if reader.TokenType == JsonTokenType.PropertyName && reader.ValueTextEquals("mnemonic") {
                if !reader.Read() || reader.TokenType != JsonTokenType.String {
                    break
                }
                let buffer = [int32(reader.ValueSpan.Length)]char
                try {
                    let length = reader.CopyString(Span[char](buffer))
                    let phrase = [length]char
                    Array.Copy(buffer, phrase, length)
                    return phrase
                } finally {
                    Array.Clear(buffer)
                }
            }
        }
        throw WalletException("Daemon returned no recovery phrase")
    }

    func Dispose() {
        http.Dispose()
    }
}

class WalletJson {
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
