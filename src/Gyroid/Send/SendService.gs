package Gyroid.Send

import Gyroid.Node
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.IO
import System.Text
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class SendService {
    let session WalletSession
    let store PendingSendStore
    var confirmation SendEstimate? = nil
    var confirmationKey string = ""
    var Outcome SendOutcome = SendOutcome()

    prop Pending PendingSend? -> store.Pending
    prop Error string -> store.Error

    init(session WalletSession) {
        this.session = session
        store = PendingSendStore(session)
    }

    func Reset() {
        store.Pending = nil
        Outcome = SendOutcome()
    }

    func InvalidateConfirmation() {
        confirmation = nil
        confirmationKey = ""
    }

    async func EstimateAsync(
        address string,
        amount string,
        memo string,
        ct CancellationToken = default(CancellationToken)
    ) SendEstimate {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            using let lease = store.AcquireLease()
            RequireNoPendingSend()
            InvalidateConfirmation()
            let request = WalletValidation.ValidateSend(
                address,
                amount,
                memo,
                session.Snapshot.Balance?.Spendable ?? throw WalletException("Spendable balance is unavailable")
            )
            using let walletAddress = await session.Node.Api.JsonAsync("wallet/address", ct: ct)
            if NodeJson.Flag(walletAddress.RootElement, "view_only") {
                throw WalletException("View-only wallets cannot send")
            }
            var handle = ""
            var recipient = request.Address
            if recipient.StartsWith("$", StringComparison.Ordinal) {
                let resolved = await BlocknetId.ResolveAsync(recipient, ct)
                handle = resolved.Handle
                recipient = WalletValidation.ValidateAddress(resolved.Address)
            }
            await Task.Delay(2000, ct)
            using let result = await session
                .Node
                .Api
                .JsonAsync(
                "wallet/send",
                writer -> WriteSend(writer, recipient, request.Amount, request.Memo, true),
                ct
            )
            let root = result.RootElement
            if !NodeJson.Flag(root, "dry_run") {
                throw WalletException("Daemon did not return a dry-run estimate")
            }
            let fee = NodeJson.Number(root, "fee")
            let inputTotal = NodeJson.Number(root, "input_total")
            let change = NodeJson.Number(root, "change")
            if request.Amount > uint64.MaxValue - fee ||
                inputTotal < change ||
                inputTotal - change != request.Amount +
                fee {
                throw WalletException("Node returned an invalid send total")
            }
            if let available = session.Snapshot.Balance?.Spendable {
                if request.Amount + fee > available {
                    throw WalletException("Amount and fee exceed spendable balance")
                }
            }
            let estimate = SendEstimate(
                recipient,
                request.Amount,
                request.Memo,
                fee,
                int32(NodeJson.Number(root, "input_count")),
                handle
            )
            confirmation = estimate
            confirmationKey = Guid.NewGuid().ToString("N")
            return estimate
        } finally {
            session.End()
        }
    }

    async func SubmitAsync(estimate SendEstimate, ct CancellationToken = default(CancellationToken)) SendResult {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            using let lease = store.AcquireLease()
            RequireNoPendingSend()
            if !Object.ReferenceEquals(estimate, confirmation) {
                throw WalletException("Estimate is no longer valid. Request a new estimate")
            }
            let available = session
                .Snapshot
                .Balance
                ?.Spendable ??
                throw WalletException("Spendable balance is unavailable")
            WalletValidation.ValidateSend(
                estimate.Address,
                WalletAmount.Format(estimate.Amount),
                estimate.Memo,
                available
            )
            if estimate.Total > available {
                throw WalletException("Amount and fee exceed spendable balance")
            }
            let key = confirmationKey
            InvalidateConfirmation()
            using let walletAddress = await session.Node.Api.JsonAsync("wallet/address", ct: ct)
            if NodeJson.Flag(walletAddress.RootElement, "view_only") {
                throw WalletException("View-only wallets cannot send")
            }
            using let body = MemoryStream()
            using let writer = Utf8JsonWriter(body)
            WriteSend(writer, estimate.Address, estimate.Amount, estimate.Memo, false)
            writer.Flush()
            let pending = PendingSend{
                Key: key,
                Body: Encoding.UTF8.GetString(body.GetBuffer(), 0, int32(body.Length)),
                Wallet: session.settings.ActiveWallet,
                Network: session.settings.Network,
                CoreStarted: session.Node.Api.ListenerStarted,
                Timestamp: DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            }
            store.Save(pending)
            return await SubmitPendingCoreAsync(pending, ct)
        } finally {
            session.End()
        }
    }

    private func RequireNoPendingSend() {
        store.Load()
        if store.Error.Length > 0 {
            throw WalletException(store.Error)
        }
        if store.Pending != nil {
            throw WalletException("Resolve the pending send before starting another")
        }
    }

    async func RecoverAsync(ct CancellationToken) {
        var lease FileStream? = nil
        try {
            try {
                lease = store.AcquireLease()
            } catch (error WalletException) {
                store.Error = error.Message
                return
            }
            await RecoverCoreAsync(ct)
        } finally {
            lease?.Dispose()
        }
    }

    private async func RecoverCoreAsync(ct CancellationToken) {
        store.Load()
        guard let pending = store.Pending else {
            return
        }
        if pending.CanRetry {
            store.Pending = PendingSend{... pending, CanRetry: false}
        }
        try {
            using let response = await session
                .Node
                .Api
                .JsonAsync("wallet/send/status?idempotency_key=" + Uri.EscapeDataString(pending.Key), ct: ct)
            let root = response.RootElement
            let status = NodeJson.Text(root, "state")
            if session.State == "Unlocked" {
                let sends = await session.History.ReadSendsAsync(ct)
                session.PublishSends(sends)
            }
            if status == "completed" && root.TryGetProperty("result", out let result) {
                let txid = NodeJson.Text(result, "txid")
                if txid.Length > 0 && !NodeJson.Flag(result, "dry_run") {
                    Outcome = SendOutcome(txid)
                    store.Clear()
                }
            } else if status == "failed" {
                Outcome = SendOutcome(error: NodeJson.Text(root, "error"))
                store.Clear()
            } else if status == "not_found" && session.State == "Unlocked" {
                store.Pending = PendingSend{
                    ... pending,
                    State: "No send record. Outcome unknown",
                    CanRetry: if pending.CoreStarted > 0 {
                        Math.Abs(pending.CoreStarted - session.Node.Api.ListenerStarted) < TimeSpan.TicksPerSecond
                    } else {
                        session.Node.Api.ListenerStarted < DateTimeOffset.FromUnixTimeSeconds(pending.Timestamp)
                            .UtcTicks +
                            TimeSpan.TicksPerSecond
                    }
                }
            }
        } catch (error WalletException) { }
    }

    private async func SubmitPendingCoreAsync(pending PendingSend, ct CancellationToken) SendResult {
        await Task.Delay(2000, ct)
        try {
            using let response = await session
                .Node
                .Api
                .JsonAsync("wallet/send", writer -> writer.WriteRawValue(pending.Body, true), ct, pending.Key, true)
            let root = response.RootElement
            let txid = NodeJson.Text(root, "txid")
            if txid.Length == 0 || NodeJson.Flag(root, "dry_run") {
                throw WalletException("Invalid send response", 0, true)
            }
            var inputCount int32
            if let count = NodeJson.OptionalNumber(root, "input_count") {
                inputCount = int32(count)
            }
            let result = SendResult(txid, NodeJson.Number(root, "fee"), NodeJson.Number(root, "change"), inputCount)
            store.Clear()
            if result.InputCount > 0 {
                return result
            }
            let inputs = await SubmittedInputCountAsync(txid)
            return SendResult(txid, result.Fee, result.Change, inputs)
        } catch (error WalletException) {
            if error.StatusCode == 429 {
                store.Clear()
                throw error
            }
            await RecoverCoreAsync(CancellationToken.None)
            let outcome = Outcome
            Outcome = SendOutcome()
            if store.Pending != nil {
                throw WalletException("Send outcome unknown. Resolve the pending send before starting another", 0, true)
            }
            if outcome.TxId.Length > 0 {
                return SendResult(outcome.TxId, 0, 0, 0)
            }
            throw WalletException(outcome.Text)
        }
    }

    private async func SubmittedInputCountAsync(txid string) int32 {
        using let deadline = CancellationTokenSource(TimeSpan.FromSeconds(5))
        try {
            using let response = await session.Node.Api.JsonAsync("tx/" + txid, ct: deadline.Token)
            if response.RootElement.TryGetProperty("tx", out let tx) && tx.TryGetProperty("inputs", out let inputs) &&
                inputs.ValueKind == JsonValueKind.Array {
                return inputs.GetArrayLength()
            }
        } catch (error WalletException) { }
        return 0
    }

    async func ResumeAsync(ct CancellationToken = default(CancellationToken)) SendResult {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            using let lease = store.AcquireLease()
            await RecoverCoreAsync(ct)
            if store.Error.Length > 0 {
                throw WalletException(store.Error)
            }
            guard let pending = store.Pending else {
                if Outcome.TxId.Length > 0 {
                    return SendResult(Outcome.TxId, 0, 0, 0)
                }
                throw WalletException(
                    if Outcome.Text.Length > 0 {
                        Outcome.Text
                    } else {
                        "No pending send"
                    }
                )
            }
            if !pending.Retryable {
                throw WalletException("Send outcome unknown. Resubmission is not available")
            }
            store.Pending = PendingSend{... pending, CanRetry: false}
            return await SubmitPendingCoreAsync(pending, ct)
        } finally {
            session.End()
        }
    }

    async func DismissAsync(ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            using let lease = store.AcquireLease()
            store.Load()
            if store.Error.Length > 0 {
                throw WalletException(store.Error)
            }
            store.Clear()
            Outcome = SendOutcome()
        } finally {
            session.End()
        }
    }

    shared {
        private func WriteSend(writer Utf8JsonWriter, address string, amount uint64, memo string, dryRun bool) {
            writer.WriteStartObject()
            writer.WriteBoolean("dry_run", dryRun)
            writer.WriteStartArray("recipients")
            writer.WriteStartObject()
            writer.WriteString("address", address)
            writer.WriteNumber("amount", amount)
            if memo.Length > 0 {
                writer.WriteString("memo_text", memo)
            }
            writer.WriteEndObject()
            writer.WriteEndArray()
            writer.WriteEndObject()
        }
    }
}
