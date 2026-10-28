package Gyroid.Node

import Gyroid.Model
import Gyroid.Platform
import System
import System.IO
import System.IO.Compression
import System.Net.Http
import System.Runtime.InteropServices
import System.Security.Cryptography
import System.Threading
import System.Threading.Tasks

class CoreRelease {
    shared {
        func ExecutableName() string -> "blocknet-core-" + Platform() + if OperatingSystem.IsWindows() {
            ".exe"
        } else {
            ""
        }

        func InstallationPath() string -> Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData,
                Environment.SpecialFolderOption.DoNotVerify
            ),
            "Gyroid",
            "core",
            "v0.22.0",
            ExecutableName()
        )

        async func DownloadAsync(progress Action[string]?, cancellation CancellationToken) string {
            let path = InstallationPath()
            let directory = Path.GetDirectoryName(path) ??
                throw WalletException("Core installation directory is unavailable")
            Directory.CreateDirectory(directory)
            PrivateFiles.ProtectDirectory(directory)
            if !OperatingSystem.IsWindows() {
                File.SetUnixFileMode(
                    directory,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                )
            }
            let archivePath = path + "." + Guid.NewGuid().ToString("N") + ".zip"
            let temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp"
            using let deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)
            deadline.CancelAfter(TimeSpan.FromMinutes(3))
            let ct = deadline.Token
            using let http = HttpClient(SocketsHttpHandler{AllowAutoRedirect: false, UseProxy: false})
            var address = Uri(
                "https://github.com/blocknetprivacy/core/releases/download/v0.22.0/blocknet-core-" +
                    Platform() +
                    "-0.22.0.zip"
            )
            progress?.Invoke("0%")
            try {
                for redirect in 0 ... 3 {
                    using let response = await http.GetAsync(address, HttpCompletionOption.ResponseHeadersRead, ct)
                    let code = int32(response.StatusCode)
                    if code == 301 || code == 302 || code == 303 || code == 307 || code == 308 {
                        let location = response
                            .Headers
                            .Location ??
                            throw WalletException("Core download redirect is missing")
                        let next = Uri(address, location)
                        if next.Scheme != "https" ||
                            next.Host != "release-assets.githubusercontent.com" ||
                            !next.IsDefaultPort ||
                            next
                            .UserInfo
                            .Length != 0 {
                            throw WalletException("Core download redirect is not an official release asset")
                        }
                        address = next
                        continue
                    }
                    if !response.IsSuccessStatusCode {
                        throw WalletException("Core download failed")
                    }
                    let length = response.Content.Headers.ContentLength ?? 0
                    if length > 33554432 {
                        throw WalletException("Core download exceeds the size limit")
                    }
                    using let input = await response.Content.ReadAsStreamAsync(ct)
                    using let output = PrivateFiles.CreatePrivate(archivePath)
                    let buffer = [65536]uint8
                    var percent int32 = -1
                    while true {
                        let count = await input.ReadAsync(buffer, 0, buffer.Length, ct)
                        if count == 0 {
                            break
                        }
                        if output.Length + count > 33554432 {
                            throw WalletException("Core download exceeds the size limit")
                        }
                        await output.WriteAsync(buffer, 0, count, ct)
                        let current = if length > 0 {
                            int32(Math.Min(100L, output.Length * 100 / length))
                        } else {
                            0
                        }
                        if current != percent {
                            percent = current
                            progress?.Invoke(current.ToString() + "%")
                        }
                    }
                    output.Flush(true)
                    output.Dispose()
                    await InstallAsync(archivePath, temporary, path, ct)
                    return path
                }
                throw WalletException("Core download has too many redirects")
            } catch (error OperationCanceledException) {
                cancellation.ThrowIfCancellationRequested()
                throw WalletException("Core download timed out")
            } catch (error HttpRequestException) {
                throw WalletException("Core download failed")
            } finally {
                if File.Exists(archivePath) {
                    File.Delete(archivePath)
                }
                if File.Exists(temporary) {
                    File.Delete(temporary)
                }
            }
        }

        async func InstallAsync(archivePath string, temporary string, path string, ct CancellationToken) {
            try {
                using let archive = ZipFile.OpenRead(archivePath)
                let entry = archive.GetEntry(ExecutableName()) ??
                    throw WalletException("Core download does not contain the release executable")
                if entry.Length <= 0 || entry.Length > 67108864 {
                    throw WalletException("Core executable exceeds the size limit")
                }
                using let input = entry.Open()
                using let output = PrivateFiles.CreatePrivate(temporary)
                let buffer = [65536]uint8
                while true {
                    let count = await input.ReadAsync(buffer, 0, buffer.Length, ct)
                    if count == 0 {
                        break
                    }
                    if output.Length + count > 67108864 {
                        throw WalletException("Core executable exceeds the size limit")
                    }
                    await output.WriteAsync(buffer, 0, count, ct)
                }
                output.Flush(true)
                output.Dispose()
                VerifyExecutable(temporary)
                if !OperatingSystem.IsWindows() {
                    File.SetUnixFileMode(
                        temporary,
                        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                    )
                }
                File.Move(temporary, path, true)
            } finally {
                if File.Exists(temporary) {
                    File.Delete(temporary)
                }
            }
        }

        func Platform() string {
            let arch = if RuntimeInformation.ProcessArchitecture == Architecture.Arm64 {
                "arm64"
            } else if
            RuntimeInformation.ProcessArchitecture == Architecture.X64 {
                "amd64"
            } else {
                throw WalletException("No pinned core is available for this platform")
            }
            return arch + "-" + if OperatingSystem.IsLinux() {
                "linux"
            } else if OperatingSystem.IsMacOS() {
                "macos"
            } else if OperatingSystem.IsWindows() {
                "windows"
            } else {
                throw WalletException("No pinned core is available for this platform")
            }
        }

        func VerifyExecutable(path string) {
            using let stream = FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)
            let digest = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant()
            let expected = switch Platform() {
                case "amd64-linux": "d64a062646792c60c11ddbc232044943557a6a1deadbcc8cd6dc66c788b89342"
                case "arm64-linux": "106ac50e65c1a741fa949c84e96d057240e3df3d9ace2383128fc4506904e88c"
                case "amd64-macos": "47778cf2ee19035ac1dcddf839d8123faade0fac4926d07124e54cb52e845f62"
                case "arm64-macos": "1a17f97de27339d00a4d8923d644b6aff0055762a3975fd73788f354f613fe7d"
                case "amd64-windows": "79e27d922e442d8152eb89e04b9db4f555e3a326a06f5334a30e86b2adbdb260"
                default: throw WalletException("No pinned core is available for this platform")
            }
            if digest != expected {
                throw WalletException("Core executable does not match the pinned Blocknet 0.22.0 release")
            }
        }
    }
}
