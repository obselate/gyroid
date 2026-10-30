package Gyroid.Services

import System
import System.IO
import System.IO.Compression
import System.Linq
import System.Net.Http
import System.Runtime.InteropServices
import System.Security.Cryptography
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class CoreRelease {
    shared {
        let UpgradeHeight uint64 = 103680

        func ExecutableName() string -> "blocknet-core-" + Platform() + if OperatingSystem.IsWindows() {
            ".exe"
        } else {
            ""
        }

        func InstallationPath() string {
            let directory = Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData,
                    Environment.SpecialFolderOption.DoNotVerify
                ),
                "Gyroid",
                "core"
            )
            let path = Path.Combine(directory, ExecutableName())
            return if File.Exists(path) || !Directory.Exists(directory) {
                path
            } else {
                Directory
                    .EnumerateFiles(directory, ExecutableName(), SearchOption.AllDirectories)
                    .OrderByDescending(candidate -> File.GetLastWriteTimeUtc(candidate))
                    .FirstOrDefault() ??
                    path
            }
        }

        async func DownloadAsync(progress Action[string]?, cancellation CancellationToken) string {
            let path = InstallationPath()
            if File.Exists(path) {
                return path
            }
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
            let metadataPath = archivePath + ".json"
            let checksumsPath = archivePath + ".sha256"
            let temporary = archivePath + ".tmp"
            using let deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)
            deadline.CancelAfter(TimeSpan.FromMinutes(3))
            let ct = deadline.Token
            using let http = HttpClient(SocketsHttpHandler{AllowAutoRedirect: false, UseProxy: false})
            http.DefaultRequestHeaders.UserAgent.ParseAdd("Gyroid")
            try {
                try {
                    await DownloadFileAsync(
                        http,
                        Uri("https://api.github.com/repos/blocknetprivacy/core/releases/latest"),
                        metadataPath,
                        1048576,
                        nil,
                        ct
                    )
                    using let metadata = JsonDocument.Parse(File.ReadAllBytes(metadataPath))
                    let tag = metadata.RootElement.GetProperty("tag_name").GetString() ?? ""
                    if !tag.StartsWith("v", StringComparison.Ordinal) || tag.Length < 2 {
                        throw WalletException("Core release version is unavailable")
                    }
                    let filename = "blocknet-core-" + Platform() + "-" + tag.Substring(1) + ".zip"
                    let release = "https://github.com/blocknetprivacy/core/releases/download/" + Uri.EscapeDataString(
                        tag
                    ) +
                        "/"
                    await DownloadFileAsync(http, Uri(release + "SHA256SUMS.txt"), checksumsPath, 1048576, nil, ct)
                    await DownloadFileAsync(
                        http,
                        Uri(release + Uri.EscapeDataString(filename)),
                        archivePath,
                        33554432,
                        progress,
                        ct
                    )
                    using let archive = File.OpenRead(archivePath)
                    let digest = Convert.ToHexString(SHA256.HashData(archive))
                    archive.Dispose()
                    var expected = ""
                    for line in File.ReadAllLines(checksumsPath) {
                        let parts = line.Split([]char{' ', '\t'}, StringSplitOptions.RemoveEmptyEntries)
                        if parts.Length == 2 && parts[1].TrimStart('*') == filename {
                            expected = parts[0]
                            break
                        }
                    }
                    if !digest.Equals(expected, StringComparison.OrdinalIgnoreCase) {
                        throw WalletException("Core archive checksum does not match the release")
                    }
                    await InstallAsync(archivePath, temporary, path, ct)
                    return path
                } catch (error OperationCanceledException) {
                    cancellation.ThrowIfCancellationRequested()
                    throw WalletException("Core download timed out")
                } catch (error HttpRequestException) {
                    throw WalletException("Core download failed")
                }
            } finally {
                for file in[]string{archivePath, metadataPath, checksumsPath, temporary} {
                    if File.Exists(file) {
                        File.Delete(file)
                    }
                }
            }
        }

        private async func DownloadFileAsync(
            http HttpClient,
            address Uri,
            path string,
            maximum int64,
            progress Action[string]?,
            ct CancellationToken
        ) {
            var current = address
            for redirect in 0 ... 3 {
                using let response = await http.GetAsync(current, HttpCompletionOption.ResponseHeadersRead, ct)
                let code = int32(response.StatusCode)
                if code == 301 || code == 302 || code == 303 || code == 307 || code == 308 {
                    let location = response
                        .Headers
                        .Location ??
                        throw WalletException("Core download redirect is missing")
                    let next = Uri(current, location)
                    if next.Scheme != "https" ||
                        next.Host != "release-assets.githubusercontent.com" ||
                        !next.IsDefaultPort ||
                        next
                        .UserInfo
                        .Length != 0 {
                        throw WalletException("Core download redirect is not an official release asset")
                    }
                    current = next
                    continue
                }
                if !response.IsSuccessStatusCode {
                    throw WalletException("Core download failed")
                }
                let length = response.Content.Headers.ContentLength ?? 0
                if length > maximum {
                    throw WalletException("Core download exceeds the size limit")
                }
                using let input = await response.Content.ReadAsStreamAsync(ct)
                using let output = PrivateFiles.CreatePrivate(path)
                let buffer = [65536]uint8
                var percent int32 = -1
                while true {
                    let count = await input.ReadAsync(buffer, 0, buffer.Length, ct)
                    if count == 0 {
                        break
                    }
                    if output.Length + count > maximum {
                        throw WalletException("Core download exceeds the size limit")
                    }
                    await output.WriteAsync(buffer, 0, count, ct)
                    let value = if length > 0 {
                        int32(Math.Min(100L, output.Length * 100 / length))
                    } else {
                        0
                    }
                    if value != percent {
                        percent = value
                        progress?.Invoke(value.ToString() + "%")
                    }
                }
                output.Flush(true)
                return
            }
            throw WalletException("Core download has too many redirects")
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
                throw WalletException("No core release is available for this platform")
            }
            return arch + "-" + if OperatingSystem.IsLinux() {
                "linux"
            } else if OperatingSystem.IsMacOS() {
                "macos"
            } else if OperatingSystem.IsWindows() {
                "windows"
            } else {
                throw WalletException("No core release is available for this platform")
            }
        }
    }
}
