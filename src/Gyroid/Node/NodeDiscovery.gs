package Gyroid.Node

import Gyroid.Platform
import Gyroid.Settings
import System
import System.IO
import System.Linq
import System.Runtime.InteropServices
import System.Text.Json

class NodeDiscovery {
    shared {
        func Discover(settings WalletSettings) {
            let network = settings.Network
            let cfg = Environment.GetEnvironmentVariable("BNT_CONFIG_DIR") ?? if OperatingSystem.IsWindows() {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "bnt")
            } else {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "bnt")
            }
            let platform = CoreRelease.Platform()
            let executable = CoreRelease.ExecutableName()
            let wrapper = Path.Combine(cfg, "cores", "v" + CoreRelease.Version, executable)
            var wrapped = false
            var data = AppSettings.DefaultData(network)
            var wallets = AppSettings.DefaultWallets(network)
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
                        Path.Combine(AppSettings.DefaultData(network), executable),
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
                let legacy = Path.Combine(settings.DataDirectory, "wallets")
                settings.WalletDirectory = if installed && settings.DataDirectory == data {
                    wallets
                } else if Directory.Exists(legacy) && Directory.EnumerateFiles(legacy, "*.dat").Any() {
                    legacy
                } else {
                    AppSettings.DefaultWallets(network)
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
    }
}
