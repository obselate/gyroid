package Gyroid.Views

import Goo
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Models
import Gyroid.Services
import System
import System.Linq

partial class App {
    private var tray TrayIcon?

    private var trayLockable bool

    private var hidden bool

    private var quitting bool

    func Start() {
        guard let host = window else {
            return
        }
        wallet.EnableEvents()
        Run(ct -> wallet.ConnectAsync(ct))
        refreshTimer = host.SetInterval(() -> Refresh(wallet.State == WalletState.Unlocked), 60000)
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
        var conceal = wallet.Settings.StartInTray
        let registered Action[TrayStatus] = status -> {
            if hidden && status != TrayStatus.Registered {
                Restore()
            } else if conceal && status == TrayStatus.Registered {
                conceal = false
                hidden = true
                host.Hide()
                UpdatePlayback()
            }
        }
        icon.StatusChanged += registered
        registered(icon.Status)
    }

    func Closing() bool {
        guard let host = window else {
            return true
        }
        if quitting {
            Close()
            return true
        }
        upgradeShown = false
        ClearSeed()
        ui.Actions.ReleaseClipboard()
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
        Rgba: Resources.Resource("Gyroid.Tray.rgba"),
        Tooltip: ui.Strings.Get("Gyroid"),
        Menu: []NativeMenuItem{
            NativeMenuItem{Id: "show", Text: ui.Strings.Get("Show")},
            NativeMenuItem{Id: "lock", Text: ui.Strings.Get("Lock"), Enabled: trayLockable},
            NativeMenuItem{Separator: true},
            NativeMenuItem{Id: "quit", Text: ui.Strings.Get("Quit")}
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

    private func Lockable() bool -> wallet
        .Snapshot
        .State == WalletState.Unlocked ||
        wallet
        .Snapshot
        .State == WalletState.Unknown

    private func Lock() {
        if !Lockable() {
            return
        }
        upgradeShown = false
        ClearSeed()
        ui.Actions.ReleaseClipboard()
        Run(ct -> wallet.LockAsync(ct))
    }

    func Quit() {
        quitting = true
        window?.RequestClose()
    }

    private let appIcon ImageSource
}
