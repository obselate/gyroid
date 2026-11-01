package Gyroid.Services

import System
import System.Threading

class MessageProofs {
    let session WalletSession

    init(session WalletSession) {
        this.session = session
    }

    async func SignAsync(message string, ct CancellationToken = default(CancellationToken)) string {
        WalletValidation.ValidateMessage(message)
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            session.Touch()
            return await SignCoreAsync(message, ct)
        } finally {
            session.End()
        }
    }

    async func VerifyAsync(
        address string,
        message string,
        signature string,
        ct CancellationToken = default(CancellationToken)
    ) bool {
        WalletValidation.ValidateMessage(message)
        await session.BeginAsync(ct)
        try {
            return await VerifyCoreAsync(address, message, signature, ct)
        } finally {
            session.End()
        }
    }

    async func SignCoreAsync(message string, ct CancellationToken) string {
        using let response = await session
            .Node
            .Api
            .JsonAsync(
            "wallet/sign",
            writer -> {
                writer.WriteStartObject()
                writer.WriteString("message", message)
                writer.WriteEndObject()
            },
            ct
        )
        return NodeJson.Text(response.RootElement, "signature")
    }

    async func VerifyCoreAsync(address string, message string, signature string, ct CancellationToken) bool {
        signature = signature.Replace(" ", "").Replace("\t", "").Replace("\r", "").Replace("\n", "")
        try {
            using let response = await session
                .Node
                .Api
                .JsonAsync(
                "verify",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteString("address", WalletValidation.ValidateAddress(address))
                    writer.WriteString("message", message)
                    writer.WriteString("signature", signature)
                    writer.WriteEndObject()
                },
                ct
            )
            return NodeJson.Flag(response.RootElement, "valid")
        } catch (error WalletException) {
            if error.StatusCode == 400 {
                return false
            }
            throw error
        }
    }

    async func ProveAsync(txid string, ct CancellationToken = default(CancellationToken)) string {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            session.Touch()
            using let response = await session
                .Node
                .Api
                .JsonAsync(
                "wallet/prove",
                writer -> {
                    writer.WriteStartObject()
                    writer.WriteString("txid", txid)
                    writer.WriteEndObject()
                },
                ct
            )
            return NodeJson.Text(response.RootElement, "tx_key")
        } finally {
            session.End()
        }
    }

    async func VerifyProofAsync(
        txid string,
        txKey string,
        address string,
        amount string,
        ct CancellationToken = default(CancellationToken)
    ) bool {
        let expected = WalletAmount.Parse(amount)
        await session.BeginAsync(ct)
        try {
            try {
                using let response = await session
                    .Node
                    .Api
                    .JsonAsync(
                    "verify-proof",
                    writer -> {
                        writer.WriteStartObject()
                        writer.WriteString("txid", txid)
                        writer.WriteString("tx_key", txKey)
                        writer.WriteString("address", WalletValidation.ValidateAddress(address))
                        writer.WriteEndObject()
                    },
                    ct
                )
                return NodeJson.Flag(response.RootElement, "valid") && NodeJson.Number(
                    response.RootElement,
                    "total_matched"
                ) == expected
            } catch (error WalletException) {
                if error.StatusCode == 400 {
                    return false
                }
                throw error
            }
        } finally {
            session.End()
        }
    }
}
