package Gyroid.Send

import Gyroid.Node
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.IO
import System.Text.Json
import System.Threading.Tasks

class PendingSendStore {
    let session WalletSession
    var Pending PendingSend? = nil
    var Error string = ""

    init(session WalletSession) {
        this.session = session
    }

    private func PendingPath() string -> Path.Combine(
        session.settings.DataDirectory,
        "gyroid-pending-send." + session.settings.ActiveWallet + ".json"
    )

    func AcquireLease() FileStream {
        let options = FileStreamOptions{
            Mode: FileMode.OpenOrCreate,
            Access: FileAccess.ReadWrite,
            Share: FileShare.None
        }
        if !OperatingSystem.IsWindows() {
            options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
        }
        try {
            return FileStream(PendingPath() + ".lock", options)
        } catch (error IOException) {
            throw WalletException("Another Gyroid process is handling this wallet's sends")
        }
    }

    func Load() {
        let previous = Pending
        Pending = nil
        Error = ""
        if session.settings.ActiveWallet.Length == 0 {
            return
        }
        try {
            if (File.GetAttributes(PendingPath()) & FileAttributes.Directory) != 0 {
                throw WalletException("Pending send file is invalid")
            }
            using let json = JsonDocument.Parse(PrivateFiles.ReadText(PendingPath(), 16384, true))
            let root = json.RootElement
            var coreStarted int64 = 0
            if root.TryGetProperty("core_started", out let started) {
                coreStarted = started.GetInt64()
            }
            let pending = PendingSend{
                Key: NodeJson.Text(root, "idempotency_key"),
                Body: NodeJson.Text(root, "body"),
                Wallet: NodeJson.Text(root, "wallet"),
                Network: NodeJson.Text(root, "network"),
                CoreStarted: coreStarted,
                Timestamp: NodeJson.Signed(root, "timestamp")
            }
            if pending.Wallet != session
                .settings
                .ActiveWallet ||
                pending.Network != session
                .settings
                .Network ||
                pending
                .Key
                .Length == 0 ||
                pending
                .Body
                .Length == 0 ||
                pending.Timestamp <= 0 {
                throw WalletException("Pending send file is invalid")
            }
            using let body = JsonDocument.Parse(pending.Body)
            if let prior = previous {
                if prior.Key == pending.Key && prior.Body == pending.Body {
                    pending.State = prior.State
                    pending.CanRetry = prior.CanRetry
                }
            }
            Pending = pending
        } catch (error FileNotFoundException) { } catch (error DirectoryNotFoundException) { } catch (error Exception) {
            Error = "Pending send file is invalid or unreadable. Outcome unknown. Resolve the file before sending"
        }
    }

    func Save(pending PendingSend) {
        let path = PendingPath()
        PrivateFiles
            .WriteAtomic(
            path,
            stream -> {
                using let writer = Utf8JsonWriter(stream)
                writer.WriteStartObject()
                writer.WriteString("idempotency_key", pending.Key)
                writer.WriteString("body", pending.Body)
                writer.WriteString("wallet", pending.Wallet)
                writer.WriteString("network", pending.Network)
                writer.WriteNumber("timestamp", pending.Timestamp)
                writer.WriteNumber("core_started", pending.CoreStarted)
                writer.WriteEndObject()
                writer.Flush()
                return Task.CompletedTask
            },
            false,
            true
        )
            .GetAwaiter()
            .GetResult()
    }

    func Clear() {
        File.Delete(PendingPath())
        PrivateFiles.FlushDirectory(session.settings.DataDirectory)
        Pending = nil
    }
}
