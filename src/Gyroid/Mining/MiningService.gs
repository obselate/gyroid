package Gyroid.Mining

import Gyroid.Node
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.Globalization
import System.Net.Http
import System.Text.Json
import System.Threading
import System.Threading.Tasks

data struct MiningStatus {
    var Running bool
    var Threads int32
    var Hashrate float64
    var Hashes uint64
    var Blocks uint64
    var Started DateTimeOffset
}

class MiningService {
    let session WalletSession

    init(session WalletSession) {
        this.session = session
    }

    async func StatusAsync(ct CancellationToken = default(CancellationToken)) MiningStatus {
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

    func StartAsync(ct CancellationToken = default(CancellationToken)) Task -> PostAsync("mining/start", nil, ct)

    func StopAsync(ct CancellationToken = default(CancellationToken)) Task -> PostAsync("mining/stop", nil, ct)

    func SetThreadsAsync(threads int32, ct CancellationToken = default(CancellationToken)) Task -> PostAsync(
        "mining/threads",
        writer -> {
            writer.WriteStartObject()
            writer.WriteNumber("threads", threads)
            writer.WriteEndObject()
        },
        ct
    )

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
