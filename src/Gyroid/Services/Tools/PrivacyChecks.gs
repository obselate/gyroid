package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Generic
import System.IO
import System.Security.Cryptography
import System.Text
import System.Text.Json
import System.Text.RegularExpressions
import System.Threading

class PrivacyChecks {
    let session WalletSession

    init(session WalletSession) {
        this.session = session
    }

    func ReadChecks() PrivacyCheckResult {
        var mode UnixFileMode?
        try {
            mode = WalletFileMode()
        } catch (failure Exception) { }
        return PrivacyCheckResult{PhraseChecked: PhraseChecked(), WalletFileMode: mode}
    }

    private func PhraseStatePath() string -> SettingsStore.ConfigurationPath() + ".phrase-checks.json"

    private func WalletKey() string -> session.settings.Network + ":" + Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(session.Snapshot.Address))
    )
        .ToLowerInvariant()

    func PhraseChecked() DateTime? {
        if session.Snapshot.Address.Length == 0 || !File.Exists(PhraseStatePath()) {
            return nil
        }
        try {
            using let state = JsonDocument.Parse(PrivateFiles.ReadText(PhraseStatePath(), 65536, true))
            return if state.RootElement.TryGetProperty(WalletKey(), out let date) {
                date.GetDateTime().ToLocalTime()
            } else {
                nil
            }
        } catch (error Exception) {
            return nil
        }
    }

    async func MarkPhraseCheckedAsync() DateTime? {
        session.RequireUnlocked()
        let path = PhraseStatePath()
        Directory.CreateDirectory(
            Path.GetDirectoryName(path) ?? throw WalletException("Settings file must have a parent directory")
        )
        using let state = JsonDocument.Parse(
            if File.Exists(path) {
                PrivateFiles.ReadText(path, 65536, true)
            } else {
                "{}"
            }
        )
        let wallet = WalletKey()
        await PrivateFiles.WriteAtomic(
            path,
            async (stream) -> {
                using let writer = Utf8JsonWriter(stream)
                writer.WriteStartObject()
                for entry in state.RootElement.EnumerateObject() {
                    if entry.Name != wallet && Regex.IsMatch(entry.Name, "^[^:]+:[0-9a-f]{64}$") {
                        entry.WriteTo(writer)
                    }
                }
                writer.WriteString(wallet, DateTime.UtcNow)
                writer.WriteEndObject()
                await writer.FlushAsync()
            },
            true,
            false
        )
        return PhraseChecked()
    }

    func WalletFileMode() UnixFileMode? {
        if OperatingSystem.IsWindows() || session.settings.ActiveWallet.Length == 0 {
            return nil
        }
        return File.GetUnixFileMode(session.Library.WalletPath(session.settings.ActiveWallet))
    }

    func RestrictWalletFile() UnixFileMode? {
        File.SetUnixFileMode(
            session.Library.WalletPath(session.settings.ActiveWallet),
            UnixFileMode.UserRead | UnixFileMode.UserWrite
        )
        return WalletFileMode()
    }

    async func CheckOutputsAsync(ct CancellationToken = default(CancellationToken)) OutputReport {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            using let outputs = await session.Node.Api.JsonAsync("wallet/outputs", ct: ct)
            using let audit = await session
                .Node
                .Api
                .JsonAsync(
                "wallet/audit",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteEndObject()
                },
                ct
            )
            let root = outputs.RootElement
            let chain = NodeJson.Number(root, "chain_height")
            let blocks = Dictionary[uint64, HashSet[string]?]()
            let stale = List[StaleOutput]()
            var amount uint64 = 0
            for output in root.GetProperty("outputs").EnumerateArray() {
                let height = NodeJson.Number(output, "block_height")
                let txid = NodeJson.Text(output, "txid")
                if !blocks.ContainsKey(height) {
                    blocks[height] = await BlockAsync(height, chain, ct)
                }
                if blocks[height]?.Contains(txid) == true || await OnChainAsync(txid, ct) {
                    continue
                }
                let value = NodeJson.Number(output, "amount")
                amount += value
                stale.Add(
                    StaleOutput{
                        Height: height,
                        Output: txid + ":" + NodeJson.Number(output, "output_index").ToString(),
                        Reason: if blocks[height] == nil {
                            "block gone"
                        } else {
                            "tx gone"
                        },
                        Amount: value
                    }
                )
            }
            return OutputReport{
                Total: NodeJson.Number(root, "total"),
                Stale: stale.ToArray(),
                StaleAmount: amount,
                Duplicates: NodeJson.Number(audit.RootElement, "burned_outputs"),
                Unspendable: NodeJson.Number(audit.RootElement, "total_burned"),
                Synced: NodeJson.Number(root, "synced_height"),
                Checked: DateTime.Now
            }
        } finally {
            session.End()
        }
    }

    private async func BlockAsync(height uint64, chain uint64, ct CancellationToken) HashSet[string]? {
        if height > chain {
            return nil
        }
        using let block = await session.Node.Api.JsonAsync("block/" + height.ToString(), ct: ct)
        let hashes = HashSet[string](StringComparer.Ordinal)
        for tx in block.RootElement.GetProperty("transactions").EnumerateArray() {
            hashes.Add(NodeJson.Text(tx, "hash"))
        }
        return hashes
    }

    private async func OnChainAsync(txid string, ct CancellationToken) bool {
        try {
            using let found = await session.Node.Api.JsonAsync("tx/" + Uri.EscapeDataString(txid), ct: ct)
            return !NodeJson.Flag(found.RootElement, "in_mempool")
        } catch (error WalletException) {
            if error.StatusCode == 404 {
                return false
            }
            throw error
        }
    }

    async func ObserveAsync(txid string, ct CancellationToken = default(CancellationToken)) ObserverView {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            using let outputs = await session.Node.Api.JsonAsync("wallet/outputs", ct: ct)
            using let found = await session.Node.Api.JsonAsync("tx/" + Uri.EscapeDataString(txid), ct: ct)
            let owned = Dictionary[string, uint64](StringComparer.OrdinalIgnoreCase)
            for output in outputs.RootElement.GetProperty("outputs").EnumerateArray() {
                if NodeJson.Flag(output, "spent") || NodeJson.Text(output, "status") == "spent" {
                    owned[NodeJson.Text(output, "one_time_pub")] = NodeJson.Number(output, "spent_height")
                }
            }
            let height = NodeJson.OptionalNumber(found.RootElement, "block_height") ?? uint64(0)
            let tx = found.RootElement.GetProperty("tx")
            let rings = List[int32]()
            var size = 0
            for input in tx.GetProperty("inputs").EnumerateArray() {
                var real = -1
                var matches = 0
                var index = 0
                for member in input.GetProperty("ring_members").EnumerateArray() {
                    if height > 0 && owned.TryGetValue(Hex(member), out let spentHeight) && spentHeight == height {
                        real = index
                        matches++
                    }
                    index++
                }
                size = index
                rings.Add(matches == 1 ? real: -1)
            }
            let keys = List[string]()
            var commitment = ""
            var memo = 0
            for output in tx.GetProperty("outputs").EnumerateArray() {
                keys.Add(Hex(output.GetProperty("public_key")))
                if commitment.Length == 0 {
                    commitment = Hex(output.GetProperty("commitment"))
                    memo = output.GetProperty("encrypted_memo").GetArrayLength()
                }
            }
            return ObserverView{
                Rings: rings.ToArray(),
                RingSize: size,
                OutputKeys: keys.ToArray(),
                Commitment: commitment,
                MemoBytes: memo,
                Fee: NodeJson.Number(tx, "fee"),
                Height: NodeJson.OptionalNumber(found.RootElement, "block_height") ?? uint64(0)
            }
        } finally {
            session.End()
        }
    }

    private func Hex(value JsonElement) string {
        let bytes = [value.GetArrayLength()]uint8
        var index = 0
        for item in value.EnumerateArray() {
            bytes[index] = item.GetByte()
            index++
        }
        return Convert.ToHexStringLower(bytes)
    }
}
