package Gyroid.Views

import Goo
import Gyroid.Services
import System
import System.Collections.Generic
import System.Diagnostics
import System.Linq
import System.Text
import System.Threading
import System.Threading.Tasks

class UiService {
    var window Window?
    let rebuild Action
    let playbackActive Func[bool]
    let touch Action
    private let report Action[string]
    private let run Action[Func[CancellationToken, Task], Action?, []?char, []?char]
    private let background Action[Func[CancellationToken, Task]]

    init(
        rebuild Action,
        playbackActive Func[bool],
        touch Action,
        report Action[string],
        run Action[Func[CancellationToken, Task], Action?, []?char, []?char],
        background Action[Func[CancellationToken, Task]]
    ) {
        this.rebuild = rebuild
        this.playbackActive = playbackActive
        this.touch = touch
        this.report = report
        this.run = run
        this.background = background
    }

    func Report(message string) {
        report(message)
        rebuild()
    }

    func Background(action Func[CancellationToken, Task]) {
        background(action)
    }

    func Run(task Func[CancellationToken, Task], done Action? = nil, secret[]?char = nil, extra[]?char = nil) {
        run(task, done, secret, extra)
    }

    func Delay(ms float64, action Action) WindowTimer? -> window?.SetTimeout(action, ms)

    private var ClipboardTimer WindowTimer?

    var ClipboardText[]char = []char{}

    private var clipboardBytes[]uint8 = []uint8{}

    private var clipboardOwner[]uint8 = []uint8{}

    let Decoding Dictionary[string, int64] = Dictionary[string, int64]()

    var DecodeSeed int32

    var DecodeTimer WindowTimer?

    func SettleMotion() {
        Motion.TimeScale = playbackActive() ? 1.0: 0.0
    }

    func Decode(channel string) {
        if !playbackActive() {
            return
        }
        Decoding[channel] = Stopwatch.GetTimestamp()
        DecodeSeed = Random.Shared.Next()
        DecodeTimer ??= window?.SetInterval(
            () -> {
                for channel in Decoding.Keys.ToArray() {
                    if Progress(channel) >= 1 {
                        Decoding.Remove(channel)
                    }
                }
                if Decoding.Count == 0 {
                    DecodeTimer?.Dispose()
                    DecodeTimer = nil
                }
                rebuild()
            },
            30
        )
    }

    func Progress(channel string) float64 {
        if !Decoding.ContainsKey(channel) {
            return 1
        }
        return Stopwatch.GetElapsedTime(Decoding[channel]).TotalMilliseconds / 250
    }

    func Copy(content string, clearAfterMs float64) {
        guard let host = window else {
            return
        }
        ReleaseClipboard()
        try {
            host.SetClipboardText(content)
        } catch (failure Exception) {
            report("Copy failed")
            rebuild()
            return
        }
        ClipboardText = content.ToCharArray()
        ClipboardTimer = host.SetTimeout(
            () -> {
                ReleaseClipboard()
                rebuild()
            },
            clearAfterMs
        )
    }

    func Copy(content[]char, clearAfterMs float64) {
        guard let host = window else {
            return
        }
        ReleaseClipboard()
        let bytes = Encoding.UTF8.GetBytes(content)
        try {
            let text = TransferRepresentation("text/plain;charset=utf-8", ReadOnlyMemory[uint8](bytes))
            System.Runtime.InteropServices.MemoryMarshal.TryGetArray[uint8](text.Bytes, out let segment)
            clipboardBytes = segment.Array ?? throw InvalidOperationException("Clipboard buffer unavailable")
            clipboardOwner = Guid.NewGuid().ToByteArray()
            ClipboardTimer = host.SetTimeout(
                () -> {
                    ReleaseClipboard()
                    rebuild()
                },
                clearAfterMs
            )
            let result = host
                .WriteClipboardAsync(
                TransferData(
                    []TransferRepresentation{
                        text,
                        TransferRepresentation(
                            "application/x-gyroid-clipboard-owner",
                            ReadOnlyMemory[uint8](clipboardOwner)
                        )
                    },
                    Array.Empty[Uri]()
                )
            )
                .GetAwaiter()
                .GetResult()
            if result.Status != DataTransferStatus.Success {
                throw WalletException("Copy failed")
            }
        } catch (failure Exception) {
            ReleaseClipboard()
            report("Copy failed")
            rebuild()
        } finally {
            Array.Clear(bytes)
        }
    }

    func ReleaseClipboard() {
        guard let host = window else {
            return
        }
        if ClipboardTimer == nil && clipboardBytes.Length == 0 && ClipboardText.Length == 0 {
            return
        }
        ClipboardTimer?.Dispose()
        ClipboardTimer = nil
        try {
            if clipboardBytes.Length > 0 {
                let current = host
                    .ReadClipboardDataAsync([]string{"application/x-gyroid-clipboard-owner"})
                    .GetAwaiter()
                    .GetResult()
                for item in current.Data.Representations {
                    if item.Bytes.Span.SequenceEqual(ReadOnlySpan[uint8](clipboardOwner)) {
                        host.SetClipboardText("")
                        break
                    }
                }
            } else {
                let current = host.GetClipboardText()
                if System
                    .Security
                    .Cryptography
                    .CryptographicOperations
                    .FixedTimeEquals(
                    System.Runtime.InteropServices.MemoryMarshal.AsBytes[char](System.MemoryExtensions.AsSpan(current)),
                    System.Runtime.InteropServices.MemoryMarshal.AsBytes[char](ReadOnlySpan[char](ClipboardText))
                ) {
                    host.SetClipboardText("")
                }
            }
        } catch (failure Exception) {
            report("Clipboard could not be cleared")
            rebuild()
        } finally {
            Array.Clear(ClipboardText)
            ClipboardText = []char{}
            Array.Clear(clipboardBytes)
            clipboardBytes = []uint8{}
            Array.Clear(clipboardOwner)
            clipboardOwner = []uint8{}
        }
    }
}
