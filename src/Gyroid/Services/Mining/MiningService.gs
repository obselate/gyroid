package Gyroid.Services

import Gyroid.Models
import System
import System.Globalization
import System.Net.Http
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class MiningService {
    let session WalletSession
    let Pool SeineMiner = SeineMiner()

    init(session WalletSession) {
        this.session = session
    }

    async func StatusAsync(ct CancellationToken = default(CancellationToken)) MiningStatus {
        if session.settings.MiningMode == "pool" {
            return await Pool.StatusAsync(ct)
        }
        using let response = await session.Node.Api.JsonAsync("mining", ct: ct)
        let root = response.RootElement
        return MiningStatus{
            Running: NodeJson.Flag(root, "running"),
            Threads: int32(NodeJson.Number(root, "threads")),
            Hashrate: if root.TryGetProperty("hashrate", out let rate) && rate.ValueKind == JsonValueKind.Number {
                rate.GetDouble()
            } else {
                0.0
            },
            Hashes: NodeJson.OptionalNumber(root, "hash_count") ?? uint64(0),
            Blocks: NodeJson.OptionalNumber(root, "blocks_found") ?? uint64(0),
            Started: if DateTimeOffset.TryParse(
                NodeJson.Text(root, "started_at"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out let started
            ) {
                started
            } else {
                DateTimeOffset.MinValue
            }
        }
    }

    async func PollAsync(
        previous MiningPollResult,
        requests chan[MiningPollRequest],
        ct CancellationToken
    ) MiningPollResult {
        var state = previous.Request
        while true {
            if state.Active {
                select {
                    case let next = <- requests {
                        state = next
                    }
                    case <- after(TimeSpan.FromSeconds(5)) { }
                }
            } else {
                state = await requests.Reader.ReadAsync(ct)
            }
            while requests.Reader.TryRead(out let next) {
                state = next
            }
            if state.Active {
                break
            }
        }
        var report = MiningReport{... previous.Report, Available: false}
        try {
            let status = await StatusAsync(ct)
            if requests.Reader.TryPeek(out _) {
                return previous
            }
            let waiting = status.Running && !status.Pool && session.Node.Status.Peers == 0
            report = previous.Report.Record(
                status,
                waiting,
                state.Revision == previous.Request.Revision,
                DateTimeOffset.Now
            )
        } catch (failure Exception) when !ct.IsCancellationRequested { }
        return MiningPollResult{Request: state, Report: report}
    }

    async func StartAsync(ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            if session.settings.MiningMode != "pool" {
                await Pool.StopAsync()
                session.Touch()
                using let started = await session.Node.Api.JsonAsync("mining/start", ct: ct, method: HttpMethod.Post)
                return
            }
            let issue = SettingsValidation.PoolUrlError(session.settings.PoolUrl)
            if issue.Length > 0 {
                throw WalletException(issue)
            }
            try {
                using let stopped = await session.Node.Api.JsonAsync("mining/stop", ct: ct, method: HttpMethod.Post)
            } catch (error WalletException) when error.StatusCode == 409 { }
            await Pool.StopAsync()
            let address = session.Snapshot.Address
            if address.Length == 0 {
                throw WalletException("Open a wallet before starting pool mining")
            }
            session.Touch()
            await Pool.StartAsync(session.settings.PoolUrl, address, ct)
        } catch (error WalletException) when error.StatusCode == 409 { } finally {
            session.End()
        }
    }

    async func StopAsync(ct CancellationToken = default(CancellationToken)) {
        if session.settings.MiningMode == "pool" {
            await session.BeginAsync(ct)
            try {
                await Pool.StopAsync()
            } finally {
                session.End()
            }
        } else {
            await PostAsync("mining/stop", nil, ct)
        }
    }

    func SetThreadsAsync(threads int32, ct CancellationToken = default(CancellationToken)) Task {
        if session.settings.MiningMode == "pool" {
            Pool.SetThreads(threads)
            return Task.CompletedTask
        }
        return PostAsync(
            "mining/threads",
            writer -> {
                writer.WriteStartObject()
                writer.WriteNumber("threads", threads)
                writer.WriteEndObject()
            },
            ct
        )
    }

    private async func PostAsync(path string, body Action[Utf8JsonWriter]?, ct CancellationToken) {
        await session.BeginAsync(ct)
        try {
            try {
                session.RequireUnlocked()
                session.Touch()
                using let response = await session.Node.Api.JsonAsync(path, body, ct, method: HttpMethod.Post)
            } catch (error WalletException) {
                if error.StatusCode != 409 {
                    throw error
                }
            }
        } finally {
            session.End()
        }
    }
}
