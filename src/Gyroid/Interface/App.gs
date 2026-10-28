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

partial class WalletView : Cell {
    private var traceEstimate SendEstimate?

    private var traceResult SendResult?

    private func Prove(send WalletSend) {
        let task = wallet.Proofs.ProveAsync(send.TxId)
        Run(
            task,
            () -> {
                proofTx = send.TxId
                proofKey = task.Result
                proofAddress = send.Recipients.Length > 0 ? send.Recipients[0].Address: ""
                proofAmount = send.Recipients.Length > 0 ? Money(send.Recipients[0].Amount): ""
                ResetVerdict()
            }
        )
    }

    private var proofTx string = ""

    private var proofKey string = ""

    private var proofAddress string = ""

    private var proofAmount string = ""

    private let wallet WalletSession

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

    private var shownBalance uint64?

    private var shownHeight string = ""

    private var seedFromWallet bool

    private var shownState string = ""

    init(wallet WalletSession) {
        this.wallet = wallet
        strings = Strings(wallet.Settings.Language)
        receivedRow = (output WalletOutput) -> ReceivedRow(output)
        sentRow = (send WalletSend) -> SentRow(send)
        historyHandle.MetricsChanged += MoreHistory
        background = ShaderEffect(ShaderEffectProgram(Resources.Resource("Gyroid.Background.goo-effect")))
        appIcon = ImageSource.Decode(Resources.Resource("Gyroid.Icon.png"))
        privacy = wallet.Settings.Privacy
        LoadWallets()
        LoadContacts()
    }

    func Attach(owner Window) {
        window = owner
        FontSource("JetBrains Mono", 400, false, Resources.Resource("Gyroid.Font.Regular.ttf")).Register()
        FontSource("JetBrains Mono", 700, false, Resources.Resource("Gyroid.Font.Bold.ttf")).Register()
        let palette = (
            Theme.Ink with{
                Translate = key -> strings.Get(key),
                FontFamily = font,
                HeadingFontFamily = font,
                MonoFontFamily = font,
                FontSize = 14,
                PanelRadius = 6,
                ControlRadius = 4,
                CanvasColor = black,
                PanelColor = surface,
                RaisedColor = raised,
                OverlayColor = raised,
                FieldColor = surface,
                SunkenColor = black,
                HoverColor = rule,
                PressedColor = edge,
                ActiveColor = edge,
                BorderColor = edge,
                InputBorderColor = edge,
                StrongBorderColor = dim,
                TextColor = ink,
                MutedTextColor = body,
                SubtleTextColor = body,
                PlaceholderColor = dim,
                FaintTextColor = body,
                DisabledTextColor = dim,
                AccentColor = lime,
                OnAccentColor = black,
                AccentHoverColor = limeHover,
                AccentPressedColor = lime,
                FocusColor = lime,
                LinkColor = blue,
                InfoColor = blue,
                SuccessColor = lime,
                WarningColor = orange,
                DangerColor = pink,
                DangerFillColor = pink,
                DangerHoverColor = pink,
                InfoFillColor = Color.Parse("#00111a"),
                SuccessFillColor = Color.Parse("#111a00"),
                WarningFillColor = Color.Parse("#1a1100"),
                DangerQuietColor = Color.Parse("#1a0011")
            }
        ).WithGlass() with{
            GlassColor = black.WithAlpha(pane),
            HairlineColor = edge,
            HighlightColor = surface.WithAlpha(0)
        }
        Theme.Attach(owner, palette)
        Resize(owner)
        owner.MetricsChanged += metrics -> {
            pixelScale = metrics.DisplayScaleX * metrics.UiScale
            Resize(owner)
            Rebuild()
        }
        owner.StateChanged += _ -> {
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
        decodeTimer?.Dispose()
        decodeTimer = nil
        frameTimer?.Dispose()
        frameTimer = nil
        traceTimer?.Dispose()
        traceTimer = nil
        ReleaseClipboard()
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
            "${snapshot.Page} ${snapshot.State} ${snapshot.Connected} ${snapshot.ViewOnly} ${snapshot.Address} ${snapshot.HistoryTotal} ${wallet.Send.Pending?.Retryable} ${wallet.Send.Pending?.State} ${wallet.LockQueued} ${wallet.Node.Status.Progress} ${node.Source} ${node.Owned} ${node.Running} ${node.Height} ${node.ChainHeight} ${node.Syncing} ${node.SyncProgress} ${node.Phase} ${node.Peers} ${node.Endpoint} ${node.DataDirectory}"
        )
        if let value = snapshot.Balance {
            text.Append(
                " ${value.Scanning} ${value.ScanHeight} ${value.ChainHeight} ${value.Balance} ${value.Spendable} ${value.Pending}"
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
        }
        shownState = state
        ResumePlayback()
        let node = wallet.Node.Status
        if node.Syncing || node.Running && node.Peers == 0 {
            statusTimer ??= window?.SetInterval(() -> Refresh(true), 1000)
        } else {
            statusTimer?.Dispose()
            statusTimer = nil
        }
        let page = snapshot.Page
        if page != lastPage {
            ClearSecrets()
            ClearTools()
            CloseTrace()
            if lastPage == "Seed" {
                ClearSeed()
            }
            if page == "Welcome" {
                LoadWallets()
            }
            if !seedFromWallet || page != "Seed" && page != "Wallet" {
                screen = ""
                Decode("page")
            }
            lastPage = page
            seedFromWallet = seedFromWallet && page == "Seed"
        }
        let balance = snapshot.Balance
        if balance?.Balance != shownBalance {
            shownBalance = balance?.Balance
            Decode("balance")
        }
        let heights = if let value = balance {
            value.ScanHeight.ToString() + " " + value.ChainHeight.ToString()
        } else {
            ""
        }
        if heights != shownHeight {
            shownHeight = heights
            Decode("sync")
        }
        UpdateTray()
        Rebuild()
    }

    private func ClearSecrets() {
        password = ""
        confirmation = ""
        filePassword = ""
        passwordIssue = ""
        phrase = ""
        spendKey = ""
        viewKey = ""
        revealPassword = ""
        estimate = nil
        shownOutput = nil
        shownSend = nil
        upgradeShown = false
        viewKeys?.Dispose()
        viewKeys = nil
        viewKeysVisible = false
        viewOnlyOpen = false
        viewOnlyCreated = ""
        deletingContact = ""
    }

    private func Run(task Task, done Action? = nil, secret[]?char = nil, extra[]?char = nil) {
        operations++
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
                operations--
                if unknown {
                    address = ""
                    amount = ""
                    memo = ""
                    historyTab = "sent"
                    screen = "Send"
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
        if refreshing || Working() || wallet.Busy {
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
                FileDialogOptions{Title: strings.Get(title), InitialPath: initialPath}
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
        if Working() {
            return
        }
        if target == "Settings" {
            draft = wallet.Settings
            listenIssue = ""
            programIssue = ""
            applyPending = false
        } else if !WalletAvailable() || target == "Send" && wallet.Snapshot.ViewOnly {
            return
        }
        if seedFromWallet && wallet.Snapshot.Page == "Seed" {
            FinishSeed()
        }
        Open(target)
    }

    private async func TogglePrivacy() {
        privacy = !privacy
        Decode("balance")
        Rebuild()
        try {
            await wallet.SavePrivacyAsync(privacy)
        } catch (failure Exception) {
            window?.TryPost(
                () -> {
                    error = "Privacy setting could not be saved"
                    Rebuild()
                }
            )
        }
    }

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
            FontFamily: font,
            Color: ink,
            KeyBindings: WidgetKeyBindings.Editing(window?.PlatformInput),
            OnPointerDown: (event PointerEvent) -> Touch(),
            OnWheel: (event WheelEvent) -> Touch(),
            Container{Position: PositionType.Absolute, Left: 0, Top: 0, Right: 0, Bottom: 0, ShaderEffect: background},
            Chrome()
        }
        let page = if screen.Length > 0 {
            screen
        } else if snapshot.Page == "Wallet" {
            "Overview"
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
            Dashboard()
        } else if page == "Send" {
            SendPanel()
        } else if page == "Receive" {
            ReceivePanel(snapshot.Address)
        } else if page == "Transactions" {
            History(snapshot)
        } else if page == "Seed" {
            SeedPage()
        } else if page == "Unlock" {
            UnlockPage()
        } else if page == "Create" || page == "Phrase" || page == "ViewOnly" {
            CreatePage(page)
        } else if page == "Tools" {
            ToolsPage()
        } else if page == "Contacts" {
            ContactsPage()
        } else if page == "Settings" {
            SettingsPage()
        } else {
            WelcomePage()
        }
        let left = if WalletAvailable() {
            224.0
        } else {
            24.0
        }
        let span = width - left - 24
        let cardWidth = switch page {
            case "Overview": span
            case "Transactions": span
            case "Settings": 860.0
            case "Seed": 760.0
            case "Receive": 640.0
            case "Send": 640.0
            case "Tools": 640.0
            case "Contacts": 640.0
            default: 520.0
        }
        let side = Math.Min(span * 0.45, span - cardWidth - 48)
        let region = if side >= 240 {
            side
        } else {
            span
        }
        if !WalletAvailable() || sceneShift >= 1 {
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
        if page == "Overview" || page == "Transactions" {
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
            frame.Add(Sidebar(page))
        }
        frame.Add(main)
        root.Add(frame)
        if WalletAvailable() {
            if let pending = estimate {
                root.Add(ConfirmSend(pending))
            }
            if confirmPendingSend {
                root.Add(ConfirmPendingSend())
            }
            if shownOutput != nil || shownSend != nil {
                root.Add(TransactionDialog())
            }
            if upgradeShown {
                root.Add(UpgradeDialog())
            }
            if let keys = viewKeys {
                root.Add(ViewKeysDialog(keys))
            }
            if viewOnlyOpen {
                root.Add(ViewOnlyDialog())
            }
            if deletingContact.Length > 0 {
                root.Add(DeleteContactDialog())
            }
        }
        if applyPending && page == "Settings" {
            if let value = draft {
                root.Add(ConfirmApply(value))
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
                        edge
                    } else {
                        rule
                    },
                    HitTestSelf: false,
                    ZIndex: 30
                }
            )
        }
        return root
    }
}
