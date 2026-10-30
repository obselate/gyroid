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

class SettingsStore {
    shared {
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
                    settings.Privacy = Flag(root, "privacy")
                    if root.TryGetProperty("auto_lock_minutes", out let minutes) {
                        settings.AutoLockMinutes = if minutes.ValueKind == JsonValueKind.Number && minutes.TryGetInt32(
                            out let value
                        ) {
                            value
                        } else {
                            0
                        }
                    }
                    settings.Background = Text(root, "background", "glyphs")
                    settings.ReduceMotion = Flag(root, "reduce_motion")
                    if root.TryGetProperty("ui_scale_percent", out let scale) &&
                        scale.ValueKind == JsonValueKind.Number &&
                        scale.TryGetInt32(out let percent) && percent >= 100 && percent <= 200 && percent % 25 == 0 {
                        settings.UiScalePercent = percent
                    }
                    settings.StartInTray = Flag(root, "start_in_tray")
                    settings.LockOnMinimize = Flag(root, "lock_on_minimize")
                    if settings.Network != "mainnet" && settings.Network != "testnet" {
                        settings.Network = "mainnet"
                    }
                    if settings.NodeMode != "automatic" && settings.NodeMode != "manual" {
                        settings.NodeMode = "automatic"
                    }
                    if settings.Language != "" && settings.Language != "en" && settings.Language != "zh-Hans" {
                        settings.Language = ""
                    }
                    if settings.Background != "gyroid" && settings.Background != "off" {
                        settings.Background = "glyphs"
                    }
                    if settings.AutoLockMinutes < 0 {
                        settings.AutoLockMinutes = 0
                    }
                    if !AppSettings.ValidEndpoint(settings.Endpoint) {
                        settings.Endpoint = ""
                    }
                    if !AppSettings.ValidPath(settings.DataDirectory) {
                        settings.DataDirectory = ""
                    }
                    if !AppSettings.ValidPath(settings.WalletDirectory) {
                        settings.WalletDirectory = ""
                    }
                    if !AppSettings.ValidPath(settings.BinaryPath) {
                        settings.BinaryPath = ""
                    }
                    if AppSettings.ListenError(settings.ListenAddress).Length > 0 {
                        settings.ListenAddress = "/ip4/127.0.0.1/tcp/0"
                    }
                }
            } catch (error Exception) {
                if !(error is IOException) &&
                    !(error is JsonException) &&
                    !(error is UnauthorizedAccessException) &&
                    !(error is InvalidOperationException) &&
                    !(error is WalletException) &&
                    !(error is ArgumentException) {
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

        private func Flag(root JsonElement, key string) bool ->
        root.TryGetProperty(key, out let value) && value.ValueKind == JsonValueKind.True

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
                    writer.WriteString("background", settings.Background)
                    writer.WriteBoolean("reduce_motion", settings.ReduceMotion)
                    writer.WriteNumber("ui_scale_percent", settings.UiScalePercent)
                    writer.WriteBoolean("start_in_tray", settings.StartInTray)
                    writer.WriteBoolean("lock_on_minimize", settings.LockOnMinimize)
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
