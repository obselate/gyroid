package Gyroid.Settings

import Gyroid.Platform
import System
import System.Globalization
import System.IO
import System.Net
import System.Net.Sockets
import System.Text.Json
import System.Threading
import System.Threading.Tasks

open class AppSettings {
    var ActiveWallet string = ""
    var Network string = "mainnet"
    var Endpoint string = ""
    var DataDirectory string = ""
    var WalletDirectory string = ""
    var BinaryPath string = ""
    var ListenAddress string = "/ip4/127.0.0.1/tcp/0"
    var NodeMode string = "automatic"
    var Language string = ""
    var Privacy bool
    var AutoLockMinutes int32
    var LoadError string = ""

    open func Validate() {
        if Network != "mainnet" && Network != "testnet" {
            throw WalletException("Network must be mainnet or testnet")
        }
        if NodeMode != "automatic" && NodeMode != "manual" {
            throw WalletException("Node mode must be automatic or manual")
        }
        if Language != "" && Language != "en" && Language != "zh-Hans" {
            throw WalletException("Language must be en or zh-Hans")
        }
        if AutoLockMinutes < 0 {
            throw WalletException("Auto-lock minutes must be zero or greater")
        }
        if !ValidEndpoint(Endpoint) {
            throw WalletException("API endpoint must be a loopback HTTP origin")
        }
        if !ValidPath(DataDirectory) || !ValidPath(WalletDirectory) {
            throw WalletException("Data and wallet directories must be valid absolute paths")
        }
        if BinaryPath.Length > 0 && !ValidPath(BinaryPath) {
            throw WalletException("Daemon binary must be an absolute path")
        }
        let listen = ListenError(ListenAddress)
        if listen.Length > 0 {
            throw WalletException(listen)
        }
    }

    shared {
        func ListenError(value string) string {
            let parts = value.Split('/')
            let valid = parts.Length == 5 && parts[0].Length == 0 && parts[3] == "tcp" && uint16.TryParse(
                parts[4],
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out _
            ) &&
                IPAddress.TryParse(parts[2], out let address) &&
                (
                parts[1] == "ip4" && address.AddressFamily == AddressFamily.InterNetwork && parts[2].Split('.')
                    .Length == 4 ||
                    parts[1] == "ip6" &&
                    address.AddressFamily == AddressFamily.InterNetworkV6
            )
            return if valid {
                ""
            } else {
                "P2P address must be /ip4/<address>/tcp/<port> or /ip6/<address>/tcp/<port>"
            }
        }

        func ConfigurationPath() string {
            let configured = Environment.GetEnvironmentVariable("GYROID_SETTINGS")
            if !string.IsNullOrWhiteSpace(configured) {
                return Path.GetFullPath(configured)
            }
            return Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.ApplicationData,
                    Environment.SpecialFolderOption.DoNotVerify
                ),
                "Gyroid",
                "settings.json"
            )
        }

        func DefaultData(network string) string -> Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData,
                Environment.SpecialFolderOption.DoNotVerify
            ),
            "Gyroid",
            network
        )

        func DefaultWallets(network string) string -> Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData,
                Environment.SpecialFolderOption.DoNotVerify
            ),
            "Gyroid",
            "wallets",
            network
        )

        private func ValidEndpoint(value string) bool ->
        Uri.TryCreate(value, UriKind.Absolute, out let endpoint) &&
            endpoint != nil &&
            endpoint.Scheme == "http" &&
            (endpoint.Host == "127.0.0.1" || endpoint.Host == "[::1]" || endpoint.Host == "::1") &&
            endpoint
            .UserInfo
            .Length == 0 &&
            endpoint
            .Query
            .Length == 0 &&
            endpoint
            .Fragment
            .Length == 0 &&
            endpoint.AbsolutePath == "/"

        private func ValidPath(value string) bool {
            try {
                return Path.IsPathFullyQualified(value) && Path.GetFullPath(value).Length > 0
            } catch (error ArgumentException) {
                return false
            } catch (error NotSupportedException) {
                return false
            } catch (error PathTooLongException) {
                return false
            }
        }

        func Read(settings AppSettings) bool {
            let path = ConfigurationPath()
            try {
                if File.Exists(path) {
                    using let json = JsonDocument.Parse(PrivateFiles.ReadText(path, 65536, true))
                    let root = json.RootElement
                    if root.ValueKind != JsonValueKind.Object {
                        throw JsonException()
                    }
                    settings.ActiveWallet = Text(root, "active_wallet")
                    settings.Network = Text(root, "network", "mainnet")
                    settings.Endpoint = Text(root, "endpoint", settings.Endpoint)
                    settings.DataDirectory = Text(root, "data_directory")
                    settings.WalletDirectory = Text(root, "wallet_directory")
                    settings.BinaryPath = Text(root, "binary_path")
                    settings.ListenAddress = Text(root, "listen_address", settings.ListenAddress)
                    settings.NodeMode = Text(root, "node_mode", "automatic")
                    settings.Language = Text(root, "language")
                    settings.Privacy = root.TryGetProperty("privacy", out let privacy) &&
                        privacy.ValueKind == JsonValueKind.True
                    if root.TryGetProperty("auto_lock_minutes", out let minutes) {
                        settings.AutoLockMinutes = if minutes.ValueKind == JsonValueKind.Number && minutes.TryGetInt32(
                            out let value
                        ) {
                            value
                        } else {
                            0
                        }
                    }
                    if settings.Network != "mainnet" && settings.Network != "testnet" {
                        settings.Network = "mainnet"
                    }
                    if settings.NodeMode != "automatic" && settings.NodeMode != "manual" {
                        settings.NodeMode = "automatic"
                    }
                    if settings.Language != "" && settings.Language != "en" && settings.Language != "zh-Hans" {
                        settings.Language = ""
                    }
                    if settings.AutoLockMinutes < 0 {
                        settings.AutoLockMinutes = 0
                    }
                    if !ValidEndpoint(settings.Endpoint) {
                        settings.Endpoint = ""
                    }
                    if !ValidPath(settings.DataDirectory) {
                        settings.DataDirectory = ""
                    }
                    if !ValidPath(settings.WalletDirectory) {
                        settings.WalletDirectory = ""
                    }
                    if !ValidPath(settings.BinaryPath) {
                        settings.BinaryPath = ""
                    }
                    if ListenError(settings.ListenAddress).Length > 0 {
                        settings.ListenAddress = "/ip4/127.0.0.1/tcp/0"
                    }
                }
            } catch (error Exception) {
                if !(error is IOException) &&
                    !(error is JsonException) &&
                    !(error is UnauthorizedAccessException) &&
                    !(error is InvalidOperationException) {
                    throw error
                }
                settings.LoadError = "Settings file is invalid. Save settings to replace it"
                return false
            }
            return true
        }

        private func Text(root JsonElement, key string, fallback string = "") string ->
        if root.TryGetProperty(key, out let value) && value.ValueKind == JsonValueKind.String {
            value.GetString() ?? fallback
        } else {
            fallback
        }

        private func WriteSetting(
            writer Utf8JsonWriter,
            stored JsonElement,
            key string,
            variable string,
            value string
        ) {
            if Environment.GetEnvironmentVariable(variable) == nil {
                writer.WriteString(key, value)
            } else if stored.ValueKind == JsonValueKind.Object && stored.TryGetProperty(key, out let kept) {
                writer.WritePropertyName(key)
                kept.WriteTo(writer)
            }
        }

        async func SaveAsync(settings AppSettings, ct CancellationToken, replaced AppSettings? = nil) {
            settings.Validate()
            if settings.LoadError.Length > 0 && replaced == nil {
                return
            }
            let path = ConfigurationPath()
            let directory = Path.GetDirectoryName(path) ??
                throw WalletException("Settings file must have a parent directory")
            Directory.CreateDirectory(directory)
            var text = "{}"
            try {
                if File.Exists(path) {
                    text = PrivateFiles.ReadText(path, 65536, true)
                    using let check = JsonDocument.Parse(text)
                }
            } catch (error JsonException) {
                text = "{}"
            }
            using let stored = JsonDocument.Parse(text)
            let root = stored.RootElement
            await PrivateFiles.WriteAtomic(
                path,
                async (stream) -> {
                    using let writer = Utf8JsonWriter(stream)
                    writer.WriteStartObject()
                    writer.WriteString("active_wallet", settings.ActiveWallet)
                    WriteSetting(writer, root, "network", "GYROID_NETWORK", settings.Network)
                    WriteSetting(writer, root, "endpoint", "GYROID_ENDPOINT", settings.Endpoint)
                    WriteSetting(writer, root, "data_directory", "GYROID_DATA_DIR", settings.DataDirectory)
                    WriteSetting(writer, root, "wallet_directory", "GYROID_WALLET_DIR", settings.WalletDirectory)
                    WriteSetting(writer, root, "binary_path", "GYROID_BINARY", settings.BinaryPath)
                    WriteSetting(writer, root, "listen_address", "GYROID_LISTEN", settings.ListenAddress)
                    WriteSetting(writer, root, "node_mode", "GYROID_NODE_MODE", settings.NodeMode)
                    writer.WriteString("language", settings.Language)
                    writer.WriteBoolean("privacy", settings.Privacy)
                    writer.WriteNumber("auto_lock_minutes", settings.AutoLockMinutes)
                    writer.WriteEndObject()
                    await writer.FlushAsync(ct)
                },
                true,
                false
            )
            settings.LoadError = ""
            if let previous = replaced {
                previous.LoadError = ""
            }
        }
    }
}
