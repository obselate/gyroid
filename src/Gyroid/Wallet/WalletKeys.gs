package Gyroid.Wallet

import Gyroid.Platform
import System
import System.Text
import System.Threading

class WalletKeys {
    let session WalletSession
    var pendingSeed[]?char = nil

    init(session WalletSession) {
        this.session = session
    }

    async func ReadSeedAsync(password[]char, ct CancellationToken) {
        ClearSeed()
        pendingSeed = await session.Node.Api.SeedAsync(password, ct)
    }

    async func RevealSeedAsync(password[]char, ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        try {
            session.RequireUnlocked()
            if session.Snapshot.ViewOnly {
                throw WalletException("View-only wallets do not have a spend recovery phrase")
            }
            await ReadSeedAsync(password, ct)
            session.page = "Seed"
            session.PublishCurrent()
        } finally {
            session.End()
        }
    }

    func TakePendingSeed()[]?char {
        let seed = pendingSeed
        pendingSeed = nil
        return seed
    }

    func ContinueFromSeed() {
        ClearSeed()
        if session.State == "Unlocked" {
            session.page = "Wallet"
            session.PublishCurrent()
        }
        session.Changed?.Invoke()
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

    func ClearSeed() {
        if let seed = pendingSeed {
            Array.Clear(seed)
        }
        pendingSeed = nil
    }
}

class WalletViewKeys : IDisposable {
    var SpendPublic[]char = []char{}
    var ViewPrivate[]char = []char{}
    var ViewPublic[]char = []char{}

    func Dispose() {
        Array.Clear(SpendPublic)
        Array.Clear(ViewPrivate)
        Array.Clear(ViewPublic)
    }
}
