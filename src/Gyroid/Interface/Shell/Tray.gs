package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Linq
import System.Numerics
import System.Text
import System.Threading.Tasks

partial class WalletView {
    private var tray TrayIcon?

    private var trayLockable bool

    private var hidden bool

    private var quitting bool

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
        Rgba: Resources.Resource("Gyroid.Tray.rgba"),
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

    func Quit() {
        quitting = true
        window?.RequestClose()
    }

    private let appIcon ImageSource
}
