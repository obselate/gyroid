package Gyroid.Wallet

import Gyroid.Platform
import Gyroid.Settings
import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Net.Http
import System.Text
import System.Threading

class WalletLibrary {
    let session WalletSession

    init(session WalletSession) {
        this.session = session
    }

    func ListWallets()[]string {
        if !Directory.Exists(session.settings.WalletDirectory) {
            return []string{}
        }
        let files = List[string]()
        let magic = Encoding.ASCII.GetBytes("BLKNTWLT")
        let header = [magic.Length]byte
        for path in Directory.EnumerateFiles(session.settings.WalletDirectory, "*.dat") {
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
            files.Add(filename)
        }
        files.Sort(StringComparer.Ordinal)
        return files.ToArray()
    }

    async func ChooseWalletAsync(filename string, ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        try {
            session.RequireUnloaded()
            let path = WalletPath(filename)
            if !File.Exists(path) {
                throw WalletException("Selected wallet file does not exist")
            }
            session.settings.ActiveWallet = filename
            await WalletSettings.SaveAsync(session.settings, ct)
            session.page = "Unlock"
            session.PublishEmpty()
        } finally {
            session.End()
        }
    }

    async func ImportFileAsync(absolutePath string, ct CancellationToken = default(CancellationToken)) {
        await session.BeginAsync(ct)
        try {
            try {
                session.RequireUnloaded()
                if !Path.IsPathFullyQualified(absolutePath) || !File.Exists(absolutePath) {
                    throw WalletException("Choose an existing wallet file with an absolute path")
                }
                using let input = PrivateFiles.OpenRead(absolutePath)
                let filename = Path.GetFileName(absolutePath)
                let destination = WalletPath(filename)
                if Path.GetFullPath(absolutePath) != Path.GetFullPath(destination) {
                    Directory.CreateDirectory(session.settings.WalletDirectory)
                    let temporary = Path.Combine(
                        session.settings.WalletDirectory,
                        ".import-" + Guid.NewGuid().ToString("N")
                    )
                    try {
                        using let output = PrivateFiles.CreatePrivate(temporary)
                        await input.CopyToAsync(output, ct)
                        await output.FlushAsync(ct)
                        output.Dispose()
                        File.Move(temporary, destination, false)
                    } finally {
                        if File.Exists(temporary) {
                            File.Delete(temporary)
                        }
                    }
                }
                session.settings.ActiveWallet = filename
                await WalletSettings.SaveAsync(session.settings, ct)
                session.page = "Unlock"
                session.PublishEmpty()
            } catch (error IOException) {
                throw WalletException("Wallet file could not be imported. Existing files are never replaced")
            } catch (error UnauthorizedAccessException) {
                throw WalletException("Access to the selected wallet file was denied")
            }
        } finally {
            session.End()
        }
    }

    async func PreserveBeforePurgeAsync(ct CancellationToken) {
        let settings = session.settings
        if settings.LoadError.Length > 0 || Environment.GetEnvironmentVariable("GYROID_WALLET_DIR") != nil {
            throw WalletException("Save wallet settings without a wallet folder override before purging")
        }
        let data = Path.GetFullPath(settings.DataDirectory)
        let destination = Path.GetFullPath(AppSettings.DefaultWallets(settings.Network))
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
        let magic = Encoding.ASCII.GetBytes("BLKNTWLT")
        let header = [magic.Length]byte
        for path in Directory.EnumerateFiles(
            data,
            "*",
            EnumerationOptions{
                RecurseSubdirectories: true,
                IgnoreInaccessible: false,
                AttributesToSkip: FileAttributes.ReparsePoint
            }
        ) {
            using let input = PrivateFiles.OpenRead(path)
            if !path.EndsWith(".dat", StringComparison.OrdinalIgnoreCase) &&
                (input.Read(header, 0, header.Length) != header.Length || !header.SequenceEqual(magic)) {
                continue
            }
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
        await AppSettings.SaveAsync(settings, ct)
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
