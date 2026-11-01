package Gyroid.Views

import Goo
import Goo.Widgets
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Numerics
import System.Threading
import System.Threading.Tasks

enum AppPage {
    None,
    Overview,
    Send,
    Receive,
    Transactions,
    Messages,
    Tools,
    Contacts,
    Mining,
    Network,
    Privacy,
    Settings,
    Sync,
    Seed,
    Library
}

data class WindowWork(Run Func[CancellationToken, Task])

partial class App : Cell {
    private let sendDone Action

    private let chooseFile Action[FileDialogKind, string, string, Action[string]]

    private let receiveRequest ReceiveRequest = ReceiveRequest()
    private let sendRows List[SendRow] = List[SendRow]()
    private var pendingPayment PaymentLink?
    private var pendingPage AppPage = AppPage.None
    private var paymentActivated bool
    private var paymentRevision int32
    private var lastWallet string = ""

    private let miningHistory MiningHistory = MiningHistory()
    private let toolsState ToolsState = ToolsState()

    private let togglePrivacy Action

    private let openNodeSettings Action

    private let wallet WalletSession

    private let ui Presentation

    private let openReceive Action

    private var window Window?
    private let workers chan[WindowWork] = Chan.Unbounded[WindowWork]()
    private var workerTask Task? = nil
    private var closed bool

    private var width float64 = 1280

    private var height float64 = 800

    private var pixelScale float64 = 1
    private let scaleOverride bool
    private var maximumScalePercent int32 = 100

    private var screen AppPage = AppPage.None

    private var lastState WalletState

    private var error string = ""

    private var bannerHeight float64

    private var refreshing bool

    private var refreshError string = ""

    private var refreshTimer WindowTimer?

    private var statusTimer WindowTimer?

    private var backgroundLockTimer WindowTimer?

    private let navigate Action[AppPage]

    private var shownHeight string = ""

    private var seedFromWallet bool

    private var seed[]?char

    private var seedPassword[]?char

    private var seedIssue string = ""

    private let retrySeed Action

    private var contacts SortedDictionary[string, string] = SortedDictionary[string, string](StringComparer.Ordinal)

    private let finishSeed Action

    private let contactsChanged Action[SortedDictionary[string, string]]
    private var settingsSection string = "general"

    private let selectSection Action[string]

    private let setLanguage Action[string]

    private let preferenceChanged Action

    private let revealSeed Action[[]char]

    private let createWallet Action[string, []char]

    private let closeSettings Action

    init(wallet WalletSession, scaleOverride bool = false) {
        this.wallet = wallet
        this.scaleOverride = scaleOverride
        ui = Presentation(
            wallet.Settings.Language,
            wallet.Settings.Privacy,
            UiService(
                () -> Rebuild(),
                PlaybackActive,
                Touch,
                message -> {
                    error = message
                },
                (task, done, secret, extra) -> Run(task, done, secret, extra),
                action -> workers.Writer.TryWrite(WindowWork(action))
            )
        )
        navigate = target -> Navigate(target)
        togglePrivacy = () -> TogglePrivacy()
        openNodeSettings = () -> {
            settingsSection = "node"
            Navigate(AppPage.Settings)
        }
        showUpgrade = () -> {
            upgradeShown = true
            Rebuild()
        }
        sendDone = () -> Refresh()
        chooseFile = (kind, title, path, chosen) -> ChooseFile(kind, title, path, chosen)
        openReceive = () -> Navigate(AppPage.Receive)
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
            backgroundLockTimer?.Dispose()
            backgroundLockTimer = nil
            UpdateBackgroundLock()
            UpdatePlayback()
            Rebuild()
        }
        revealSeed = buffer -> {
            Run(ct -> ShowSeed(wallet.Keys.RevealSeedAsync(buffer, ct), true), nil, buffer)
        }
        retrySeed = () -> {
            if let buffer = seedPassword {
                Run(ct -> ShowSeed(wallet.Keys.RevealSeedAsync(buffer, ct), false))
            }
        }
        createWallet = (filename, buffer) -> Run(ct -> CreateWallet(filename, buffer, ct))
        closeSettings = () -> Back()
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

    func Activate(request ApplicationActivation) {
        let values = if let target = request.Target {
            []string{target.OriginalString}
        } else {
            request.Arguments
        }
        for value in values {
            if let payment = PaymentLink.Parse(value) {
                pendingPayment = payment
                pendingPage = AppPage.Send
                paymentActivated = true
                ApplyNavigation()
                break
            }
        }
        if !request.IsInitial || paymentActivated {
            Restore()
        }
    }

    private func ApplyNavigation() {
        if wallet.Snapshot.State != WalletState.Unlocked {
            return
        }
        if let payment = pendingPayment {
            sendRows.Clear()
            sendRows.Add(
                SendRow{
                    Address: payment.Address,
                    Amount: payment.Amount,
                    Memo: payment.Memo,
                    MemoOpen: payment.Memo.Length > 0
                }
            )
            pendingPayment = nil
            paymentRevision += 1
        }
        if pendingPage != AppPage.None {
            let target = pendingPage
            pendingPage = AppPage.None
            Open(target)
        }
    }

    func Attach(owner Window) {
        window = owner
        ui.Attach(owner)
        workerTask = RunWorkersAsync()
        Resize(owner)
        owner.MetricsChanged += metrics -> {
            pixelScale = metrics.DisplayScaleX * metrics.UiScale
            Resize(owner)
            Rebuild()
        }
        owner.DisplayChanged += () -> {
            UpdateScale()
            Rebuild()
        }
        owner.StateChanged += _ -> {
            UpdateBackgroundLock()
            UpdatePlayback()
            Rebuild()
        }
        owner.OcclusionChanged += _ -> {
            UpdateBackgroundLock()
            UpdatePlayback()
            Rebuild()
        }
        owner.FocusChanged += _ -> {
            UpdateBackgroundLock()
            UpdatePlayback()
            Rebuild()
        }
        owner.VisibilityChanged += _ -> {
            UpdateBackgroundLock()
            UpdatePlayback()
            Rebuild()
        }
        owner.PreviewKeyPressed += (key Key, modifiers KeyModifiers) -> {
            Touch()
            return false
        }
        wallet.Changed = () -> owner.Post(() -> Sync())
        lastState = wallet.Snapshot.State
        lastWallet = wallet.Settings.ActiveWallet
        Tick()
    }

    private func Close() {
        closed = true
        workers.Writer.TryComplete()
        workerTask?.GetAwaiter().GetResult()
        ui.Operations = 0
        tray?.Dispose()
        tray = nil
        refreshTimer?.Dispose()
        statusTimer?.Dispose()
        backgroundLockTimer?.Dispose()
        ui.Actions.DecodeTimer?.Dispose()
        ui.Actions.DecodeTimer = nil
        frameTimer?.Dispose()
        frameTimer = nil
        ui.Actions.ReleaseClipboard()
        ClearSeed()
        sendRows.Clear()
        wallet.Changed = nil
        messageToastTimer?.Dispose()
    }

    private func Touch() {
        wallet.Touch()
    }

    private func InBackground(owner Window) bool ->
    hidden ||
        !owner.IsFocused ||
        !owner.IsVisible ||
        owner.State == WindowState.Minimized ||
        owner.Occlusion == WindowOcclusion.Occluded

    private func UpdateBackgroundLock() {
        guard let owner = window else {
            return
        }
        let minutes = wallet.Settings.BackgroundLockMinutes
        if minutes == 0 || !InBackground(owner) {
            backgroundLockTimer?.Dispose()
            backgroundLockTimer = nil
        } else {
            backgroundLockTimer ??= owner.SetTimeout(
                () -> {
                    backgroundLockTimer = nil
                    if wallet.Snapshot.State == WalletState.Unlocked && InBackground(owner) {
                        Lock()
                    }
                },
                float64(minutes) * 60000
            )
        }
    }

    private func Resize(owner Window) {
        width = owner.Width / owner.UiScale
        height = owner.Height / owner.UiScale
    }

    func UpdateScale() {
        guard let owner = window else {
            return
        }
        if !owner.IsOpen {
            return
        }
        let display = owner.GetCurrentDisplay()
        let usable = display?.UsableBounds ?? display?.Bounds
        maximumScalePercent = if let bounds = usable {
            int32(Math.Clamp(Math.Floor(Math.Min(bounds.Width / 960, bounds.Height / 640) * 4) * 25, 100.0, 200.0))
        } else {
            100
        }
        if !scaleOverride {
            owner.UiScale = float32(Math.Min(wallet.Settings.UiScalePercent, maximumScalePercent)) / 100F
        }
        Resize(owner)
    }

    private func Sync() {
        let node = wallet.Node.Status
        let snapshot = wallet.Snapshot
        let walletChanged = wallet.Settings.ActiveWallet != lastWallet
        ObserveMessages()
        if snapshot.State != WalletState.Unlocked || walletChanged {
            ClearSeed()
            toolsState.Report = nil
            sendRows.Clear()
            confirmPendingSend = false
        }
        if !node.Running || node.Syncing || node.Peers == 0 || node.Height == 0 || snapshot.ScanBehind(node.Height) {
            statusTimer ??= window?.SetInterval(() -> Refresh(true), 1000)
        } else {
            statusTimer?.Dispose()
            statusTimer = nil
        }
        if snapshot.State != lastState || walletChanged {
            ClearSeed()
            upgradeShown = false
            screen = AppPage.None
            ui.Actions.Decode("page")
            lastState = snapshot.State
            lastWallet = wallet.Settings.ActiveWallet
        }
        ApplyNavigation()
        let heights = if let value = snapshot.Balance {
            value.ScanHeight.ToString() + " " + value.ChainHeight.ToString()
        } else {
            ""
        }
        if heights != shownHeight {
            shownHeight = heights
            ui.Actions.Decode("sync")
        }
        UpdateTray()
        Rebuild()
    }

    private async func CreateWallet(filename string, buffer[]char, ct CancellationToken) {
        try {
            await wallet.CreateAsync(filename, buffer, ct)
        } catch (failure Exception) {
            Array.Clear(buffer)
            throw failure
        }
        if window?.TryPost(
            () -> {
                if wallet.Snapshot.State != WalletState.Unlocked || wallet.LockQueued {
                    Array.Clear(buffer)
                    return
                }
                ClearSeed()
                seedPassword = buffer
                seed = []char{}
                Open(AppPage.Seed)
                retrySeed()
            }
        ) != true {
            Array.Clear(buffer)
        }
    }

    private async func ShowSeed(task Task[[]char], fromWallet bool) {
        var words[]char
        try {
            words = await task
        } catch (failure WalletException) {
            if seedPassword == nil {
                throw failure
            }
            window?.TryPost(
                () -> {
                    seedIssue = failure.Message
                    Rebuild()
                }
            )
            return
        }
        if window?.TryPost(
            () -> {
                if wallet.Snapshot.State != WalletState.Unlocked || wallet.LockQueued {
                    Array.Clear(words)
                    return
                }
                ClearSeed()
                seed = words
                seedFromWallet = fromWallet
                Open(AppPage.Seed)
            }
        ) != true {
            Array.Clear(words)
        }
    }

    private func ClearSeed() {
        ui.Actions.ReleaseClipboard()
        if let password = seedPassword {
            Array.Clear(password)
        }
        seedPassword = nil
        seedIssue = ""
        if let words = seed {
            Array.Clear(words)
        }
        seed = nil
        if screen == AppPage.Seed {
            screen = seedFromWallet ? AppPage.Settings: AppPage.Overview
        }
        seedFromWallet = false
    }

    private func FinishSeed() {
        let target = seedFromWallet ? AppPage.Settings: AppPage.Overview
        ClearSeed()
        Open(target)
    }

    private func LoadContacts() {
        try {
            contacts = AddressBook.ReadContacts(message -> error = message)
        } catch (failure WalletException) {
            error = failure.Message
        }
    }

    private func Open(target AppPage) {
        upgradeShown = false
        if target == AppPage.Messages {
            messageDrawer = false
            LoadContacts()
        } else if !messageDrawer {
            wallet.Messages.ClearSelection()
        }
        if target != AppPage.Seed {
            ClearSeed()
        }
        error = ""
        screen = target
        if target == AppPage.Contacts {
            LoadContacts()
        }
        ui.Actions.Decode("page")
        Rebuild()
    }

    private func Back() {
        upgradeShown = false
        ClearSeed()
        error = ""
        screen = AppPage.None
        ui.Actions.Decode("page")
        Rebuild()
    }

    private async func RunWorkersAsync() {
        try {
            scope {
                for work in workers {
                    go RunWork(work, ctx.Token)
                }
                ctx.TryCancel()
            }
        } catch (failure OperationCanceledException) when closed { } catch (failure Exception) {
            Console.Error.WriteLine("Window background task failed: " + failure.GetType().Name)
            window?.TryPost(
                () -> {
                    error = "Window background task failed"
                    Rebuild()
                }
            )
        }
    }

    private async func RunWork(work WindowWork, ct CancellationToken) {
        try {
            await work.Run(ct)
        } catch (failure OperationCanceledException) when ct.IsCancellationRequested {
            throw failure
        } catch (failure Exception) {
            Console.Error.WriteLine("Window background task failed: " + failure.GetType().Name)
            window?.TryPost(() -> ui.Actions.Report("Window background task failed"))
        }
    }

    private func Run(task Func[CancellationToken, Task], done Action? = nil, secret[]?char = nil, extra[]?char = nil) {
        ui.Operations++
        error = ""
        Rebuild()
        workers.Writer.TryWrite(WindowWork((ct CancellationToken) -> Complete(task, done, secret, extra, ct)))
    }

    private async func Complete(
        task Func[CancellationToken, Task],
        done Action?,
        secret[]?char,
        extra[]?char,
        ct CancellationToken
    ) {
        var message = ""
        var unknown = false
        try {
            await task(ct)
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
                    screen = if wallet.Snapshot.State == WalletState.Unlocked {
                        AppPage.Send
                    } else {
                        AppPage.None
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

    private func Refresh(statusOnly bool = false) {
        if refreshing || ui.Working() || wallet.Busy {
            return
        }
        refreshing = true
        workers.Writer.TryWrite(WindowWork((ct CancellationToken) -> RefreshAsync(statusOnly, ct)))
    }

    private async func RefreshAsync(statusOnly bool, ct CancellationToken) {
        var message = ""
        try {
            if statusOnly {
                await wallet.RefreshStatusAsync(ct)
            } else if wallet.Snapshot.State == WalletState.Unlocked {
                await wallet.RefreshAsync(ct)
            } else {
                await wallet.RefreshNodeAsync(ct)
            }
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

    private func WalletAvailable() bool -> wallet
        .Snapshot
        .State == WalletState.Unlocked &&
        (screen != AppPage.Seed || seedFromWallet)

    private func Navigate(target AppPage) {
        if ui.Working() {
            return
        }
        if target != AppPage.Settings && (!WalletAvailable() || target == AppPage.Send && wallet.Snapshot.ViewOnly) {
            return
        }
        Open(target)
    }

    private async func TogglePrivacy() {
        ui.Privacy = !ui.Privacy
        UpdateTray()
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
        ui.Actions.Decoding.Clear()
        UpdateTray()
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
            Decode: ui.Actions.Progress("page"),
            Width: width,
            OnReceive: openReceive,
            OnMessage: OpenMessage
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
        let page = if screen != AppPage.None && (snapshot.State == WalletState.Unlocked || screen == AppPage.Settings) {
            screen
        } else if snapshot.State == WalletState.Unlocked {
            AppPage.Overview
        } else if Preparing() {
            AppPage.Sync
        } else {
            AppPage.Library
        }
        let banner = Problem()
        bannerHeight = if banner != nil {
            52.0
        } else {
            0.0
        }
        let content = if page == AppPage.Overview {
            Cell.Mount[OverviewInput, OverviewPage](
                "overview",
                OverviewInput{
                    Ui: ui,
                    Session: wallet,
                    Window: window,
                    Snapshot: snapshot,
                    Node: wallet.Node.Status,
                    Contacts: contacts,
                    Privacy: ui.Privacy,
                    Height: height,
                    Width: width,
                    OnNavigate: navigate,
                    OnUpgrade: showUpgrade
                }
            )
        } else if page == AppPage.Send {
            if wallet
                .Send
                .Error
                .Length > 0 ||
                wallet
                .Send
                .Pending != nil ||
                wallet
                .Send
                .Outcome
                .TxId
                .Length > 0 ||
                wallet
                .Send
                .Outcome
                .Error != nil {
                PendingSendCard()
            } else {
                Cell.Mount[SendPageInput, SendPage](
                    "send-" + paymentRevision.ToString(),
                    SendPageInput{
                        Session: wallet,
                        Rows: sendRows,
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
        } else if page == AppPage.Receive {
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
                    Clipboard: ui.Actions.ClipboardText,
                    Height: height,
                    ChooseFile: chooseFile,
                    Request: receiveRequest
                }
            )
        } else if page == AppPage.Mining {
            Cell.Mount[MiningPageInput, MiningPage](
                "mining",
                MiningPageInput{
                    Ui: ui,
                    Session: wallet,
                    Window: window,
                    History: miningHistory,
                    Wallet: WalletName(wallet.Settings.ActiveWallet),
                    Language: ui.Strings.Language,
                    Busy: ui.Working(),
                    Visible: !hidden &&
                        window?.IsVisible == true &&
                        window?.State != WindowState.Minimized &&
                        window?.Occlusion != WindowOcclusion.Occluded,
                    NodeRunning: wallet.Node.Status.Running,
                    Height: height
                }
            )
        } else if page == AppPage.Transactions {
            HistoryView(snapshot)
        } else if page == AppPage.Messages {
            MessagesView(false)
        } else if page == AppPage.Network {
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
        } else if page == AppPage.Sync {
            Cell.Mount[SyncInput, SyncPage](
                "sync",
                SyncInput{Ui: ui, Node: wallet.Node.Status, Language: ui.Strings.Language, Width: width, Height: height}
            )
        } else if let words = seed {
            Cell.Mount[SeedPageInput, SeedPage](
                "seed",
                SeedPageInput{
                    Session: wallet,
                    Ui: ui,
                    Words: words,
                    FromWallet: seedFromWallet,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    ChooseFile: chooseFile,
                    OnDone: finishSeed,
                    Issue: seedIssue,
                    OnRetry: retrySeed
                }
            )
        } else if page == AppPage.Tools || page == AppPage.Privacy {
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
                    Decode: ui.Actions.Progress("page"),
                    Width: width,
                    Height: height,
                    OnNavigate: navigate,
                    OnPrivacy: togglePrivacy,
                    OnNodeSettings: openNodeSettings
                }
            )
        } else if page == AppPage.Contacts {
            Cell.Mount[ContactsInput, ContactsPage](
                "contacts",
                ContactsInput{
                    Ui: ui,
                    Contacts: contacts,
                    Privacy: ui.Privacy,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    Network: wallet.Settings.Network,
                    Height: height,
                    OnChange: contactsChanged
                }
            )
        } else if page == AppPage.Settings {
            Cell.Mount[SettingsPageInput, SettingsPage](
                "settings",
                SettingsPageInput{
                    Session: wallet,
                    Ui: ui,
                    Tools: toolsState,
                    Window: window,
                    Snapshot: snapshot,
                    Node: wallet.Node.Status,
                    Section: settingsSection,
                    Available: WalletAvailable(),
                    Privacy: ui.Privacy,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    Clipboard: ui.Actions.ClipboardText,
                    Width: width,
                    Height: height,
                    MaximumScalePercent: maximumScalePercent,
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
                    State: snapshot.State,
                    ActiveWallet: wallet.Settings.ActiveWallet,
                    Busy: ui.Working(),
                    Language: ui.Strings.Language,
                    ChooseFile: chooseFile,
                    OnNavigate: navigate,
                    OnCreate: createWallet
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
            case AppPage.Overview: span
            case AppPage.Transactions: span
            case AppPage.Messages: span
            case AppPage.Network: span
            case AppPage.Sync: 760.0
            case AppPage.Settings: 1004.0
            case AppPage.Seed: 760.0
            case AppPage.Receive: 640.0
            case AppPage.Send: 640.0
            case AppPage.Tools: span
            case AppPage.Privacy: span
            case AppPage.Contacts: 640.0
            case AppPage.None, AppPage.Library, AppPage.Mining: 560.0
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
        let main = Container{
            Key: switch page {
                case AppPage.None: ""
                case AppPage.Overview: "Overview"
                case AppPage.Send: "Send"
                case AppPage.Receive: "Receive"
                case AppPage.Transactions: "Transactions"
                case AppPage.Messages: "Messages"
                case AppPage.Tools: "Tools"
                case AppPage.Contacts: "Contacts"
                case AppPage.Mining: "Mining"
                case AppPage.Network: "Network"
                case AppPage.Privacy: "Privacy"
                case AppPage.Settings: "Settings"
                case AppPage.Sync: "Sync"
                case AppPage.Seed: "Seed"
                case AppPage.Library: "Library"
            },
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: 0,
            Gap: 16,
            Padding: 24
        }
        if let shown = banner {
            main.Add(Container{Key: "error-banner", FlexShrink: 0, shown})
        }
        if page == AppPage.Overview &&
            (
            wallet
                .Send
                .Pending != nil ||
                wallet
                .Send
                .Error
                .Length > 0 ||
                wallet
                .Send
                .Outcome
                .TxId
                .Length > 0 ||
                wallet
                .Send
                .Outcome
                .Error != nil
        ) {
            let pendingBanner = PendingSendBanner()
            pendingBanner.Key = "pending-send"
            main.Add(pendingBanner)
        }
        if page == AppPage.Overview ||
            page == AppPage.Transactions ||
            page == AppPage.Messages ||
            page == AppPage.Mining ||
            page == AppPage.Network {
            content.Key = "content-stage"
            main.Add(content)
        } else {
            let stage = Container{
                Key: "content-stage",
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                FlexDirection: FlexDirection.Row
            }
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
            if page != AppPage.Transactions &&
                page != AppPage.Messages &&
                page != AppPage.Overview &&
                page != AppPage.Network {
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
            if page != AppPage.Messages {
                root.Add(MessageOverlay())
            }
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
