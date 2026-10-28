package Gyroid.Wallet

import Gyroid.Node
import Gyroid.Platform
import System
import System.Diagnostics
import System.IO
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class WalletLockScheduler {
    shared {
        func Cancel(settings WalletSettings) -> File.Delete(Path.Combine(settings.DataDirectory, "gyroid-autolock"))

        async func ScheduleAsync(node NodeSession, minutes int32) {
            let settings = node.Settings
            let started = node.Api.ListenerStarted
            let pid = CoreProcess.Listener(Uri(settings.Endpoint))
            let token = Guid.NewGuid().ToString("N")
            let path = Path.Combine(settings.DataDirectory, "gyroid-autolock")
            await PrivateFiles.WriteAtomic(
                path,
                async (stream) -> {
                    await stream.WriteAsync(Encoding.UTF8.GetBytes(token))
                },
                true,
                false
            )
            let start = ProcessStartInfo{
                FileName: Environment.ProcessPath ?? throw WalletException("Could not schedule wallet auto-lock"),
                UseShellExecute: false,
                CreateNoWindow: true,
                RedirectStandardInput: true,
                RedirectStandardOutput: true,
                RedirectStandardError: true
            }
            let assembly = Environment.GetCommandLineArgs()[0]
            if assembly.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) {
                start.ArgumentList.Add(assembly)
            }
            start.ArgumentList.Add("--lock-wallet")
            using let worker = Process.Start(start) ?? throw WalletException("Could not schedule wallet auto-lock")
            using let writer = Utf8JsonWriter(worker.StandardInput.BaseStream)
            writer.WriteStartObject()
            writer.WriteString("endpoint", settings.Endpoint)
            writer.WriteString("data_directory", settings.DataDirectory)
            writer.WriteString("wallet_directory", settings.WalletDirectory)
            writer.WriteNumber("pid", pid)
            writer.WriteNumber("started", started)
            writer.WriteNumber("deadline", Environment.TickCount64 + int64(minutes) * 60000)
            writer.WriteString("token", token)
            writer.WriteEndObject()
            await writer.FlushAsync()
            writer.Dispose()
            worker.StandardInput.Close()
            using let timeout = CancellationTokenSource(TimeSpan.FromSeconds(5))
            try {
                if await worker.StandardOutput.ReadLineAsync(timeout.Token) != "ready" {
                    throw WalletException("Could not schedule wallet auto-lock")
                }
            } catch (error Exception) {
                if !worker.HasExited {
                    worker.Kill()
                }
                throw WalletException("Could not schedule wallet auto-lock")
            }
        }

        func Run() int32 {
            try {
                using let input = JsonDocument.Parse(Console.In.ReadToEnd())
                let root = input.RootElement
                let settings = WalletSettings{
                    Endpoint: NodeJson.Text(root, "endpoint"),
                    DataDirectory: NodeJson.Text(root, "data_directory"),
                    WalletDirectory: NodeJson.Text(root, "wallet_directory"),
                    OwnedProcessId: root.GetProperty("pid").GetInt32()
                }
                let started = root.GetProperty("started").GetInt64()
                let deadline = root.GetProperty("deadline").GetInt64()
                let token = NodeJson.Text(root, "token")
                using let node = NodeSession(settings)
                if node.Api.ListenerStarted != started {
                    return 1
                }
                Console.WriteLine("ready")
                Console.Out.Flush()
                while Environment.TickCount64 < deadline {
                    Thread.Sleep(int32(Math.Max(0, Math.Min(deadline - Environment.TickCount64, int32.MaxValue))))
                }
                let path = Path.Combine(settings.DataDirectory, "gyroid-autolock")
                if !File.Exists(path) || PrivateFiles.ReadText(path, 64, true) != token ||
                    node
                    .Api
                    .ListenerStarted != started {
                    return 0
                }
                using let response = node
                    .Api
                    .JsonAsync(
                    "wallet/lock",
                    writer -> {
                        writer.WriteStartObject()
                        writer.WriteEndObject()
                    }
                )
                    .GetAwaiter()
                    .GetResult()
                return 0
            } catch (error Exception) {
                return 1
            }
        }
    }
}
