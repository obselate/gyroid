package Gyroid.Models

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
    var Background string = "glyphs"
    var ReduceMotion bool
    var UiScalePercent int32 = 100
    var StartInTray bool
    var BackgroundLockMinutes int32
    var LoadError string = ""
    shared {
        func WalletBasename(filename string) string {
            let suffix = filename.EndsWith(".wallet.dat", System.StringComparison.Ordinal) ? 11:
            filename.EndsWith(".dat", System.StringComparison.Ordinal) ? 4: 0
            return filename.Substring(0, filename.Length - suffix)
        }
    }
}
