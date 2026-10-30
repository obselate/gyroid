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
    var LockOnMinimize bool
    var LoadError string = ""
}
