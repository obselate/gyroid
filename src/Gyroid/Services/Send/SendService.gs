package Gyroid.Services

import Gyroid.Models
import System
import System.IO
import System.Linq
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
        requests[]WalletRecipient,
        ct CancellationToken = default(CancellationToken)
    ) SendEstimate {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            using let lease = store.AcquireLease()
            RequireNoPendingSend()
            InvalidateConfirmation()
            let spendable = session
                .Snapshot
                .Balance
                ?.Spendable ??
                throw WalletException("Spendable balance is unavailable")
            let recipients = Validate(requests, spendable)
            using let walletAddress = await session.Node.Api.JsonAsync("wallet/address", ct: ct)
            if NodeJson.Flag(walletAddress.RootElement, "view_only") {
                throw WalletException("View-only wallets cannot send")
            }
            let handles = await ResolveRecipientsAsync(recipients, ct)
            using let request = MemoryStream()
            using let requestWriter = Utf8JsonWriter(request)
            WriteSend(requestWriter, recipients, false)
            requestWriter.Flush()
            let body = await SplitChangeAsync(
                Encoding.UTF8.GetString(request.GetBuffer(), 0, int32(request.Length)),
                ct
            )
            using let result = await EstimateBodyAsync(body, ct)
            let root = result.RootElement
            if !NodeJson.Flag(root, "dry_run") {
                throw WalletException("Daemon did not return a dry-run estimate")
            }
            let fee = NodeJson.Number(root, "fee")
            let inputTotal = NodeJson.Number(root, "input_total")
            let change = NodeJson.Number(root, "change")
            let estimate = SendEstimate(recipients, handles, fee, change, int32(NodeJson.Number(root, "input_count")))
            estimate.Body = body
            if estimate.Amount > uint64.MaxValue - fee || inputTotal < change || inputTotal - change != estimate.Total {
                throw WalletException("Node returned an invalid send total")
            }
            if estimate.Total > spendable {
                throw WalletException("Amount and fee exceed spendable balance")
            }
            confirmation = estimate
            confirmationKey = Guid.NewGuid().ToString("N")
            return estimate
        } finally {
            session.End()
        }
    }

    private async func ResolveRecipientsAsync(recipients[]WalletRecipient, ct CancellationToken)[]string {
        let handles = [recipients.Length]string
        for index in 0 ... recipients.Length {
            handles[index] = ""
            if recipients[index].Address.StartsWith("$", StringComparison.Ordinal) {
                let resolved = await BlocknetIdService.ResolveAsync(recipients[index].Address, ct)
                handles[index] = resolved.Handle
                recipients[index] = WalletRecipient{
                    ... recipients[index],
                    Address: WalletValidation.ValidateAddress(resolved.Address)
                }
            }
        }
        return handles
    }

    private func Validate(requests[]WalletRecipient, spendable uint64)[]WalletRecipient {
        if requests.Length == 0 {
            throw WalletException("Add a recipient")
        }
        let recipients = [requests.Length]WalletRecipient
        var total uint64 = 0
        for index in 0 ... requests.Length {
            let request = requests[index]
            recipients[index] = WalletValidation.ValidateSend(
                request.Address,
                WalletAmount.Format(request.Amount),
                request.Memo,
                spendable - total
            )
            total += recipients[index].Amount
        }
        return recipients
    }

    async func MaximumAsync(
        others[]WalletRecipient,
        address string,
        memo string,
        ct CancellationToken = default(CancellationToken)
    ) uint64 {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            using let owned = await session.Node.Api.JsonAsync("wallet/outputs", ct: ct)
            let inputs = owned
                .RootElement
                .GetProperty("outputs")
                .EnumerateArray()
                .Where((output JsonElement) -> NodeJson.Text(output, "status") == "unspent")
                .OrderByDescending((output JsonElement) -> NodeJson.Number(output, "amount"))
                .Take(256)
                .ToArray()
            var available uint64 = 0
            for output in inputs {
                available += NodeJson.Number(output, "amount")
            }
            var reserved uint64 = 0
            for other in others {
                reserved += other.Amount
            }
            let probe = others.Append(WalletRecipient{Address: address, Amount: 1, Memo: memo}).ToArray()
            await ResolveRecipientsAsync(probe, ct)
            using let estimate = await session
                .Node
                .Api
                .JsonAsync(
                "wallet/send/advanced",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteBoolean("dry_run", true)
                    writer.WriteStartArray("inputs")
                    for output in inputs {
                        writer.WriteStartObject()
                        writer.WriteString("txid", NodeJson.Text(output, "txid"))
                        writer.WriteNumber("output_index", NodeJson.Number(output, "output_index"))
                        writer.WriteEndObject()
                    }
                    writer.WriteEndArray()
                    WriteRecipients(writer, probe)
                    writer.WriteEndObject()
                },
                ct
            )
            let fee = NodeJson.Number(estimate.RootElement, "fee")
            if available <= reserved + fee {
                throw WalletException("Amount and fee exceed spendable balance")
            }
            let maximum = available - reserved - fee
            probe[probe.Length - 1] = WalletRecipient{... probe[probe.Length - 1], Amount: maximum}
            using let check = await session
                .Node
                .Api
                .JsonAsync("wallet/send", writer -> WriteSend(writer, probe, true), ct)
            if NodeJson.Number(check.RootElement, "fee") + maximum + reserved > available {
                throw WalletException("Amount and fee exceed spendable balance")
            }
            return maximum
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
            Validate(estimate.Recipients, available)
            if estimate.Total > available {
                throw WalletException("Amount and fee exceed spendable balance")
            }
            let key = confirmationKey
            InvalidateConfirmation()
            using let walletAddress = await session.Node.Api.JsonAsync("wallet/address", ct: ct)
            if NodeJson.Flag(walletAddress.RootElement, "view_only") {
                throw WalletException("View-only wallets cannot send")
            }
            let pending = PendingSend{
                Key: key,
                Body: estimate.Body,
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

    async func RecoverAsync(ct CancellationToken, reloadSends bool = true) {
        if !store.Exists {
            store.Pending = nil
            store.Error = ""
            return
        }
        var lease FileStream? = nil
        try {
            try {
                lease = store.AcquireLease()
            } catch (error WalletException) {
                store.Error = error.Message
                return
            }
            await RecoverCoreAsync(ct, reloadSends)
        } finally {
            lease?.Dispose()
        }
    }

    private async func RecoverCoreAsync(ct CancellationToken, reloadSends bool = true) {
        store.Load()
        guard let pending = store.Pending else {
            return
        }
        try {
            using let response = await session
                .Node
                .Api
                .JsonAsync(
                SendPath(pending.Body) + "/status?idempotency_key=" + Uri.EscapeDataString(pending.Key),
                ct: ct
            )
            let root = response.RootElement
            let status = NodeJson.Text(root, "state")
            if reloadSends && session.State == WalletState.Unlocked {
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
            } else if status == "in_progress" || status == "accepted" {
                store.Pending = PendingSend{
                    ... pending,
                    CanRetry: false,
                    State: if status == "in_progress" {
                        "Send in progress"
                    } else {
                        "Send outcome unknown"
                    }
                }
            } else if status == "not_found" && session.State == WalletState.Unlocked {
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
        } catch (error WalletException) { } finally {
            if pending.CanRetry && Object.ReferenceEquals(store.Pending, pending) {
                store.Pending = PendingSend{... pending, CanRetry: false}
            }
        }
    }

    private async func SubmitPendingCoreAsync(pending PendingSend, ct CancellationToken) SendResult {
        try {
            using let response = await session
                .Node
                .Api
                .JsonAsync(
                SendPath(pending.Body),
                writer -> writer.WriteRawValue(pending.Body, true),
                ct,
                pending.Key,
                true
            )
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
            if error.StatusCode == 403 || error.StatusCode == 429 || error.StatusCode == 503 {
                store.Clear()
                throw error
            }
            await RecoverCoreAsync(ct)
            let outcome = Outcome
            Outcome = SendOutcome()
            if store.Pending != nil {
                throw WalletException("Send outcome unknown. Resolve the pending send before starting another", 0, true)
            }
            if outcome.TxId.Length > 0 {
                return SendResult(outcome.TxId, 0, 0, 0)
            }
            throw WalletException(WalletText.Outcome(outcome))
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
                    if Outcome.TxId.Length > 0 || Outcome.Error != nil {
                        WalletText.Outcome(Outcome)
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
            store.Clear()
            Outcome = SendOutcome()
        } finally {
            session.End()
        }
    }

    async func EstimatePreparationAsync(ct CancellationToken) SendEstimate {
        let address = session.Snapshot.Address
        let others = [7]WalletRecipient
        for index in 0 ... others.Length {
            others[index] = WalletRecipient{Address: address, Amount: 1}
        }
        let maximum = await MaximumAsync(others, address, "", ct)
        let amount = maximum + uint64(others.Length)
        let recipients = [8]WalletRecipient
        for index in 0 ... recipients.Length {
            recipients[index] = WalletRecipient{
                Address: address,
                Amount: amount / 8 + (uint64(index) < amount % 8 ? uint64(1): uint64(0))
            }
        }
        return await EstimateAsync(recipients, ct)
    }

    async func EstimateBodyAsync(body string, ct CancellationToken) JsonDocument {
        using let request = JsonDocument.Parse(body)
        return await session
            .Node
            .Api
            .JsonAsync(
            SendPath(body),
            writer -> {
                writer.WriteStartObject()
                for property in request.RootElement.EnumerateObject() {
                    if property.Name != "dry_run" {
                        property.WriteTo(writer)
                    }
                }
                writer.WriteBoolean("dry_run", true)
                writer.WriteEndObject()
            },
            ct
        )
    }

    async func SplitChangeAsync(body string, ct CancellationToken) string {
        using let estimate = await EstimateBodyAsync(body, ct)
        let root = estimate.RootElement
        if NodeJson.Number(root, "change") < 400000000 {
            return body
        }
        using let owned = await session.Node.Api.JsonAsync("wallet/outputs", ct: ct)
        let outputs = owned
            .RootElement
            .GetProperty("outputs")
            .EnumerateArray()
            .Where(output -> NodeJson.Text(output, "status") == "unspent")
            .OrderByDescending(output -> NodeJson.Number(output, "amount"))
            .ToArray()
        if outputs.Length - int32(NodeJson.Number(root, "input_count")) >= 4 {
            return body
        }
        using let request = JsonDocument.Parse(body)
        let recipients = request.RootElement.GetProperty("recipients")
        var amount uint64 = 0
        for recipient in recipients.EnumerateArray() {
            amount += NodeJson.Number(recipient, "amount")
        }
        var count int32 = 0
        var total uint64 = 0
        let needed = amount + NodeJson.Number(root, "fee")
        while count < outputs.Length && total < needed && count < 256 {
            total += NodeJson.Number(outputs[count], "amount")
            count++
        }
        if outputs.Length - count >= 4 {
            return body
        }
        using let probe = await session
            .Node
            .Api
            .JsonAsync(
            "wallet/send/advanced",
            writer -> {
                writer.WriteStartObject()
                writer.WriteBoolean("dry_run", true)
                writer.WriteNumber("change_split", 4)
                WriteInputs(writer, outputs, count)
                writer.WriteStartArray("recipients")
                for recipient in recipients.EnumerateArray() {
                    writer.WriteStartObject()
                    writer.WriteString("address", NodeJson.Text(recipient, "address"))
                    writer.WriteNumber("amount", 1)
                    writer.WriteEndObject()
                }
                writer.WriteEndArray()
                writer.WriteEndObject()
            },
            ct
        )
        let fee = NodeJson.Number(probe.RootElement, "fee")
        if total < amount || total - amount < fee || total - amount - fee < 400000000 {
            return body
        }
        using let stream = MemoryStream()
        using let writer = Utf8JsonWriter(stream)
        writer.WriteStartObject()
        writer.WriteBoolean("dry_run", false)
        writer.WriteNumber("change_split", 4)
        WriteInputs(writer, outputs, count)
        writer.WritePropertyName("recipients")
        recipients.WriteTo(writer)
        writer.WriteEndObject()
        writer.Flush()
        return Encoding.UTF8.GetString(stream.GetBuffer(), 0, int32(stream.Length))
    }

    shared {
        func SendPath(body string) string {
            using let request = JsonDocument.Parse(body)
            return request.RootElement.TryGetProperty("inputs", out _) ? "wallet/send/advanced": "wallet/send"
        }

        private func WriteInputs(writer Utf8JsonWriter, outputs[]JsonElement, count int32) {
            writer.WriteStartArray("inputs")
            for index in 0 ... count {
                writer.WriteStartObject()
                writer.WriteString("txid", NodeJson.Text(outputs[index], "txid"))
                writer.WriteNumber("output_index", NodeJson.Number(outputs[index], "output_index"))
                writer.WriteEndObject()
            }
            writer.WriteEndArray()
        }

        private func WriteSend(writer Utf8JsonWriter, recipients[]WalletRecipient, dryRun bool) {
            writer.WriteStartObject()
            writer.WriteBoolean("dry_run", dryRun)
            WriteRecipients(writer, recipients)
            writer.WriteEndObject()
        }

        private func WriteRecipients(writer Utf8JsonWriter, recipients[]WalletRecipient) {
            writer.WriteStartArray("recipients")
            for recipient in recipients {
                writer.WriteStartObject()
                writer.WriteString("address", recipient.Address)
                writer.WriteNumber("amount", recipient.Amount)
                if recipient.Memo.Length > 0 {
                    writer.WriteString("memo_text", recipient.Memo)
                }
                writer.WriteEndObject()
            }
            writer.WriteEndArray()
        }
    }
}
