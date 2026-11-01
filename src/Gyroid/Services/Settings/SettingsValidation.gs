package Gyroid.Services

import Gyroid.Models
import System
import System.Globalization
import System.IO
import System.Net
import System.Net.Sockets

class SettingsValidation {
    shared {
        func Prepare(value WalletSettings, current WalletSettings) WalletSettings {
            let next = current.Copy()
            next.Network = value.Network
            next.Endpoint = value.Endpoint
            next.DataDirectory = value.DataDirectory
            next.WalletDirectory = value.WalletDirectory
            next.BinaryPath = value.BinaryPath
            next.ListenAddress = value.ListenAddress
            if next.Network != current.Network {
                if next.DataDirectory == current.DataDirectory &&
                    (
                    next.DataDirectory == SettingsStore.DefaultData(current.Network) ||
                        next.DataDirectory == current.DiscoveredDataDirectory
                ) {
                    next.DataDirectory = ""
                    next.WalletDirectory = ""
                }
                if next.Endpoint == current.Endpoint {
                    next.Endpoint = ""
                }
                if next.BinaryPath == current.BinaryPath &&
                    (next.BinaryPath == current.DiscoveredBinaryPath || next.BinaryPath == current.LauncherBinaryPath) {
                    next.BinaryPath = ""
                }
                next.ActiveWallet = ""
                next.DiscoveredDataDirectory = ""
                next.DiscoveredEndpoint = ""
                next.DiscoveredBinaryPath = ""
                next.DiscoveredWalletFile = ""
                next.LauncherBinaryPath = ""
                NodeDiscovery.Discover(next)
            }
            Validate(next)
            if next.BinaryPath != current.BinaryPath && next.BinaryPath.Length > 0 {
                let issue = NodeDiscovery.ProgramError(next.BinaryPath)
                if issue.Length > 0 {
                    throw WalletException(issue)
                }
            }
            if next.Network != current.Network && Path.GetFullPath(next.DataDirectory) == Path.GetFullPath(
                current.DataDirectory
            ) {
                throw WalletException("Choose a separate data directory when changing network")
            }
            return next
        }

        func Validate(settings AppSettings) {
            if settings.Network != "mainnet" && settings.Network != "testnet" {
                throw WalletException("Network must be mainnet or testnet")
            }
            if settings.NodeMode != "automatic" && settings.NodeMode != "manual" {
                throw WalletException("Node mode must be automatic or manual")
            }
            if settings.Language != "" && settings.Language != "en" && settings.Language != "zh-Hans" {
                throw WalletException("Language must be en or zh-Hans")
            }
            if settings.AutoLockMinutes < 0 {
                throw WalletException("Auto-lock minutes must be zero or greater")
            }
            if settings.BackgroundLockMinutes < 0 {
                throw WalletException("Background lock minutes must be zero or greater")
            }
            if settings.Background != "gyroid" && settings.Background != "glyphs" && settings.Background != "off" {
                throw WalletException("Background must be gyroid, glyphs or off")
            }
            if settings.UiScalePercent < 100 || settings.UiScalePercent > 200 || settings.UiScalePercent % 25 != 0 {
                throw WalletException("UI scale must be 100, 125, 150, 175 or 200 percent")
            }
            if !ValidEndpoint(settings.Endpoint) {
                throw WalletException("API endpoint must be a loopback HTTP origin")
            }
            if !ValidPath(settings.DataDirectory) || !ValidPath(settings.WalletDirectory) {
                throw WalletException("Data and wallet directories must be valid absolute paths")
            }
            if settings.BinaryPath.Length > 0 && !ValidPath(settings.BinaryPath) {
                throw WalletException("Daemon binary must be an absolute path")
            }
            let listen = ListenError(settings.ListenAddress)
            if listen.Length > 0 {
                throw WalletException(listen)
            }
            if settings is WalletSettings && settings.ActiveWallet.Length > 0 {
                WalletValidation.ValidateFilename(settings.ActiveWallet)
            }
        }

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

        func ValidEndpoint(value string) bool ->
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

        func ValidPath(value string) bool {
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
    }
}
