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
    private let report Action[string]
    private let run Action[Func[CancellationToken, Task], Action?, []?char, []?char]
    private let background Action[Func[CancellationToken, Task]]

    init(
        rebuild Action,
        playbackActive Func[bool],
        report Action[string],
        run Action[Func[CancellationToken, Task], Action?, []?char, []?char],
        background Action[Func[CancellationToken, Task]]
    ) {
        this.rebuild = rebuild
        this.playbackActive = playbackActive
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

    private var clipboardTimer WindowTimer?
    var ClipboardText[]char = []char{}
    private var clipboardBytes[]uint8 = []uint8{}
    private var clipboardOwner[]uint8 = []uint8{}
    private var activeCopy ClipboardPublication?
    private var pendingCopy ClipboardPublication?
    private var releaseTask TaskCompletionSource?
    private let releaseOwners List[ReadOnlyMemory[uint8]] = List[ReadOnlyMemory[uint8]](2)
    private var copyGeneration int32
    private var readingClipboard bool
    private var disposed bool

    prop ClipboardOwner ReadOnlyMemory[uint8] -> ReadOnlyMemory[uint8](clipboardOwner)
    event ClipboardChanged Action
    let Decoding Dictionary[string, int64] = Dictionary[string, int64]()

    func Decode(channel string) {
        if playbackActive() {
            Decoding[channel] = Stopwatch.GetTimestamp()
        }
    }

    func Copy(content string, clearAfterMs float64) {
        QueueCopy(content.ToCharArray(), clearAfterMs, true)
    }

    func Copy(content[]char, clearAfterMs float64) ReadOnlyMemory[uint8] ->
    QueueCopy(content, clearAfterMs, false)

    private func QueueCopy(content[]char, clearAfterMs float64, feedback bool) ReadOnlyMemory[uint8] {
        guard let host = window else {
            if feedback {
                Array.Clear(content)
            }
            return ReadOnlyMemory[uint8].Empty
        }
        if disposed {
            if feedback {
                Array.Clear(content)
            }
            return ReadOnlyMemory[uint8].Empty
        }
        var request ClipboardPublication
        try {
            request = ClipboardPublication(content, clearAfterMs, feedback)
        } catch (failure Exception) {
            if feedback {
                Array.Clear(content)
            }
            Report("Copy failed")
            return ReadOnlyMemory[uint8].Empty
        }
        pendingCopy?.Dispose()
        pendingCopy = request
        ContinueClipboard(host)
        return ReadOnlyMemory[uint8](request.Marker)
    }

    private func ContinueClipboard(host Window) {
        if activeCopy != nil || readingClipboard {
            return
        }
        if let completion = releaseTask {
            readingClipboard = true
            let pending = host.ReadClipboardDataAsync([]string{"application/x-gyroid-clipboard-owner"})
            Background(ct -> CompleteRelease(host, pending, completion))
        } else if !disposed {
            if let request = pendingCopy {
                pendingCopy = nil
                activeCopy = request
                copyGeneration++
                let generation = copyGeneration
                let pending = host.WriteClipboardAsync(request.Data)
                Background(ct -> CompleteCopy(host, pending, request, generation))
            }
        }
    }

    private async func CompleteCopy(
        host Window,
        pending Task[ClipboardWriteResult],
        request ClipboardPublication,
        generation int32
    ) {
        var succeeded = false
        try {
            succeeded = (await pending.WaitAsync(host.Closed)).Status == DataTransferStatus.Success
        } catch (failure Exception) { }
        if !host.TryPost(
            () -> {
                activeCopy = nil
                if succeeded && !disposed {
                    ClearClipboardState()
                    if generation == copyGeneration {
                        ClipboardText = request.Text
                        clipboardBytes = request.Bytes
                        clipboardOwner = request.Marker
                        request.Text = []char{}
                        request.Bytes = []uint8{}
                        let owner = ClipboardOwner
                        clipboardTimer = host.SetTimeout(
                            () -> {
                                ReleaseClipboard(owner)
                            },
                            request.ClearAfterMs
                        )
                    }
                    ClipboardChanged?.Invoke()
                } else if !succeeded && generation == copyGeneration && !disposed {
                    Report("Copy failed")
                }
                request.Dispose()
                ContinueClipboard(host)
            }
        ) {
            request.Dispose()
            releaseTask?.TrySetResult()
        }
    }

    func ReleaseClipboard() Task -> ReleaseClipboard(ReadOnlyMemory[uint8].Empty)

    func ReleaseClipboard(owner ReadOnlyMemory[uint8]) Task {
        guard let host = window else {
            return Task.CompletedTask
        }
        let all = owner.IsEmpty
        if let queued = pendingCopy {
            if all || owner.Equals(ReadOnlyMemory[uint8](queued.Marker)) {
                queued.Dispose()
                pendingCopy = nil
            }
        }
        let current = ClipboardOwner
        let active = if let request = activeCopy {
            ReadOnlyMemory[uint8](request.Marker)
        } else {
            ReadOnlyMemory[uint8].Empty
        }
        if !all && !owner.Equals(current) && !owner.Equals(active) {
            return Task.CompletedTask
        }
        if all || owner.Equals(current) {
            clipboardTimer?.Dispose()
            clipboardTimer = nil
        }
        if !active.IsEmpty && (all || owner.Equals(active)) {
            copyGeneration++
        }
        if all {
            AddReleaseOwner(current)
            AddReleaseOwner(active)
        } else {
            AddReleaseOwner(owner)
        }
        if let pending = releaseTask {
            return pending.Task
        }
        if releaseOwners.Count == 0 {
            return Task.CompletedTask
        }
        let completion = TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously)
        releaseTask = completion
        ContinueClipboard(host)
        return completion.Task
    }

    private func AddReleaseOwner(owner ReadOnlyMemory[uint8]) {
        if !owner.IsEmpty && !releaseOwners.Contains(owner) {
            releaseOwners.Add(owner)
        }
    }

    private async func CompleteRelease(
        host Window,
        pending Task[ClipboardDataResult],
        completion TaskCompletionSource
    ) {
        var result ClipboardDataResult?
        try {
            result = await pending.WaitAsync(host.Closed)
        } catch (failure Exception) { }
        if !host.TryPost(
            () -> {
                try {
                    if let current = result {
                        for item in current.Data.Representations {
                            if releaseOwners.Any(marker -> item.Bytes.Span.SequenceEqual(marker.Span)) {
                                host.SetClipboardText("")
                                break
                            }
                        }
                    } else if !disposed {
                        Report("Clipboard could not be cleared")
                    }
                } catch (failure Exception) {
                    if !disposed {
                        Report("Clipboard could not be cleared")
                    }
                }
                if releaseOwners.Contains(ClipboardOwner) {
                    ClearClipboardState()
                    if !disposed {
                        ClipboardChanged?.Invoke()
                    }
                }
                readingClipboard = false
                releaseTask = nil
                releaseOwners.Clear()
                completion.TrySetResult()
                if disposed {
                    window = nil
                } else {
                    ContinueClipboard(host)
                }
            }
        ) {
            completion.TrySetResult()
        }
    }

    private func ClearClipboardState() {
        clipboardTimer?.Dispose()
        clipboardTimer = nil
        Array.Clear(ClipboardText)
        ClipboardText = []char{}
        Array.Clear(clipboardBytes)
        clipboardBytes = []uint8{}
        Array.Clear(clipboardOwner)
        clipboardOwner = []uint8{}
    }

    func Released() Task -> releaseTask?.Task ?? Task.CompletedTask

    public func Dispose() {
        if disposed {
            return
        }
        let pending = ReleaseClipboard()
        disposed = true
        Decoding.Clear()
        Array.Clear(ClipboardText)
        Array.Clear(clipboardBytes)
        activeCopy?.Dispose()
        if pending.IsCompleted {
            window = nil
        }
    }
}

class ClipboardPublication : IDisposable {
    let Data TransferData
    let Marker[]uint8
    let ClearAfterMs float64
    var Bytes[]uint8
    var Text[]char

    init(content[]char, clearAfterMs float64, feedback bool) {
        let bytes = Encoding.UTF8.GetBytes(content)
        let text = TransferRepresentation("text/plain;charset=utf-8", ReadOnlyMemory[uint8](bytes))
        Array.Clear(bytes)
        System.Runtime.InteropServices.MemoryMarshal.TryGetArray[uint8](text.Bytes, out let segment)
        Bytes = segment.Array ?? throw InvalidOperationException("Clipboard buffer unavailable")
        Marker = Guid.NewGuid().ToByteArray()
        Text = feedback ? content: []char{}
        ClearAfterMs = clearAfterMs
        Data = TransferData(
            []TransferRepresentation{
                text,
                TransferRepresentation("application/x-gyroid-clipboard-owner", ReadOnlyMemory[uint8](Marker))
            },
            Array.Empty[Uri]()
        )
    }

    public func Dispose() {
        Array.Clear(Bytes)
        Array.Clear(Text)
        Bytes = []uint8{}
        Text = []char{}
    }
}
