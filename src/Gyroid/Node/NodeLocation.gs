package Gyroid.Node

import Gyroid.Platform
import Gyroid.Settings
import Gyroid.Wallet
import System

class NodeLocation {
    shared {
        func Load() WalletSettings {
            let settings = WalletSettings()
            SettingsStore.Read(settings)
            if settings.ActiveWallet.Length > 0 {
                try {
                    WalletValidation.ValidateFilename(settings.ActiveWallet)
                } catch (error WalletException) {
                    settings.ActiveWallet = ""
                }
            }
            Override(settings)
            settings.Validate()
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
