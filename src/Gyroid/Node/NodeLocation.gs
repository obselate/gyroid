package Gyroid.Node

import Gyroid.Platform
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.IO
import System.Threading
import System.Threading.Tasks

class WalletSettings : AppSettings {
    var OwnedProcessId int32
    var DiscoveredDataDirectory string = ""
    var DiscoveredEndpoint string = ""
    var DiscoveredBinaryPath string = ""
    var DiscoveredWalletFile string = ""
    var LauncherBinaryPath string = ""
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

    override func Validate() {
        base.Validate()
        if ActiveWallet.Length > 0 {
            WalletValidation.ValidateFilename(ActiveWallet)
        }
    }

    shared {
        func Load() WalletSettings {
            var settings = WalletSettings()
            if !AppSettings.Read(settings) {
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
            NodeDiscovery.Discover(settings)
            settings.ListenAddress = Environment.GetEnvironmentVariable("GYROID_LISTEN") ?? settings.ListenAddress
            settings.NodeMode = Environment.GetEnvironmentVariable("GYROID_NODE_MODE") ?? settings.NodeMode
        }
    }
}
