package Gyroid.Services

import Gyroid.Models
import System
import System.Text
import System.Threading

class WalletKeys {
    let session WalletSession

    init(session WalletSession) {
        this.session = session
    }

    async func RevealSeedAsync(password[]char, ct CancellationToken = default(CancellationToken))[]char {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            if session.Snapshot.ViewOnly {
                throw WalletException("View-only wallets do not have a spend recovery phrase")
            }
            return await session.Node.Api.SeedAsync(password, ct)
        } finally {
            session.End()
        }
    }

    async func PhraseAsync(password[]char, ct CancellationToken = default(CancellationToken))[]char {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            if session.Snapshot.ViewOnly {
                throw WalletException("View-only wallets do not have a spend recovery phrase")
            }
            return await session.Node.Api.SeedAsync(password, ct)
        } finally {
            Array.Clear(password)
            session.End()
        }
    }

    async func ExportSeedAsync(path string, seed[]char, ct CancellationToken = default(CancellationToken)) {
        let bytes = [Encoding.UTF8.GetMaxByteCount(seed.Length)]uint8
        try {
            let count = Encoding.UTF8.GetBytes(seed, 0, seed.Length, bytes, 0)
            for index in 0 ... count {
                if bytes[index] == 32 {
                    bytes[index] = 10
                }
            }
            await PrivateFiles.WriteAtomic(
                path,
                destination -> destination.WriteAsync(bytes, 0, count, ct),
                true,
                false
            )
        } finally {
            Array.Clear(bytes)
        }
    }

    async func ExportViewKeysAsync(password[]char, ct CancellationToken = default(CancellationToken)) WalletViewKeys {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            session.Touch()
            return await session.Node.Api.ViewKeysAsync(password, "", []char{}, ct)
        } finally {
            session.End()
        }
    }

    async func SaveViewKeysAsync(path string, keys WalletViewKeys, ct CancellationToken = default(CancellationToken)) {
        let parts = [][]char{
            "spend_public ".ToCharArray(),
            keys.SpendPublic,
            "\nview_private ".ToCharArray(),
            keys.ViewPrivate,
            "\nview_public ".ToCharArray(),
            keys.ViewPublic,
            "\n".ToCharArray()
        }
        var length = 0
        for part in parts {
            length += part.Length
        }
        let bytes = [length]uint8
        try {
            var offset = 0
            for part in parts {
                offset += Encoding.ASCII.GetBytes(part, 0, part.Length, bytes, offset)
            }
            await PrivateFiles.WriteAtomic(
                path,
                destination -> destination.WriteAsync(bytes, 0, length, ct),
                true,
                false
            )
        } finally {
            Array.Clear(bytes)
        }
    }

    async func CreateViewOnlyAsync(
        filename string,
        password[]char,
        filePassword[]char,
        ct CancellationToken = default(CancellationToken)
    ) {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            if !filename.EndsWith(".wallet.dat", StringComparison.Ordinal) {
                throw WalletException("View-only file name must end in .wallet.dat")
            }
            session.Library.RequireNewWallet(filename, filePassword)
            if ReadOnlySpan[char](password).SequenceEqual(ReadOnlySpan[char](filePassword)) {
                throw WalletException("View-only file password must differ from the wallet password")
            }
            session.Touch()
            using let keys = await session.Node.Api.ViewKeysAsync(password, filename, filePassword, ct)
        } finally {
            session.End()
        }
    }
}
