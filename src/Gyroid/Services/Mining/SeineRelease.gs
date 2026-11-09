package Gyroid.Services

import System
import System.Formats.Tar
import System.IO
import System.IO.Compression
import System.Net.Http
import System.Runtime.InteropServices
import System.Security.Cryptography
import System.Threading
import System.Threading.Tasks

class SeineRelease {
    shared {
        let Version string = "0.3.1"

        async func DownloadAsync(progress Action[int32], cancellation CancellationToken) string {
            let platform = if OperatingSystem.IsLinux() && RuntimeInformation.ProcessArchitecture == Architecture.X64 {
                "linux-x86_64"
            } else if OperatingSystem.IsWindows() && RuntimeInformation.ProcessArchitecture == Architecture.X64 {
                "windows-x86_64"
            } else if OperatingSystem.IsMacOS() && RuntimeInformation.ProcessArchitecture == Architecture.Arm64 {
                "macos-aarch64"
            } else {
                throw WalletException("No Seine release is available for this platform")
            }
            let expected = switch platform {
                case "linux-x86_64": "ad8736fda31c4815eb2672f2e6fd1974f295f47e03d22b49f384cceb5fef2d81"
                case "windows-x86_64": "a5882b8072dd444abf0380f3bc1ee132c3954970b2f84c9e152ebaa68cb898c5"
                default: "9a2e2787af27a0b144cff02aa13b21197099de850ff09d0acf66f5865dcf88e7"
            }
            let directory = Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData,
                    Environment.SpecialFolderOption.DoNotVerify
                ),
                "Gyroid",
                "seine",
                Version
            )
            let executable = OperatingSystem.IsWindows() ? "seine.exe": "seine"
            let path = Path.Combine(directory, executable)
            if File.Exists(path) {
                return path
            }
            let parent = Path.GetDirectoryName(directory) ??
                throw WalletException("Seine installation directory is unavailable")
            Directory.CreateDirectory(parent)
            PrivateFiles.ProtectDirectory(parent)
            let temporary = directory + "." + Guid.NewGuid().ToString("N")
            let archivePath = temporary + ".archive"
            Directory.CreateDirectory(temporary)
            PrivateFiles.ProtectDirectory(temporary)
            using let deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)
            deadline.CancelAfter(TimeSpan.FromMinutes(3))
            let ct = deadline.Token
            try {
                try {
                    using let http = HttpClient(SocketsHttpHandler{UseProxy: false})
                    let suffix = OperatingSystem.IsWindows() ? ".zip": ".tar.gz"
                    using let response = await http.GetAsync(
                        "https://github.com/zpalmtree/seine/releases/download/v" +
                            Version +
                            "/seine-" +
                            platform +
                            suffix,
                        HttpCompletionOption.ResponseHeadersRead,
                        ct
                    )
                    if !response.IsSuccessStatusCode {
                        throw WalletException("Seine download failed")
                    }
                    let length = response.Content.Headers.ContentLength ?? 0
                    if length > 67108864 {
                        throw WalletException("Seine archive exceeds the size limit")
                    }
                    using let input = await response.Content.ReadAsStreamAsync(ct)
                    using let output = PrivateFiles.CreatePrivate(archivePath)
                    let buffer = [65536]uint8
                    var percent = -1
                    while true {
                        let count = await input.ReadAsync(buffer, 0, buffer.Length, ct)
                        if count == 0 {
                            break
                        }
                        if output.Length + count > 67108864 {
                            throw WalletException("Seine archive exceeds the size limit")
                        }
                        await output.WriteAsync(buffer, 0, count, ct)
                        let value = length > 0 ? int32(Math.Min(100L, output.Length * 100 / length)): 0
                        if percent != value {
                            percent = value
                            progress(value)
                        }
                    }
                    output.Flush(true)
                    output.Dispose()
                    using let archive = File.OpenRead(archivePath)
                    let digest = Convert.ToHexString(await SHA256.HashDataAsync(archive, ct))
                    if !digest.Equals(expected, StringComparison.OrdinalIgnoreCase) {
                        throw WalletException("Seine archive checksum does not match the pinned release")
                    }
                    archive.Position = 0
                    if OperatingSystem.IsWindows() {
                        ZipFile.ExtractToDirectory(archive, temporary)
                    } else {
                        using let gzip = GZipStream(archive, CompressionMode.Decompress)
                        await TarFile.ExtractToDirectoryAsync(gzip, temporary, false, ct)
                    }
                    let extracted = Path.Combine(temporary, executable)
                    if !File.Exists(extracted) {
                        throw WalletException("Seine archive does not contain the release executable")
                    }
                    if !OperatingSystem.IsWindows() {
                        File.SetUnixFileMode(
                            extracted,
                            UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                        )
                    }
                    if Directory.Exists(directory) {
                        Directory.Delete(directory, true)
                    }
                    Directory.Move(temporary, directory)
                    return path
                } catch (error OperationCanceledException) {
                    cancellation.ThrowIfCancellationRequested()
                    throw WalletException("Seine download timed out")
                } catch (error HttpRequestException) {
                    throw WalletException("Seine download failed")
                } catch (error InvalidDataException) {
                    throw WalletException("Seine archive could not be extracted")
                }
            } finally {
                if File.Exists(archivePath) {
                    File.Delete(archivePath)
                }
                if Directory.Exists(temporary) {
                    Directory.Delete(temporary, true)
                }
            }
        }
    }
}
