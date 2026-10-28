package Gyroid.Model

import Gyroid.Node
import Gyroid.Platform
import Gyroid.Services
import System
import System.Globalization
import System.IO
import System.Net
import System.Net.Sockets
import System.Runtime.InteropServices
import System.Text.Json
import System.Threading
import System.Threading.Tasks

class WalletSettings {
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
    var OwnedProcessId int32
    var DiscoveredDataDirectory string = ""
    var DiscoveredEndpoint string = ""
    var DiscoveredBinaryPath string = ""
    var DiscoveredWalletFile string = ""
    var LauncherBinaryPath string = ""
    var LoadError string = ""

    func Copy() WalletSettings -> WalletSettings{
        ActiveWallet: ActiveWallet,
        Network: Network,
        Endpoint: Endpoint,
        DataDirectory: DataDirectory,
        WalletDirectory: WalletDirectory,
        BinaryPath: BinaryPath,
        ListenAddress: ListenAddress,
        NodeMode: NodeMode,
        Language: Language,
        Privacy: Privacy,
        AutoLockMinutes: AutoLockMinutes,
        DiscoveredDataDirectory: DiscoveredDataDirectory,
        DiscoveredEndpoint: DiscoveredEndpoint,
        DiscoveredBinaryPath: DiscoveredBinaryPath,
        DiscoveredWalletFile: DiscoveredWalletFile,
        LauncherBinaryPath: LauncherBinaryPath,
        LoadError: LoadError
    }

    func StartupDiffers(other WalletSettings) bool ->
    Network != other.Network ||
        Endpoint != other.Endpoint ||
        DataDirectory != other.DataDirectory ||
        WalletDirectory != other.WalletDirectory ||
        BinaryPath != other.BinaryPath ||
        ListenAddress != other.ListenAddress

    func Validate() {
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
        if !Uri.TryCreate(Endpoint, UriKind.Absolute, out let endpoint) ||
            endpoint == nil ||
            endpoint.Scheme != "http" ||
            (endpoint.Host != "127.0.0.1" && endpoint.Host != "[::1]" && endpoint.Host != "::1") ||
            endpoint
            .UserInfo
            .Length > 0 ||
            endpoint
            .Query
            .Length > 0 ||
            endpoint
            .Fragment
            .Length > 0 ||
            endpoint.AbsolutePath != "/" {
            throw WalletException("API endpoint must be a loopback HTTP origin")
        }
        if !Path.IsPathFullyQualified(DataDirectory) || !Path.IsPathFullyQualified(WalletDirectory) {
            throw WalletException("Data and wallet directories must be absolute paths")
        }
        try {
            Path.GetFullPath(DataDirectory)
            Path.GetFullPath(WalletDirectory)
        } catch (error ArgumentException) {
            throw WalletException("Data and wallet directories must be valid absolute paths")
        } catch (error NotSupportedException) {
            throw WalletException("Data and wallet directories must be valid absolute paths")
        } catch (error PathTooLongException) {
            throw WalletException("Data and wallet directories must be valid absolute paths")
        }
        if BinaryPath.Length > 0 && !Path.IsPathFullyQualified(BinaryPath) {
            throw WalletException("Daemon binary must be an absolute path")
        }
        if ActiveWallet.Length > 0 {
            WalletValidation.ValidateFilename(ActiveWallet)
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

        func ProgramError(path string) string {
            if !File.Exists(path) {
                return "Node program not found"
            }
            try {
                CoreRelease.VerifyExecutable(path)
            } catch (error WalletException) {
                return error.Message
            } catch (error IOException) {
                return "Node program not found"
            } catch (error UnauthorizedAccessException) {
                return "Node program not found"
            }
            return ""
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

        func Discover(settings WalletSettings) {
            let network = settings.Network
            let cfg = Environment.GetEnvironmentVariable("BNT_CONFIG_DIR") ?? if OperatingSystem.IsWindows() {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "bnt")
            } else {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "bnt")
            }
            let platform = CoreRelease.Platform()
            let executable = "blocknet-core-" + platform + if OperatingSystem.IsWindows() {
                ".exe"
            } else {
                ""
            }
            let wrapper = Path.Combine(cfg, "cores", "v0.22.0", executable)
            var wrapped = false
            var data = DefaultData(network)
            var wallets = Path.Combine(data, "wallets")
            var endpoint = "http://127.0.0.1:" + if network == "testnet" {
                "18332/"
            } else {
                "8332/"
            }
            var binary = ""
            var active = ""
            if File.Exists(wrapper) {
                try {
                    CoreRelease.VerifyExecutable(wrapper)
                    binary = wrapper
                    settings.LauncherBinaryPath = wrapper
                    wrapped = true
                } catch (error WalletException) { }
            }
            if wrapped {
                data = Path.Combine(cfg, "data", network)
                wallets = Path.Combine(cfg, "wallets")
                let config = Path.Combine(cfg, "config.json")
                if File.Exists(config) {
                    using let json = JsonDocument.Parse(PrivateFiles.ReadText(config, 65536))
                    if json.RootElement.TryGetProperty("cores", out let cores) && cores.TryGetProperty(
                        network,
                        out let core
                    ) {
                        let configured = NodeJson.Text(core, "data_dir")
                        if Path.IsPathFullyQualified(configured) {
                            data = configured
                        }
                        let walletFile = NodeJson.Text(core, "wallet_file")
                        if Path.IsPathFullyQualified(walletFile) {
                            wallets = Path.GetDirectoryName(walletFile) ?? wallets
                            active = Path.GetFileName(walletFile)
                        }
                        let address = NodeJson.Text(core, "api_addr")
                        if address.Length > 0 {
                            endpoint = if address.StartsWith("http://", StringComparison.Ordinal) {
                                address
                            } else {
                                "http://" + address + "/"
                            }
                        }
                    }
                }
            }
            var installed = wrapped
            if binary.Length == 0 {
                let home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
                let local = Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData,
                    Environment.SpecialFolderOption.DoNotVerify
                )
                let candidates = if OperatingSystem.IsLinux() {
                    []string{
                        "/usr/lib/blocknet/binaries/blocknet-" + platform,
                        "/var/lib/flatpak/app/com.blocknet.wallet/current/active/files/bin/binaries/blocknet-" +
                            platform,
                        Path.Combine(
                            home,
                            ".local/share/flatpak/app/com.blocknet.wallet/current/active/files/bin/binaries/blocknet-" +
                                platform
                        )
                    }
                } else if OperatingSystem.IsMacOS() {
                    []string{
                        "/Applications/blocknet.app/Contents/Resources/binaries/blocknet-" +
                            if RuntimeInformation.ProcessArchitecture == Architecture.Arm64 {
                            "aarch64-apple-darwin"
                        } else {
                            "x86_64-apple-darwin"
                        }
                    }
                } else {
                    []string{
                        Path.Combine(local, "blocknet", "binaries", "blocknet-amd64-windows.exe"),
                        Path.Combine(local, "blocknet", "blocknet-amd64-windows.exe"),
                        Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                            "blocknet",
                            "binaries",
                            "blocknet-amd64-windows.exe"
                        ),
                        Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                            "blocknet",
                            "blocknet-amd64-windows.exe"
                        )
                    }
                }
                for candidate in candidates {
                    if File.Exists(candidate) {
                        try {
                            CoreRelease.VerifyExecutable(candidate)
                        } catch (error WalletException) {
                            continue
                        }
                        binary = candidate
                        break
                    }
                }
                if binary.Length > 0 && network == "mainnet" {
                    installed = true
                    if settings.Endpoint.Length > 0 {
                        endpoint = settings.Endpoint
                    }
                    let application = if OperatingSystem.IsMacOS() {
                        Path.Combine(home, "Library", "Application Support", "com.blocknet.wallet")
                    } else if OperatingSystem.IsWindows() {
                        Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                            "com.blocknet.wallet"
                        )
                    } else if binary.Contains("/flatpak/") {
                        Path.Combine(home, ".var", "app", "com.blocknet.wallet", "data", "com.blocknet.wallet")
                    } else {
                        Path.Combine(local, "com.blocknet.wallet")
                    }
                    data = Path.Combine(application, "data")
                    wallets = application
                    let selection = Path.Combine(application, "active_wallet")
                    active = if File.Exists(selection) {
                        PrivateFiles.ReadText(selection, 1024).Trim()
                    } else {
                        "wallet.dat"
                    }
                    let configuration = Path.Combine(data, "settings.json")
                    if File.Exists(configuration) {
                        using let json = JsonDocument.Parse(PrivateFiles.ReadText(configuration, 65536))
                        let walletFile = NodeJson.Text(json.RootElement, "wallet_file")
                        if Path.IsPathFullyQualified(walletFile) {
                            wallets = Path.GetDirectoryName(walletFile) ?? wallets
                            active = Path.GetFileName(walletFile)
                        }
                    }
                }
                if binary.Length == 0 {
                    for candidate in[]string{
                        Path.Combine(DefaultData(network), executable),
                        CoreRelease.InstallationPath()
                    } {
                        if File.Exists(candidate) {
                            try {
                                CoreRelease.VerifyExecutable(candidate)
                            } catch (error WalletException) {
                                continue
                            }
                            binary = candidate
                            break
                        }
                    }
                }
            }
            if settings.DataDirectory.Length == 0 {
                settings.DataDirectory = data
            }
            if installed {
                settings.DiscoveredDataDirectory = data
                settings.DiscoveredEndpoint = endpoint
                settings.DiscoveredBinaryPath = binary
                settings.DiscoveredWalletFile = Path.Combine(
                    wallets,
                    if active.Length > 0 {
                        active
                    } else {
                        "default.wallet.dat"
                    }
                )
            }
            if settings.WalletDirectory.Length == 0 {
                settings.WalletDirectory = if settings.DataDirectory == data {
                    wallets
                } else {
                    Path.Combine(settings.DataDirectory, "wallets")
                }
            }
            if settings.ActiveWallet.Length == 0 && settings.WalletDirectory == wallets {
                settings.ActiveWallet = active
            }
            if settings.Endpoint.Length == 0 {
                settings.Endpoint = endpoint
            }
            if settings.BinaryPath.Length == 0 {
                settings.BinaryPath = binary
            }
        }

        func Load() WalletSettings {
            var settings = WalletSettings()
            let path = ConfigurationPath()
            try {
                if File.Exists(path) {
                    using let json = JsonDocument.Parse(PrivateFiles.ReadText(path, 65536, true))
                    let root = json.RootElement
                    settings.ActiveWallet = NodeJson.Text(root, "active_wallet")
                    settings.Network = NodeJson.Text(root, "network", "mainnet")
                    settings.Endpoint = NodeJson.Text(root, "endpoint", settings.Endpoint)
                    settings.DataDirectory = NodeJson.Text(root, "data_directory")
                    settings.WalletDirectory = NodeJson.Text(root, "wallet_directory")
                    settings.BinaryPath = NodeJson.Text(root, "binary_path")
                    settings.ListenAddress = NodeJson.Text(root, "listen_address", settings.ListenAddress)
                    settings.NodeMode = NodeJson.Text(root, "node_mode", "automatic")
                    settings.Language = NodeJson.Text(root, "language")
                    settings.Privacy = NodeJson.Flag(root, "privacy")
                    if root.TryGetProperty("auto_lock_minutes", out let minutes) {
                        settings.AutoLockMinutes = if minutes.ValueKind == JsonValueKind.Number && minutes.TryGetInt32(
                            out let value
                        ) {
                            value
                        } else {
                            -1
                        }
                    }
                }
            } catch (error Exception) {
                if !(error is IOException) &&
                    !(error is JsonException) &&
                    !(error is UnauthorizedAccessException) &&
                    !(error is InvalidOperationException) {
                    throw error
                }
                settings = WalletSettings()
            }
            Override(settings)
            try {
                settings.Validate()
            } catch (error WalletException) {
                settings = WalletSettings{LoadError: error.Message}
                Override(settings)
                settings.Validate()
            }
            return settings
        }

        private func Override(settings WalletSettings) {
            settings.Network = Environment.GetEnvironmentVariable("GYROID_NETWORK") ?? settings.Network
            settings.Endpoint = Environment.GetEnvironmentVariable("GYROID_ENDPOINT") ?? settings.Endpoint
            settings.DataDirectory = Environment.GetEnvironmentVariable("GYROID_DATA_DIR") ?? settings.DataDirectory
            settings.WalletDirectory = Environment.GetEnvironmentVariable("GYROID_WALLET_DIR") ??
                settings.WalletDirectory
            settings.BinaryPath = Environment.GetEnvironmentVariable("GYROID_BINARY") ?? settings.BinaryPath
            Discover(settings)
            settings.ListenAddress = Environment.GetEnvironmentVariable("GYROID_LISTEN") ?? settings.ListenAddress
            settings.NodeMode = Environment.GetEnvironmentVariable("GYROID_NODE_MODE") ?? settings.NodeMode
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

        async func SaveAsync(settings WalletSettings, ct CancellationToken) {
            settings.Validate()
            if settings.LoadError.Length > 0 {
                return
            }
            let path = ConfigurationPath()
            let directory = Path.GetDirectoryName(path) ??
                throw WalletException("Settings file must have a parent directory")
            Directory.CreateDirectory(directory)
            let temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp"
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
            try {
                using let stream = PrivateFiles.CreatePrivate(temporary)
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
                writer.Dispose()
                stream.Flush(true)
                stream.Dispose()
                File.Move(temporary, path, true)
            } finally {
                if File.Exists(temporary) {
                    File.Delete(temporary)
                }
            }
        }
    }
}
