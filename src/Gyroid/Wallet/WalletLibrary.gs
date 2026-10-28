package Gyroid.Wallet

import Gyroid.Platform
import Gyroid.Settings
import System
import System.Collections.Generic
import System.IO
import System.Linq
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
