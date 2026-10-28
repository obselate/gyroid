package Gyroid.View

import Goo
import System
import System.Reflection

partial class WalletView {
    private var tray TrayIcon?
    private var trayLockable bool
    private var hidden bool
    private var quitting bool

    shared {
        func Resource(name string)[]uint8 {
            using let stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
            if stream == nil {
                throw InvalidOperationException("Missing resource " + name)
            }
            let bytes = [int32(stream.Length)]uint8
            stream.ReadExactly(bytes, 0, bytes.Length)
            return bytes
        }
    }

    func Start() {
        guard let host = window else {
            return
        }
        wallet.EnableEvents()
        Run(wallet.ConnectAsync())
        refreshTimer = host.SetInterval(() -> Refresh(), 60000)
        UpdatePlayback()
        trayLockable = Lockable()
        tray = TrayIcon.Create(host, TraySettings()).Icon
        guard let icon = tray else {
            return
        }
        icon.Activated += () -> Restore()
        icon.CommandActivated += id -> {
            if id == "show" {
                Restore()
            } else if id == "lock" {
                Lock()
            } else if id == "quit" {
                Quit()
            }
        }
        icon.StatusChanged += status -> {
            if hidden && status != TrayStatus.Registered {
                Restore()
            }
        }
    }

    func Closing() bool {
        guard let host = window else {
            return true
        }
        if quitting {
            Close()
            return true
        }
        ClearSecrets()
        ClearSeed()
        ReleaseClipboard()
        if tray?.Status == TrayStatus.Registered {
            hidden = true
            host.Hide()
        } else {
            host.State = WindowState.Minimized
        }
        UpdatePlayback()
        Rebuild()
        return false
    }

    private func TraySettings() TrayOptions -> TrayOptions{
        Id: "dev.gyroid.wallet",
        Width: 64,
        Height: 64,
        Rgba: Resource("Gyroid.Tray.rgba"),
        Tooltip: strings.Get("Gyroid"),
        Menu: []NativeMenuItem{
            NativeMenuItem{Id: "show", Text: strings.Get("Show")},
            NativeMenuItem{Id: "lock", Text: strings.Get("Lock"), Enabled: trayLockable},
            NativeMenuItem{Separator: true},
            NativeMenuItem{Id: "quit", Text: strings.Get("Quit")}
        }
    }

    private func UpdateTray() {
        let lockable = Lockable()
        if let icon = tray {
            if lockable != trayLockable {
                trayLockable = lockable
                icon.Update(TraySettings())
            }
        }
    }

    func Restore() {
        hidden = false
        window?.Show(true)
        window?.RequestActivation()
        UpdatePlayback()
        Rebuild()
    }

    private func Lockable() bool -> wallet.Snapshot.State == "Unlocked" || wallet.Snapshot.State == "Unknown"

    private func Lock() {
        if !Lockable() {
            return
        }
        ClearSecrets()
        ClearSeed()
        ReleaseClipboard()
        Run(wallet.LockAsync())
    }

    private func Quit() {
        quitting = true
        window?.RequestClose()
    }
}
