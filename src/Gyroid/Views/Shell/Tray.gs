package Gyroid.Views

import Goo
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Globalization
import System.Linq

partial class App {
    private var tray TrayIcon?

    private var trayLockable bool
    private var trayLanguage string = ""
    private var trayStatus string = ""
    private var trayBalance string = ""

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
        UpdateTray()
        tray = TrayIcon.Create(host, TraySettings()).Icon
        guard let icon = tray else {
            return
        }
        icon.Activated += () -> Restore()
        icon.CommandActivated += id -> {
            if id == "show" || id == "unlock" {
                if id == "unlock" {
                    screen = AppPage.None
                }
                Restore()
            } else if id == "lock" {
                Lock()
            } else if id == "quit" {
                Quit()
            } else {
                let page = switch id {
                    case "send": AppPage.Send
                    case "receive": AppPage.Receive
                    case "messages": AppPage.Messages
                    case "history": AppPage.Transactions
                    default: AppPage.None
                }
                if page != AppPage.None {
                    pendingPayment = nil
                    pendingPage = page
                    screen = AppPage.None
                    ApplyNavigation()
                    Restore()
                }
            }
        }
        var conceal = wallet.Settings.StartInTray && !paymentActivated
        let registered Action[TrayStatus] = status -> {
            if hidden && status != TrayStatus.Registered {
                Restore()
            } else if conceal && !paymentActivated && status == TrayStatus.Registered {
                conceal = false
                hidden = true
                host.Hide()
                UpdateBackgroundLock()
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
        UpdateBackgroundLock()
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
        Menu: TrayMenu()
    }

    private func TrayMenu()[]NativeMenuItem {
        let items = List[NativeMenuItem](13)
        items.Add(NativeMenuItem{Id: "show", Text: ui.Strings.Get("Show")})
        items.Add(NativeMenuItem{Separator: true})
        items.Add(NativeMenuItem{Id: "status", Text: trayStatus, Enabled: false})
        if trayBalance.Length > 0 {
            items.Add(NativeMenuItem{Id: "balance", Text: trayBalance, Enabled: false})
        }
        items.Add(NativeMenuItem{Separator: true})
        items.Add(NativeMenuItem{Id: "send", Text: ui.Strings.Get("Send")})
        items.Add(NativeMenuItem{Id: "receive", Text: ui.Strings.Get("Receive")})
        items.Add(NativeMenuItem{Id: "messages", Text: ui.Strings.Get("Messages")})
        items.Add(NativeMenuItem{Id: "history", Text: ui.Strings.Get("History")})
        items.Add(NativeMenuItem{Separator: true})
        items.Add(
            NativeMenuItem{Id: trayLockable ? "lock": "unlock", Text: ui.Strings.Get(trayLockable ? "Lock": "Unlock")}
        )
        items.Add(NativeMenuItem{Separator: true})
        items.Add(NativeMenuItem{Id: "quit", Text: ui.Strings.Get("Quit")})
        return items.ToArray()
    }

    private func TrayStatusText() string {
        let status = wallet.Node.Status
        if Phase() != NodePhase.None {
            return PhaseText()
        }
        if !status.Running {
            return ui.Strings.Get("offline")
        }
        if status.Syncing {
            let percent = PhasePercent()
            return ui.Strings.Get("syncing") + (percent == nil ? "": " " + percent.ToString() + "%")
        }
        return ui.Strings.Get("Synced") + " · " + ui.Strings.Get("block") + " " + Count(status.Height) + " · " +
            status.Peers.ToString() + " " + ui.Strings.Get(status.Peers == 1 ? "peer": "peers")
    }

    private func UpdateTray() {
        let lockable = Lockable()
        let status = TrayStatusText()
        let balance = if wallet.Snapshot.State == WalletState.Unlocked && !ui.Privacy {
            if let value = wallet.Snapshot.Balance?.Spendable {
                ui.Strings.Get("Spendable") + ": " + (value / 100000000).ToString(CultureInfo.InvariantCulture) + "." +
                    (value % 100000000 / 10000).ToString("D4", CultureInfo.InvariantCulture) + " BNT"
            } else {
                ""
            }
        } else {
            ""
        }
        let language = ui.Strings.Language
        if lockable == trayLockable && status == trayStatus && balance == trayBalance && language == trayLanguage {
            return
        }
        trayLockable = lockable
        trayStatus = status
        trayBalance = balance
        trayLanguage = language
        tray?.Update(TraySettings())
    }

    func Restore() {
        hidden = false
        window?.Show(true)
        window?.RequestActivation()
        UpdateBackgroundLock()
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
