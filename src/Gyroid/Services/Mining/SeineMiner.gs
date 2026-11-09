package Gyroid.Services

import Gyroid.Models
import System
import System.Diagnostics
import System.Globalization
import System.IO
import System.Net
import System.Net.Http
import System.Net.Http.Headers
import System.Net.Sockets
import System.Security.Cryptography
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class SeineMiner : IDisposable {
    private var process Process?
    private var client HttpClient?
    private var directory string = ""
    private var started DateTimeOffset
    private var threads int32 = 1
    private var download int32 = -1
    private var active bool
    prop Running bool -> active && process != nil && !process!!.HasExited

    async func StartAsync(pool string, address string, useGpu bool, ct CancellationToken) {
        try {
            download = 0
            active = true
            let binary = await SeineRelease.DownloadAsync(value -> download = value, ct)
            download = -1
            directory = Path.Combine(Path.GetDirectoryName(binary) ?? "", "runs", Guid.NewGuid().ToString("N"))
            Directory.CreateDirectory(directory)
            PrivateFiles.ProtectDirectory(directory)
            let listener = TcpListener(IPAddress.Loopback, 0)
            listener.Start()
            let port = IPEndPoint(listener.LocalEndpoint).Port
            listener.Stop()
            let token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32))
            let start = ProcessStartInfo{
                FileName: Environment.ProcessPath ?? throw WalletException("Application executable is unavailable"),
                UseShellExecute: false,
                CreateNoWindow: true,
                RedirectStandardInput: true,
                RedirectStandardOutput: true,
                RedirectStandardError: true,
                WorkingDirectory: directory
            }
            if Path.GetFileNameWithoutExtension(start.FileName).Equals("dotnet", StringComparison.OrdinalIgnoreCase) {
                start.ArgumentList.Add(Environment.GetCommandLineArgs()[0])
            }
            start.ArgumentList.Add("--owned-seine")
            start.ArgumentList.Add(binary)
            for argument in[]string{
                "--mode",
                "pool",
                "--pool-url",
                pool,
                "--address",
                address,
                "--pool-worker",
                "Gyroid",
                "--ui",
                "plain",
                "--threads",
                threads.ToString(CultureInfo.InvariantCulture),
                "--api-server",
                "--api-bind",
                "127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture),
                "--api-token",
                token,
                "--no-auto-update",
                "--disable-update-check",
                "--telemetry",
                "off",
                "--data-dir",
                directory,
                "--daemon-dir",
                directory
            } {
                start.ArgumentList.Add(argument)
            }
            if !useGpu {
                start.ArgumentList.Add("--backend")
                start.ArgumentList.Add("cpu")
            }
            start.Environment["HOME"] = directory
            start.Environment["USERPROFILE"] = directory
            start.Environment["XDG_CONFIG_HOME"] = directory
            start.Environment["XDG_DATA_HOME"] = directory
            let owned = Process.Start(start) ?? throw WalletException("Seine could not start")
            process = owned
            owned.StandardOutput.BaseStream.CopyToAsync(Stream.Null)
            owned.StandardError.BaseStream.CopyToAsync(Stream.Null)
            started = DateTimeOffset.Now
            let http = HttpClient(SocketsHttpHandler{UseProxy: false})
            client = http
            http.BaseAddress = Uri("http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture))
            http.Timeout = TimeSpan.FromSeconds(3)
            http.DefaultRequestHeaders.Authorization = AuthenticationHeaderValue("Bearer", token)
            using let deadline = CancellationTokenSource.CreateLinkedTokenSource(ct)
            deadline.CancelAfter(TimeSpan.FromSeconds(15))
            while true {
                if owned.HasExited {
                    throw WalletException("Seine exited before its control API was ready")
                }
                try {
                    using let response = await http.GetAsync("/v1/health", deadline.Token)
                    response.EnsureSuccessStatusCode()
                    return
                } catch (error HttpRequestException) { }
                await Task.Delay(200, deadline.Token)
            }
        } catch (error Exception) {
            await StopAsync()
            if error is OperationCanceledException && !ct.IsCancellationRequested {
                throw WalletException("Seine control API did not become ready")
            }
            throw error
        } finally {
            download = -1
        }
    }

    async func StatusAsync(ct CancellationToken) MiningStatus {
        let pending = download
        let current = process
        let http = client
        let idle = MiningStatus{Pool: true, Threads: threads, DownloadPercent: pending}
        if pending >= 0 || !active {
            return idle
        }
        if current == nil || current.HasExited || http == nil {
            return idle with{Connection = "Seine stopped unexpectedly"}
        }
        try {
            using let response = await http.GetAsync("/v1/miner/stats", ct)
            response.EnsureSuccessStatusCode()
            using let json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct))
            let root = json.RootElement
            if NodeJson.Text(root, "lifecycle") == "error" {
                return idle with{Running = true, Started = started, Connection = "Seine could not start mining"}
            }
            if !root.TryGetProperty("mining", out let mining) || mining.ValueKind != JsonValueKind.Object {
                return idle with{
                    Running = true,
                    Started = started,
                    Connection = (
                        DateTimeOffset.Now - started
                    ).TotalSeconds >= 30 ? "Pool disconnected": "Connecting to pool"
                }
            }
            let state = NodeJson.Text(mining, "state")
            return MiningStatus{
                Pool: true,
                Running: true,
                Threads: threads,
                Hashrate: mining.GetProperty("hashrate_hps").GetDouble(),
                Hashes: NodeJson.OptionalNumber(mining, "total_hashes") ?? uint64(0),
                Accepted: NodeJson.OptionalNumber(mining, "accepted") ?? uint64(0),
                Rejected: NodeJson.OptionalNumber(mining, "rejected") ?? uint64(0),
                Started: started,
                Connection: state == "working" ? "Pool connected": "Pool disconnected"
            }
        } catch (error HttpRequestException) {
            return idle with{Running = true, Started = started, Connection = "Seine control API unavailable"}
        } catch (error OperationCanceledException) when !ct.IsCancellationRequested {
            return idle with{Running = true, Started = started, Connection = "Seine control API unavailable"}
        }
    }

    func SetThreads(value int32) {
        if active {
            throw WalletException("Stop pool mining before changing threads")
        }
        threads = value
    }

    async func StopAsync() {
        active = false
        let current = process
        process = nil
        client?.Dispose()
        client = nil
        if current != nil {
            using let owned = current
            if !owned.HasExited {
                owned.StandardInput.Close()
                using let deadline = CancellationTokenSource(TimeSpan.FromSeconds(5))
                try {
                    await owned.WaitForExitAsync(deadline.Token)
                } catch (error OperationCanceledException) {
                    if !owned.HasExited {
                        owned.Kill(true)
                        await owned.WaitForExitAsync()
                    }
                }
            }
        }
        if directory.Length > 0 && Directory.Exists(directory) {
            Directory.Delete(directory, true)
        }
        directory = ""
    }

    func Dispose() {
        active = false
        let current = process
        if current != nil && !current.HasExited {
            current.StandardInput.Close()
        }
    }

    shared {
        func RunOwned(arguments[]string) int32 {
            using let input = Console.OpenStandardInput()
            let start = ProcessStartInfo{
                FileName: arguments[2],
                UseShellExecute: false,
                CreateNoWindow: true,
                RedirectStandardInput: true,
                RedirectStandardOutput: true,
                RedirectStandardError: true
            }
            for index in 3 ... arguments.Length {
                start.ArgumentList.Add(arguments[index])
            }
            using let miner = Process.Start(start) ?? throw WalletException("Seine could not start")
            try {
                miner.StandardInput.Close()
                miner.StandardOutput.BaseStream.CopyToAsync(Stream.Null)
                miner.StandardError.BaseStream.CopyToAsync(Stream.Null)
                Task.WhenAny(input.ReadAsync([1]uint8, 0, 1), miner.WaitForExitAsync()).GetAwaiter().GetResult()
            } finally {
                if !miner.HasExited {
                    miner.Kill(true)
                    miner.WaitForExit()
                }
            }
            return miner.ExitCode
        }
    }
}
