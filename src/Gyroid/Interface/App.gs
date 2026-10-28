package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Data
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Contacts
import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Send
import Gyroid.Settings
import Gyroid.Wallet
import Net.Codecrete.QrCodeGenerator
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.IO
import System.Linq
import System.Numerics
import System.Text
import System.Threading.Tasks

partial class App : Cell {
    private let sendDone Action

    private let chooseFile Action[FileDialogKind, string, string, Action[string]]

    private let receiveRequest ReceiveRequest = ReceiveRequest()

    private let miningHistory MiningHistory = MiningHistory()
    private let toolsState ToolsState = ToolsState()

    private let togglePrivacy Action

    private let openNodeSettings Action

    private let wallet WalletSession

    private let ui Presentation

    private let openReceive Action

    private var window Window?

    private var width float64 = 1280

    private var height float64 = 800

    private var pixelScale float64 = 1

    private var screen string = ""

    private var lastPage string = ""

    private var error string = ""

    private var bannerHeight float64

    private var refreshing bool

    private var refreshError string = ""

    private var refreshTimer WindowTimer?

    private var statusTimer WindowTimer?

    private let navigate Action[string]

    private var shownHeight string = ""

    private var seedFromWallet bool

    private var shownState string = ""

    private var clears int32

    private var seed[]?char

    private var contacts SortedDictionary[string, string] = SortedDictionary[string, string](StringComparer.Ordinal)

    private let finishSeed Action

    private let contactsChanged Action[SortedDictionary[string, string]]
    private var settingsSection string = "general"

    private let selectSection Action[string]

    private let setLanguage Action[string]

    private let preferenceChanged Action

    private let revealSeed Action[[]char]

    private let closeSettings Action

    init(wallet WalletSession) {
        this.wallet = wallet
        ui = Presentation(
            wallet.Settings.Language,
            wallet.Settings.Privacy,
            () -> Rebuild(),
            PlaybackActive,
            Touch,
            message -> {
                error = message
            },
            (task, done, secret, extra) -> Run(task, done, secret, extra)
        )
        navigate = target -> Navigate(target)
        togglePrivacy = () -> TogglePrivacy()
        openNodeSettings = () -> {
            settingsSection = "node"
            Navigate("Settings")
        }
        showUpgrade = () -> {
            upgradeShown = true
            Rebuild()
        }
        sendDone = () -> Refresh()
        chooseFile = (kind, title, path, chosen) -> ChooseFile(kind, title, path, chosen)
        openReceive = () -> Navigate("Receive")
        finishSeed = () -> FinishSeed()
        contactsChanged = next -> {
            contacts = next
        }
        selectSection = section -> {
            settingsSection = section
            Rebuild()
        }
        setLanguage = language -> SetLanguage(language)
        preferenceChanged = () -> {
            ApplyPreferences()
            UpdatePlayback()
            Rebuild()
        }
        revealSeed = buffer -> {
            seedFromWallet = true
            Run(wallet.Keys.RevealSeedAsync(buffer), nil, buffer)
        }
        closeSettings = () -> {
            screen = ""
            ui.Decode("page")
            Rebuild()
        }
        ApplyPreferences()
        nodeAnchor.MetricsChanged += _ -> {
            if nodeOpen {
                Rebuild()
            }
        }
        background = ShaderEffect(ShaderEffectProgram(Resources.Resource("Gyroid.Background.goo-effect")))
        appIcon = ImageSource.Decode(Resources.Resource("Gyroid.Icon.png"))
        LoadContacts()
    }

    func Attach(owner Window) {
        window = owner
        ui.Attach(owner)
        Resize(owner)
        owner.MetricsChanged += metrics -> {
            pixelScale = metrics.DisplayScaleX * metrics.UiScale
            Resize(owner)
            Rebuild()
        }
        owner.StateChanged += _ -> {
            if owner.State == WindowState.Minimized && wallet.Settings.LockOnMinimize {
                Lock()
            }
            UpdatePlayback()
            Rebuild()
        }
        owner.FocusChanged += focused -> {
            if focused {
                lastActivity = Stopwatch.GetTimestamp()
            }
            UpdatePlayback()
            Rebuild()
        }
        owner.VisibilityChanged += _ -> {
            UpdatePlayback()
            Rebuild()
        }
        owner.PreviewKeyPressed += (key Key, modifiers KeyModifiers) -> {
            Touch()
            return false
        }
        wallet.Changed = () -> owner.Post(() -> Sync())
        lastPage = wallet.Snapshot.Page
        Tick()
    }

    private func Close() {
        tray?.Dispose()
        tray = nil
        refreshTimer?.Dispose()
        statusTimer?.Dispose()
        ui.DecodeTimer?.Dispose()
        ui.DecodeTimer = nil
        frameTimer?.Dispose()
        frameTimer = nil
        ui.ReleaseClipboard()
        ClearSecrets()
        ClearSeed()
        wallet.Changed = nil
    }

    private func Touch() {
        wallet.Touch()
        ResumePlayback()
    }

    private func Resize(owner Window) {
        width = owner.Width / owner.UiScale
        height = owner.Height / owner.UiScale
    }

    private func Fingerprint(snapshot WalletSnapshot) string {
        let node = wallet.Node.Status
        let text = StringBuilder(
            "${snapshot.Page} ${snapshot.State} ${snapshot.Connected} ${snapshot.ViewOnly} ${snapshot.Address} ${snapshot.HistoryTotal} ${wallet.Send.Pending?.Retryable} ${wallet.Send.Pending?.State} ${wallet.LockQueued} ${wallet.Node.Status.Progress} ${node.Source} ${node.Owned} ${node.Running} ${node.Height} ${node.ChainHeight} ${node.Syncing} ${node.SyncProgress} ${node.Phase} ${node.Peers} ${node.Mempool} ${node.LastBlockTime} ${node.Endpoint} ${node.DataDirectory}"
        )
        if let value = snapshot.Balance {
            text.Append(
                " ${value.Scanning} ${value.ScanHeight} ${value.ChainHeight} ${value.Balance} ${value.Spendable} ${value.Pending} ${value.Outputs} ${value.MemoErrors}"
            )
        }
        for output in snapshot.History {
            text.Append(
                " ${output.TxId}:${output.OutputIndex} ${output.Amount} ${output.BlockHeight} ${output.Spent} ${output.Memo}"
            )
        }
        for send in snapshot.Sends {
            text.Append(
                " ${send.TxId} ${send.Status} ${send.Confirmations} ${send.Timestamp} ${send.Amount} ${send.Fee}"
            )
            for recipient in send.Recipients {
                text.Append(" ${recipient.Address} ${recipient.Memo}")
            }
        }
        return text.ToString()
    }

    private func Sync() {
        let snapshot = wallet.Snapshot
        let seeded = snapshot.Page == "Seed" && TakeSeed()
        let state = Fingerprint(snapshot)
        if !seeded && state == shownState {
            return
        }
        if snapshot.State != "Unlocked" {
            ClearSeed()
            toolsState.Report = nil
        }
        shownState = state
        let node = wallet.Node.Status
        if node.Syncing || node.Running && node.Peers == 0 {
            statusTimer ??= window?.SetInterval(() -> Refresh(true), 1000)
        } else {
            statusTimer?.Dispose()
            statusTimer = nil
        }
        let page = snapshot.Page
        if page != lastPage {
            ResumePlayback()
            ClearSecrets()
            if lastPage == "Seed" {
                ClearSeed()
            }
            if !seedFromWallet || page != "Seed" && page != "Wallet" {
                screen = ""
                ui.Decode("page")
            }
            lastPage = page
            seedFromWallet = seedFromWallet && page == "Seed"
        }
        let heights = if let value = snapshot.Balance {
            value.ScanHeight.ToString() + " " + value.ChainHeight.ToString()
        } else {
            ""
        }
        if heights != shownHeight {
            shownHeight = heights
            ui.Decode("sync")
        }
        UpdateTray()
        Rebuild()
    }

    private func ClearSecrets() {
        clears++
        upgradeShown = false
    }

    private func TakeSeed() bool {
        guard let words = wallet.Keys.TakePendingSeed() else {
            return false
        }
        ClearSeed()
        seed = words
        return true
    }

    private func ClearSeed() {
        ui.ReleaseClipboard()
        if let words = seed {
            Array.Clear(words)
        }
        seed = nil
    }

    private func FinishSeed() {
        ClearSeed()
        wallet.Keys.ContinueFromSeed()
    }

    private func LoadContacts() {
        try {
            contacts = AddressBook.ReadContacts(message -> error = message)
        } catch (failure WalletException) {
            error = failure.Message
        }
    }

    private func Open(target string) {
        ClearSecrets()
        error = ""
        screen = target
        if target == "Contacts" {
            LoadContacts()
        }
        ui.Decode("page")
        Rebuild()
    }

    private func Back() {
        ClearSecrets()
        error = ""
        screen = ""
        ui.Decode("page")
        Rebuild()
    }

    private func Run(task Task, done Action? = nil, secret[]?char = nil, extra[]?char = nil) {
        ui.Operations++
        error = ""
        Rebuild()
        Complete(task, done, secret, extra)
    }

    private async func Complete(task Task, done Action?, secret[]?char, extra[]?char) {
        var message = ""
        var unknown = false
        try {
            await task
        } catch (failure WalletException) {
            message = failure.Message
            unknown = failure.OutcomeUnknown
        } catch (failure IOException) {
            message = failure.Message
        } catch (failure UnauthorizedAccessException) {
            message = failure.Message
        } catch (failure Exception) {
            message = "Operation failed"
        } finally {
            if let buffer = secret {
                Array.Clear(buffer)
            }
            if let buffer = extra {
                Array.Clear(buffer)
            }
        }
        window?.TryPost(
            () -> {
                ui.Operations--
                if unknown {
                    screen = if wallet.Snapshot.State == "Unlocked" {
                        "Send"
                    } else {
                        ""
                    }
                    Refresh()
                } else {
                    error = message
                }
                if message == "" {
                    done?.Invoke()
                }
                Sync()
                Rebuild()
            }
        )
    }

    private async func Refresh(statusOnly bool = false) {
        if refreshing || ui.Working() || wallet.Busy {
            return
        }
        refreshing = true
        var message = ""
        try {
            await Task.Run(
                () -> if statusOnly {
                    wallet.RefreshStatusAsync()
                } else if wallet.Snapshot.State == "Unlocked" {
                    wallet.RefreshAsync()
                } else {
                    wallet.RefreshNodeAsync()
                }
            )
        } catch (failure WalletException) {
            message = failure.Message
        } catch (failure Exception) {
            message = "Refresh failed"
        }
        window?.TryPost(
            () -> {
                refreshing = false
                if message != refreshError {
                    refreshError = message
                    Rebuild()
                }
                Sync()
            }
        )
    }

    private async func ChooseFile(kind FileDialogKind, title string, initialPath string, chosen Action[string]) {
        guard let host = window else {
            return
        }
        var message = ""
        var path = ""
        try {
            let result = await host.ShowFileDialogAsync(
                kind,
                FileDialogOptions{Title: ui.Strings.Get(title), InitialPath: initialPath}
            )
            if result.Status == FileDialogStatus.Success && result.Paths.Count > 0 {
                path = result.Paths[0]
            } else if result.Status != FileDialogStatus.Cancelled {
                message = "File dialog unavailable"
            }
        } catch (failure Exception) {
            message = "File dialog unavailable"
        }
        host.TryPost(
            () -> {
                if path.Length > 0 {
                    chosen(path)
                } else if message.Length > 0 {
                    error = message
                    Rebuild()
                }
            }
        )
    }

    private func WalletAvailable() bool ->
    wallet.Snapshot.State == "Unlocked" && (wallet.Snapshot.Page == "Wallet" || seedFromWallet)

    private func Navigate(target string) {
        if ui.Working() {
            return
        }
        if target != "Settings" && (!WalletAvailable() || target == "Send" && wallet.Snapshot.ViewOnly) {
            return
        }
        if seedFromWallet && wallet.Snapshot.Page == "Seed" {
            FinishSeed()
        }
        Open(target)
    }

    private async func TogglePrivacy() {
        ui.Privacy = !ui.Privacy
        Rebuild()
        try {
            await wallet.SavePrivacyAsync(ui.Privacy)
        } catch (failure Exception) {
            window?.TryPost(
                () -> {
                    error = "Privacy setting could not be saved"
                    Rebuild()
                }
            )
        }
    }

    private async func SetLanguage(language string) {
        ui.Strings.Language = language
        ui.Decoding.Clear()
        tray?.Update(TraySettings())
        Rebuild()
        try {
            await wallet.SaveLanguageAsync(language)
        } catch (failure Exception) {
            window?.TryPost(
                () -> {
                    error = "Language setting could not be saved"
                    Rebuild()
                }
            )
        }
    }

    private func HistoryView(snapshot WalletSnapshot) Blob -> Cell.Mount[HistoryInput, HistoryPage](
        "history",
        HistoryInput{
            Session: wallet,
            Ui: ui,
            Snapshot: snapshot,
            Window: window,
            Tip: wallet.Node.Status.Height,
            Privacy: ui.Privacy,
            Language: ui.Strings.Language,
            Decode: ui.Progress("page"),
            Width: width,
            OnReceive: openReceive
        }
    )

    override func Build() Blob {
        let theme = Theme.Read()
        let snapshot = wallet.Snapshot
        let maximized = window?.State == WindowState.Maximized || window?.State == WindowState.Fullscreen
        let root = Container{
            Width: Percent(100),
            Height: Percent(100),
            BorderRadius: if maximized {
                0.0
            } else {
                theme.PanelRadius
            },
            Overflow: Overflow.Hidden,
            FontFamily: ui.Font,
            Color: ui.Ink,
            KeyBindings: WidgetKeyBindings.Editing(window?.PlatformInput),
            OnPointerDown: (event PointerEvent) -> Touch(),
            OnWheel: (event WheelEvent) -> Touch(),
            Container{
                Position: PositionType.Absolute,
                Left: 0,
                Top: 0,
                Right: 0,
                Bottom: 0,
                BackgroundColor: backgroundMode == "off" ? ui.Black: Color.Transparent,
                ShaderEffect: backgroundMode == "off" ? nil: background
            },
            Chrome()
        }
        let page = if screen.Length > 0 && (screen != "Send" || snapshot.State == "Unlocked") {
            screen
        } else if snapshot.Page == "Wallet" {
            "Overview"
        } else if Preparing() {
            "Sync"
        } else if snapshot.Page == "Welcome" || snapshot.Page == "Unlock" {
            "Library"
        } else {
            snapshot.Page
        }
        let banner = Problem()
        bannerHeight = if banner != nil {
            52.0
        } else {
            0.0
        }
        let content = if page == "Overview" {
            Cell.Mount[OverviewInput, OverviewPage](
                "overview",
                OverviewInput{
                    Ui: ui,
                    Snapshot: snapshot,
                    Node: wallet.Node.Status,
                    Contacts: contacts,
                    Privacy: ui.Privacy,
                    Height: height,
                    OnNavigate: navigate,
                    OnUpgrade: showUpgrade
                }
            )
        } else if page == "Send" {
            if wallet.Send.Error.Length > 0 || wallet.Send.Pending != nil || wallet.Send.Outcome.Text.Length > 0 {
                PendingSendCard()
            } else {
                Cell.Mount[SendPageInput, SendPage](
                    "send",
                    SendPageInput{
                        Session: wallet,
                        Ui: ui,
                        Window: window,
                        Snapshot: snapshot,
                        Contacts: contacts,
                        Network: wallet.Settings.Network,
                        Privacy: ui.Privacy,
                        Busy: ui.Working(),
                        Language: ui.Strings.Language,
                        Animate: PlaybackActive(),
                        Height: height,
                        OnSent: sendDone
                    }
                )
            }
        } else if page == "Receive" {
            Cell.Mount[ReceivePageInput, ReceivePage](
                "receive",
                ReceivePageInput{
                    Ui: ui,
                    Address: snapshot.Address,
                    History: snapshot.History,
                    ChainHeight: snapshot.Balance?.ChainHeight ?? uint64(0),
                    Privacy: ui.Privacy,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    Clipboard: ui.ClipboardText,
                    Height: height,
                    ChooseFile: chooseFile,
                    Request: receiveRequest
                }
            )
        } else if page == "Mining" {
            Cell.Mount[MiningPageInput, MiningPage](
                "mining",
                MiningPageInput{
                    Ui: ui,
                    Session: wallet,
                    Window: window,
                    History: miningHistory,
                    Wallet: ui.WalletName(wallet.Settings.ActiveWallet),
                    Language: ui.Strings.Language,
                    Busy: ui.Working(),
                    Height: height
                }
            )
        } else if page == "Transactions" {
            HistoryView(snapshot)
        } else if page == "Network" {
            Cell.Mount[NetworkInput, NetworkPage](
                "network",
                NetworkInput{
                    Ui: ui,
                    Session: wallet,
                    Window: window,
                    Node: wallet.Node.Status,
                    History: snapshot.History,
                    Sends: snapshot.Sends,
                    Language: ui.Strings.Language,
                    Width: width,
                    Height: height
                }
            )
        } else if page == "Sync" {
            Cell.Mount[SyncInput, SyncPage](
                "sync",
                SyncInput{Ui: ui, Node: wallet.Node.Status, Language: ui.Strings.Language, Width: width, Height: height}
            )
        } else if page == "Seed" || seedFromWallet && seed != nil {
            Cell.Mount[SeedPageInput, SeedPage](
                "seed",
                SeedPageInput{
                    Session: wallet,
                    Ui: ui,
                    Words: seed,
                    FromWallet: seedFromWallet,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    ChooseFile: chooseFile,
                    OnDone: finishSeed
                }
            )
        } else if page == "Tools" || page == "Privacy" {
            Cell.Mount[ToolsInput, ToolsPage](
                "tools",
                ToolsInput{
                    Session: wallet,
                    Ui: ui,
                    State: toolsState,
                    Snapshot: snapshot,
                    Node: wallet.Node.Status,
                    Section: page,
                    AutoLock: wallet.Settings.AutoLockMinutes,
                    Privacy: ui.Privacy,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    Width: width,
                    Height: height,
                    OnNavigate: navigate,
                    OnPrivacy: togglePrivacy,
                    OnNodeSettings: openNodeSettings
                }
            )
        } else if page == "Contacts" {
            Cell.Mount[ContactsInput, ContactsPage](
                "contacts",
                ContactsInput{
                    Ui: ui,
                    Contacts: contacts,
                    Privacy: ui.Privacy,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    OnChange: contactsChanged
                }
            )
        } else if page == "Settings" {
            Cell.Mount[SettingsPageInput, SettingsPage](
                "settings",
                SettingsPageInput{
                    Session: wallet,
                    Ui: ui,
                    Window: window,
                    Snapshot: snapshot,
                    Node: wallet.Node.Status,
                    Section: settingsSection,
                    Available: WalletAvailable(),
                    Privacy: ui.Privacy,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    Clipboard: ui.ClipboardText,
                    Width: width,
                    Height: height,
                    ChooseFile: chooseFile,
                    OnSection: selectSection,
                    OnLanguage: setLanguage,
                    OnPreference: preferenceChanged,
                    OnRevealSeed: revealSeed,
                    OnNavigate: navigate,
                    OnClose: closeSettings
                }
            )
        } else {
            Cell.Mount[LibraryInput, LibraryPage](
                "library",
                LibraryInput{
                    Session: wallet,
                    Ui: ui,
                    Page: snapshot.Page,
                    State: snapshot.State,
                    ActiveWallet: wallet.Settings.ActiveWallet,
                    Clears: clears,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    ChooseFile: chooseFile,
                    OnNavigate: navigate
                }
            )
        }
        let left = if WalletAvailable() {
            102.0
        } else {
            24.0
        }
        let span = width - left - 24
        let cardWidth = switch page {
            case "Overview": span
            case "Transactions": span
            case "Network": span
            case "Sync": 760.0
            case "Settings": 1004.0
            case "Seed": 760.0
            case "Receive": 640.0
            case "Send": 640.0
            case "Tools": span
            case "Privacy": span
            case "Contacts": 640.0
            default: 560.0
        }
        let side = Math.Min(span * 0.45, span - cardWidth - 48)
        let region = if side >= 240 {
            side
        } else {
            span
        }
        if !PlaybackActive() {
            Scene(1)
        }
        if !WalletAvailable() || sceneShift >= 1 || backgroundMode != "glyphs" {
            let radius = Math.Min(region / 2 - 24, (height - 44) / 2 - 24)
            sceneCenter = float32((left + span - region / 2) / width)
            background.SetParameter(
                2,
                Vector4(float32(Math.Max(1.15, 0.31 * height / radius)), float32((height + 44) / 2 / height), 0F, 0F)
            )
        }
        let scale = window?.UiScale ?? 1
        background.SetParameter(
            0,
            Vector4(
                float32(width * scale),
                float32(height * scale),
                float32(
                    if scale >= 1.5 {
                        3.0
                    } else {
                        2.0
                    }
                ),
                sceneCenter
            )
        )
        let main = Container{Key: page, FlexGrow: 1, FlexBasis: 0, MinWidth: 0, MinHeight: 0, Gap: 16, Padding: 24}
        if let shown = banner {
            main.Add(Container{FlexShrink: 0, shown})
        }
        if page == "Overview" && (wallet.Send.Pending != nil || wallet.Send.Outcome.Text.Length > 0) {
            main.Add(PendingSendBanner())
        }
        if page == "Overview" || page == "Transactions" || page == "Mining" || page == "Network" {
            main.Add(content)
        } else {
            let stage = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, FlexDirection: FlexDirection.Row}
            stage.Add(
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    content
                }
            )
            if side >= 240 && !WalletAvailable() {
                stage.Add(Container{Width: side, FlexShrink: 0})
            }
            main.Add(stage)
        }
        let frame = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, FlexDirection: FlexDirection.Row}
        if WalletAvailable() {
            main.Padding = 0
            main.Width = Percent(100)
            if page != "Transactions" {
                main.MaxWidth = 1400
            }
            frame.Padding = Edges{Left: 14, Right: 20, Bottom: 20}
            frame.Gap = 16
            frame.Add(Sidebar(page))
            frame.Add(Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, AlignItems: AlignItems.Center, main})
        } else {
            frame.Add(main)
        }
        root.Add(frame)
        if WalletAvailable() {
            if confirmPendingSend {
                root.Add(ConfirmPendingSend())
            }
            if upgradeShown {
                root.Add(UpgradeDialog())
            }
        }
        if !maximized {
            root.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Top: 0,
                    Right: 0,
                    Bottom: 0,
                    BorderWidth: 1,
                    BorderRadius: theme.PanelRadius,
                    BorderColor: if window?.IsFocused == true {
                        ui.Edge
                    } else {
                        ui.Rule
                    },
                    HitTestSelf: false,
                    ZIndex: 30
                }
            )
        }
        return root
    }
}
