package Gyroid.Models

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
        Background: Background,
        ReduceMotion: ReduceMotion,
        UiScalePercent: UiScalePercent,
        StartInTray: StartInTray,
        BackgroundLockMinutes: BackgroundLockMinutes,
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
}

data struct SettingsChainResult {
    var Size int64
    var Wallets int32
    var Free int64
    var Trusted uint64
    var Local uint64
    var AutoSave bool?
}
