package Gyroid.Services

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Net.Http
import System.Text
import System.Threading

data struct LibraryWallet {
    var Filename string
    var Used DateTime
}

data struct LibraryListing {
    var Rows IReadOnlyList[LibraryWallet]
    var Error string
}

class WalletLibrary {
    let session WalletSession

    init(session WalletSession) {
        this.session = session
    }

    func ListWallets(directory string, ct CancellationToken) LibraryListing {
        let rows = List[LibraryWallet]()
        let magic = Encoding.ASCII.GetBytes("BLKNTWLT")
        let header = [magic.Length]byte
        try {
            if Directory.Exists(directory) {
                for path in Directory.EnumerateFiles(directory, "*.dat").Order(StringComparer.Ordinal) {
                    ct.ThrowIfCancellationRequested()
                    if FileInfo(path).LinkTarget != nil {
                        continue
                    }
                    let filename = Path.GetFileName(path)
                    try {
                        WalletValidation.ValidateFilename(filename)
                        using let input = PrivateFiles.OpenRead(path)
                        if input.Read(header, 0, header.Length) != header.Length || !header.SequenceEqual(magic) {
                            continue
                        }
                    } catch (error WalletException) {
                        continue
                    } catch (error IOException) {
                        continue
                    } catch (error UnauthorizedAccessException) {
                        continue
                    }
                    rows.Add(LibraryWallet{Filename: filename, Used: File.GetLastWriteTime(path)})
                }
            }
        } catch (error Exception) when !(error is OperationCanceledException) {
            return LibraryListing{Rows: rows.AsReadOnly(), Error: error.Message}
        }
        return LibraryListing{Rows: rows.AsReadOnly(), Error: ""}
    }

    async func ChooseWalletAsync(filename string, ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        try {
            let path = WalletPath(filename)
            if !File.Exists(path) {
                throw WalletException("Selected wallet file does not exist")
            }
            await session.PrepareWalletAsync(ct)
            session.settings.ActiveWallet = filename
            await SettingsStore.SaveAsync(session.settings, ct)
            session.PublishEmpty()
        } finally {
            session.End()
        }
    }

    async func ImportFileAsync(absolutePath string, password[]char, ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        var temporary = ""
        var candidateLoaded = false
        try {
            if !Path.IsPathFullyQualified(absolutePath) || !File.Exists(absolutePath) {
                throw WalletException("Choose an existing wallet file with an absolute path")
            }
            let filename = Path.GetFileName(absolutePath)
            await session.PrepareWalletAsync(ct)
            await session.Node.ConnectAsync(session.settings, ct)
            let destination = WalletPath(filename)
            if Path.GetFullPath(absolutePath) != Path.GetFullPath(destination) {
                if File.Exists(destination) || Directory.Exists(destination) {
                    throw WalletException("Wallet file could not be imported. Existing files are never replaced")
                }
                Directory.CreateDirectory(session.settings.WalletDirectory)
                temporary = Path.Combine(session.settings.WalletDirectory, ".import-" + Guid.NewGuid().ToString("N"))
                using let source = PrivateFiles.OpenRead(absolutePath)
                using let output = PrivateFiles.CreatePrivate(temporary)
                await source.CopyToAsync(output, ct)
                await output.FlushAsync(ct)
                output.Dispose()
                try {
                    await session.LoadWalletCoreAsync(temporary, password, CancellationToken.None)
                } catch (error WalletException) {
                    if error.Message == "Wrong wallet password" || error.StatusCode == 409 {
                        throw error
                    }
                    throw WalletException("Wallet file could not be imported. Existing files are never replaced")
                }
                candidateLoaded = true
                using let closed = await session.Node.Api.JsonAsync("wallet/unload", WalletSession.WriteEmpty, ct)
                candidateLoaded = false
                ct.ThrowIfCancellationRequested()
                File.Move(temporary, destination, false)
            }
            await session.LoadWalletCoreAsync(destination, password, CancellationToken.None)
            await session.ActivateCoreAsync(filename, CancellationToken.None)
        } catch (error IOException) {
            throw WalletException("Wallet file could not be imported. Existing files are never replaced")
        } catch (error UnauthorizedAccessException) {
            throw WalletException("Access to the selected wallet file was denied")
        } finally {
            try {
                if candidateLoaded {
                    using let closed = await session
                        .Node
                        .Api
                        .JsonAsync("wallet/unload", WalletSession.WriteEmpty, CancellationToken.None)
                }
                if temporary.Length > 0 {
                    File.Delete(temporary)
                }
            } finally {
                session.End()
            }
        }
    }

    func DataWallets() List[string] {
        let found = List[string]()
        let magic = Encoding.ASCII.GetBytes("BLKNTWLT")
        let header = [magic.Length]byte
        let data = Path.GetFullPath(session.settings.DataDirectory)
        let checkpoint = Path.Combine(data, "checkpoints.dat")
        let comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase: StringComparison.Ordinal
        for path in Directory.EnumerateFiles(
            data,
            "*",
            EnumerationOptions{
                RecurseSubdirectories: true,
                IgnoreInaccessible: false,
                AttributesToSkip: FileAttributes.ReparsePoint
            }
        ) {
            if path.Equals(checkpoint, comparison) {
                continue
            }
            using let input = PrivateFiles.OpenRead(path)
            if path.EndsWith(".dat", StringComparison.OrdinalIgnoreCase) || input.Read(
                header,
                0,
                header.Length
            ) == header.Length &&
                header.SequenceEqual(magic) {
                found.Add(path)
            }
        }
        return found
    }

    async func PreserveBeforePurgeAsync(ct CancellationToken) {
        let settings = session.settings
        if settings.LoadError.Length > 0 || Environment.GetEnvironmentVariable("GYROID_WALLET_DIR") != nil {
            throw WalletException("Save wallet settings without a wallet folder override before purging")
        }
        let data = Path.GetFullPath(settings.DataDirectory)
        let destination = Path.GetFullPath(SettingsStore.DefaultWallets(settings.Network))
        let relative = Path.GetRelativePath(data, destination)
        if !Path.IsPathRooted(relative) && relative != ".." && !relative.StartsWith(
            ".." + Path.DirectorySeparatorChar,
            StringComparison.Ordinal
        ) {
            throw WalletException("Wallet preservation folder must be outside the core data folder")
        }
        for path in[]string{data, destination} {
            var directory DirectoryInfo? = DirectoryInfo(path)
            while directory != nil {
                if directory.LinkTarget != nil {
                    throw WalletException("Purge folders must not use symbolic links")
                }
                directory = directory.Parent
            }
        }
        let sources = List[string]()
        let names = HashSet[string](
            if OperatingSystem.IsWindows() {
                StringComparer.OrdinalIgnoreCase
            } else {
                StringComparer.Ordinal
            }
        )
        for path in DataWallets() {
            let name = Path.GetFileName(path)
            if !names.Add(name) || File.Exists(Path.Combine(destination, name)) || Directory.Exists(
                Path.Combine(destination, name)
            ) {
                throw WalletException("Wallet preservation found a duplicate filename. Purge was cancelled")
            }
            sources.Add(path)
        }
        Directory.CreateDirectory(destination)
        PrivateFiles.ProtectDirectory(destination)
        if !OperatingSystem.IsWindows() {
            File.SetUnixFileMode(destination, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
        }
        for path in sources {
            using let input = PrivateFiles.OpenRead(path)
            await PrivateFiles.WriteAtomic(
                Path.Combine(destination, Path.GetFileName(path)),
                stream -> input.CopyToAsync(stream, ct),
                false,
                true
            )
        }
        let walletRelative = Path.GetRelativePath(data, Path.GetFullPath(settings.WalletDirectory))
        if !Path.IsPathRooted(walletRelative) && walletRelative != ".." && !walletRelative.StartsWith(
            ".." + Path.DirectorySeparatorChar,
            StringComparison.Ordinal
        ) {
            settings.WalletDirectory = destination
        }
        using let updated = await session
            .Node
            .Api
            .JsonAsync(
            "settings",
            writer -> {
                writer.WriteStartObject()
                writer.WriteString(
                    "wallet_file",
                    Path.Combine(
                        settings.WalletDirectory,
                        if settings.ActiveWallet.Length > 0 {
                            settings.ActiveWallet
                        } else {
                            "default.wallet.dat"
                        }
                    )
                )
                writer.WriteEndObject()
            },
            ct,
            method: HttpMethod.Patch
        )
        await SettingsStore.SaveAsync(settings, ct)
        for path in sources {
            File.Delete(path)
        }
    }

    func WalletPath(filename string) string {
        WalletValidation.ValidateFilename(filename)
        let path = Path.Combine(session.settings.WalletDirectory, filename)
        if FileInfo(path).LinkTarget != nil {
            throw WalletException("Wallet files must not be symbolic links")
        }
        return path
    }

    func RequireNewWallet(filename string, password[]char) {
        let error = WalletValidation.PasswordError(password, password)
        if error.Length > 0 {
            throw WalletException(error)
        }
        let path = WalletPath(filename)
        if File.Exists(path) || Directory.Exists(path) {
            throw WalletException("Wallet file already exists. Choose a different name")
        }
    }
}
