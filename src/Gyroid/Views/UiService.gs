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

class UiService : IDisposable {
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

    prop ClipboardOwner ReadOnlyMemory[uint8] -> ReadOnlyMemory[uint8](clipboardOwner)
    event ClipboardChanged Action

    let Decoding Dictionary[string, int64] = Dictionary[string, int64]()

    func Decode(channel string) {
        if !playbackActive() {
            return
        }
        Decoding[channel] = Stopwatch.GetTimestamp()
    }

    func Copy(content string, clearAfterMs float64) {
        if window == nil {
            return
        }
        let text = content.ToCharArray()
        let previous = ClipboardOwner
        Copy(text, clearAfterMs)
        if !previous.Equals(ClipboardOwner) {
            ClipboardText = text
        } else {
            Array.Clear(text)
        }
    }

    func Copy(content[]char, clearAfterMs float64) {
        guard let host = window else {
            return
        }
        let bytes = Encoding.UTF8.GetBytes(content)
        var nextClipboardBytes = []uint8{}
        try {
            let text = TransferRepresentation("text/plain;charset=utf-8", ReadOnlyMemory[uint8](bytes))
            System.Runtime.InteropServices.MemoryMarshal.TryGetArray[uint8](text.Bytes, out let segment)
            nextClipboardBytes = segment.Array ?? throw InvalidOperationException("Clipboard buffer unavailable")
            let nextClipboardOwner = Guid.NewGuid().ToByteArray()
            let result = host
                .WriteClipboardAsync(
                TransferData(
                    []TransferRepresentation{
                        text,
                        TransferRepresentation(
                            "application/x-gyroid-clipboard-owner",
                            ReadOnlyMemory[uint8](nextClipboardOwner)
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
            ReleaseClipboard(clear: false)
            clipboardBytes = nextClipboardBytes
            nextClipboardBytes = []uint8{}
            clipboardOwner = nextClipboardOwner
            ClipboardTimer = host.SetTimeout(
                () -> {
                    ReleaseClipboard()
                },
                clearAfterMs
            )
            ClipboardChanged?.Invoke()
        } catch (failure Exception) {
            Report("Copy failed")
        } finally {
            Array.Clear(bytes)
            Array.Clear(nextClipboardBytes)
        }
    }

    func ReleaseClipboard(clear bool = true) {
        guard let host = window else {
            return
        }
        if ClipboardTimer == nil && clipboardBytes.Length == 0 && ClipboardText.Length == 0 {
            return
        }
        ClipboardTimer?.Dispose()
        ClipboardTimer = nil
        try {
            if clear && clipboardBytes.Length > 0 {
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
            }
        } catch (failure Exception) {
            Report("Clipboard could not be cleared")
        } finally {
            Array.Clear(ClipboardText)
            ClipboardText = []char{}
            Array.Clear(clipboardBytes)
            clipboardBytes = []uint8{}
            Array.Clear(clipboardOwner)
            clipboardOwner = []uint8{}
            ClipboardChanged?.Invoke()
        }
    }

    public func Dispose() {
        ReleaseClipboard()
        Decoding.Clear()
        window = nil
    }
}
