package Gyroid.View

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

partial class WalletView : Cell {
    private let wallet WalletSession
    private let strings Strings
    private var window Window?
    private var width float64 = 1280
    private var height float64 = 800
    private var pixelScale float64 = 1
    private var screen string = ""
    private var lastPage string = ""
    private var operations int32
    private var error string = ""
    private var bannerHeight float64
    private var refreshing bool
    private var refreshError string = ""
    private var settingsNoticeDismissed bool
    private var refreshTimer WindowTimer?
    private var statusTimer WindowTimer?
    private var clipboardTimer WindowTimer?
    private var clipboardText string = ""
    private var wallets[]string
    private var name string = ""
    private var password string = ""
    private var confirmation string = ""
    private var passwordIssue string = ""
    private var phrase string = ""
    private var draft WalletSettings?
    private var shownBalance uint64?
    private var shownHeight string = ""
    private let decoding Dictionary[string, int64] = Dictionary[string, int64]()
    private var decodeSeed int32
    private var decodeTimer WindowTimer?
    private var frameTimer WindowTimer?
    private var lastActivity int64 = Stopwatch.GetTimestamp()
    private let clock Stopwatch = Stopwatch.StartNew()
    private let background ShaderEffect
    private var sceneShift float64
    private var sceneCenter float32 = 0.62F
    private var seedFromWallet bool
    private var privacy bool
    private var shownState string = ""
    private let pane float64 = 0.8
    private let appIcon ImageSource
    private let font string = "JetBrains Mono, Noto Sans CJK, msyh, PingFang"
    private let black Color = Color.Parse("#000000")
    private let surface Color = Color.Parse("#050505")
    private let raised Color = Color.Parse("#0a0a0a")
    private let rule Color = Color.Parse("#1d1d1d")
    private let edge Color = Color.Parse("#2e2e2e")
    private let ink Color = Color.Parse("#f2f2f2")
    private let body Color = Color.Parse("#c8c8c8")
    private let dim Color = Color.Parse("#7a7a7a")
    private let lime Color = Color.Parse("#aaff00")
    private let limeHover Color = Color.Parse("#ccff33")
    private let orange Color = Color.Parse("#ffaa00")
    private let pink Color = Color.Parse("#ff00aa")
    private let blue Color = Color.Parse("#00aaff")
    private let mint Color = Color.Parse("#00ffaa")
    private let violet Color = Color.Parse("#aa00ff")

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

    private func PlaybackActive() bool ->
    !hidden && window?.IsFocused == true && window?.IsVisible == true && window?.State != WindowState.Minimized
    && Stopwatch.GetElapsedTime(lastActivity).TotalSeconds < 10

    private func UpdatePlayback() {
        let active = PlaybackActive()
        Motion.TimeScale = if active {
            1.0
        } else {
            0.0
        }
        if !active {
            clock.Stop()
            frameTimer?.Dispose()
            frameTimer = nil
            decodeTimer?.Dispose()
            decodeTimer = nil
            decoding.Clear()
        } else {
            clock.Start()
            frameTimer ??= window?.SetInterval(() -> Tick(), 50)
        }
    }

    private func Touch() {
        wallet.Touch()
        ResumePlayback()
    }

    private func ResumePlayback() {
        lastActivity = Stopwatch.GetTimestamp()
        if frameTimer == nil {
            UpdatePlayback()
            Rebuild()
        }
    }

    private func Tick() {
        if Stopwatch.GetElapsedTime(lastActivity).TotalSeconds >= 10 {
            UpdatePlayback()
            Rebuild()
            return
        }
        let now = clock.Elapsed.TotalSeconds
        let step = (now - background.ElapsedSeconds) / 1.2
        sceneShift = if WalletAvailable() {
            Math.Min(1, sceneShift + step)
        } else {
            Math.Max(0, sceneShift - step)
        }
        background.SetParameter(3, Vector4(float32(sceneShift), float32(3 * (window?.UiScale ?? 1)), float32(pane), 0F))
        background.ElapsedSeconds = now
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

    private func Decode(channel string) {
        if !PlaybackActive() {
            return
        }
        decoding[channel] = Stopwatch.GetTimestamp()
        decodeSeed = Random.Shared.Next()
        decodeTimer ??= window?.SetInterval(
            () -> {
                for channel in decoding.Keys.ToArray() {
                    if Progress(channel) >= 1 {
                        decoding.Remove(channel)
                    }
                }
                if decoding.Count == 0 {
                    decodeTimer?.Dispose()
                    decodeTimer = nil
                }
                Rebuild()
            },
            30
        )
    }

    private func Progress(channel string) float64 {
        if !decoding.ContainsKey(channel) {
            return 1
        }
        return Stopwatch.GetElapsedTime(decoding[channel]).TotalMilliseconds / 250
    }

    private func Frame(content string, t float64, seed int32, digits Random, size float64, color Color) Text {
        let thresholds = Random(seed)
        let reveal = (t - 0.45) / 0.55
        let neon = []Color{lime, orange, pink, blue, mint, violet}
        let chars = content.ToCharArray()
        let tints = List[TextStyleRange]()
        var index = 0
        while index < chars.Length {
            let lockAt = thresholds.NextDouble()
            if chars[index] >= '!' && chars[index] <= '~' && (t < 0.45 || reveal < lockAt) {
                chars[index] = "0123456789abcdef" [digits.Next(16)]
                if digits.Next(10) == 0 {
                    tints.Add(TextStyleRange(TextRange(index, 1), Style{Color: neon[digits.Next(neon.Length)]}))
                }
            }
            index++
        }
        return Text{
            Content: String(chars),
            StyleRanges: tints.ToArray(),
            FontFamily: font,
            FontSize: size,
            Color: color,
            TextWrap: TextWrap.NoWrap,
            MinWidth: 0
        }
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

    private func LoadWallets() {
        try {
            wallets = wallet.Library.ListWallets()
        } catch (failure WalletException) {
            wallets = Array.Empty[string]()
            error = failure.Message
        }
    }

    private func Working() bool -> operations > 0

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

    private func Copy(content string, clearAfterMs float64) {
        guard let host = window else {
            return
        }
        try {
            host.SetClipboardText(content)
        } catch (failure Exception) {
            error = "Copy failed"
            Rebuild()
            return
        }
        clipboardTimer?.Dispose()
        clipboardText = content
        clipboardTimer = host.SetTimeout(
            () -> {
                ReleaseClipboard()
                Rebuild()
            },
            clearAfterMs
        )
    }

    private func ReleaseClipboard() {
        guard let host = window else {
            return
        }
        guard let timer = clipboardTimer else {
            return
        }
        timer.Dispose()
        clipboardTimer = nil
        try {
            let current = host.GetClipboardText()
            if System
                .Security
                .Cryptography
                .CryptographicOperations
                .FixedTimeEquals(
                System.Runtime.InteropServices.MemoryMarshal.AsBytes[char](System.MemoryExtensions.AsSpan(current)),
                System
                    .Runtime
                    .InteropServices
                    .MemoryMarshal
                    .AsBytes[char](System.MemoryExtensions.AsSpan(clipboardText))
            ) {
                host.SetClipboardText("")
            }
        } catch (failure Exception) {
            error = "Clipboard could not be cleared"
            Rebuild()
        } finally {
            clipboardText = ""
        }
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

    private func WalletName(filename string) string ->
    if filename.EndsWith(".wallet.dat", StringComparison.Ordinal) {
        filename.Substring(0, filename.Length - 11)
    } else {
        filename
    }

    private func Label(content string, size float64 = 14, color Color? = nil, channel string = "page") Text {
        let t = if channel.Length == 0 {
            1.0
        } else {
            Math.Min(Progress("page"), Progress(channel))
        }
        if size >= 13 && t < 1 {
            return Frame(content, t, decodeSeed ^ content.GetHashCode(), Random.Shared, size, color ?? ink)
        }
        return Text{
            Content: content,
            FontFamily: font,
            FontSize: size,
            Color: color ?? ink,
            TextWrap: TextWrap.NoWrap,
            TextTrimming: TextTrimming.Ellipsis,
            MinWidth: 0
        }
    }

    private func Figure(
        label string,
        value string,
        color Color,
        size float64 = 14,
        channel string = "page"
    ) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Baseline,
        Gap: 10,
        MinWidth: 0,
        Accessibility: Accessibility{Name: strings.Get(label) + " " + value},
        Label(strings.Get(label), 12, body),
        Label(value, size, color, channel)
    }

    private func DialogRoot(dialog ModalDialog, backdrop Goo.Button, panel Container) Container -> Container{
        Position: PositionType.Absolute,
        Left: 0,
        Right: 0,
        Top: 0,
        Bottom: 0,
        AlignItems: AlignItems.Center,
        JustifyContent: JustifyContent.Center,
        OnPointerDown: (event PointerEvent) -> Touch(),
        OnWheel: (event WheelEvent) -> Touch()
    }

    private func Copyable(label string, value string, shown string, clearAfterMs float64 = 120000) Blob {
        let copied = clipboardText == value
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            Gap: 8,
            FlexShrink: 0,
            Grow(
                Container{
                    Gap: 6,
                    Label(strings.Get(label), 12, body),
                    Text{Content: shown, FontFamily: font, FontSize: 13, Color: ink, TextWrap: TextWrap.Wrap}
                }
            ),
            IconButton{
                Icon: MaterialIcons.Create(copied ? "check": "content_copy", 16, copied ? lime: body),
                AccessibilityName: strings.Get("Copy") + " " + strings.Get(label),
                OnClick: () -> {
                    Copy(value, clearAfterMs)
                    Rebuild()
                }
            }.Build()
        }
    }

    private func Glass() Container -> Container{
        BackgroundColor: surface.WithAlpha(pane),
        BackdropBlur: 16,
        BorderWidth: 1,
        BorderColor: Theme.Read().HairlineColor,
        BorderRadius: 6,
        Padding: 20,
        Gap: 16,
        MinWidth: 0,
        MinHeight: 0
    }

    private func Accent(color Color, content Blob) Blob -> Container{
        BorderWidth: Edges{Left: 3},
        BorderColor: color,
        Padding: Edges{Left: 12},
        MinWidth: 0,
        content
    }

    private func Button(content string, action Action, disabled bool = false, primary bool = false) Blob {
        let theme = Theme.Read()
        let style = if primary {
            theme.PrimaryButton
        } else {
            theme.Button
        }
        let busy = primary && Working()
        return Container{
            Position: PositionType.Relative,
            (
                style with{
                    Content = strings.Get(content),
                    OnClick = action,
                    Disabled = disabled || busy,
                    DisabledBackgroundColor = busy ? style.BackgroundColor: style.DisabledBackgroundColor,
                    DisabledTextColor = busy ? Color.Transparent: dim,
                    FontFamily = font
                }
            ).Build(),
            if busy && PlaybackActive() {
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Right: 0,
                    Top: 0,
                    Bottom: 0,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Cell.Mount[SpinnerInput, Spinner](
                        "busy",
                        SpinnerInput{Size: 20, StrokeWidth: 3, Color: style.TextColor}
                    )
                }
            } else {
                Container{}
            }
        }
    }

    private func Field(
        label string,
        value string,
        changed Action[string],
        submit Action? = nil,
        secret bool = false,
        issue string = "",
        disabled bool = false,
        labelled bool = true
    ) Blob -> TextField{
        Label: if labelled {
            strings.Get(label)
        } else {
            nil
        },
        AccessibilityName: strings.Get(label),
        Value: value,
        Controlled: true,
        Password: secret,
        RevealButton: secret,
        IssueText: if issue.Length > 0 {
            Explain(issue)
        } else {
            nil
        },
        Invalid: issue.Length > 0,
        Disabled: disabled || Working(),
        Width: Percent(100),
        FontFamily: font,
        ContentDirection: Direction.LeftToRight,
        OnChange: changed,
        OnSubmit: _ -> {
            if !Working() {
                submit?.Invoke()
            }
        }
    }.Build()

    private func PageContent(title string, maxWidth float64 = 520, trailing Blob? = nil) Container {
        let card = Glass()
        card.Width = Percent(100)
        card.MaxWidth = maxWidth
        card.MaxHeight = Percent(100)
        let header = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            JustifyContent: JustifyContent.SpaceBetween,
            Gap: 16,
            FlexShrink: 0,
            Label(title, 18, ink)
        }
        if let value = trailing {
            header.Add(value)
        }
        card.Add(header)
        return card
    }

    private func ActionRow(children[]Blob) Blob {
        let row = Container{
            FlexDirection: FlexDirection.Row,
            JustifyContent: JustifyContent.FlexEnd,
            Gap: 8,
            FlexShrink: 0
        }
        for child in children {
            row.Add(child)
        }
        return row
    }

    private func Problem() Blob? {
        let snapshot = wallet.Snapshot
        let message = if error.Length > 0 {
            error
        } else if refreshError.Length > 0 {
            refreshError
        } else if snapshot.Page == "Wallet" && !snapshot.Connected {
            "Not connected"
        } else {
            ""
        }
        if message.Length == 0 {
            let problem = wallet.Settings.LoadError
            if problem.Length == 0 || settingsNoticeDismissed {
                return nil
            }
            return Banner{
                Tone: Tone.Warning,
                Content: strings.Get("Settings file not loaded") + ": " + Explain(problem),
                FontFamily: font,
                OnDismiss: () -> {
                    settingsNoticeDismissed = true
                    Rebuild()
                }
            }.Build()
        }
        return Banner{
            Tone: Tone.Danger,
            Content: Explain(message),
            FontFamily: font,
            OnDismiss: () -> {
                error = ""
                refreshError = ""
                Rebuild()
            }
        }.Build()
    }

    private func Explain(message string) string -> strings.Get(
        switch message {
            case "Recovery phrase must contain English BIP39 words": "Recovery phrase must use English words"
            case "Recovery phrase contains a word outside the English BIP39 wordlist": "Recovery phrase has an unknown word"
            case "Node is not running. Manual mode never starts or downloads a core": "No node in manual mode"
            case "Cannot reach the configured daemon": "Node not reachable. Check Node URL in Settings"
            case "Owned daemon is running but its API is not ready": "Node is starting. Try again shortly"
            case "Configured core exited before its API became ready": "Node did not start"
            case "Could not start the configured core executable": "Node program could not start"
            case "Daemon binary must be an absolute path": "Node program must be a full path"
            case "Choose a new app-owned data directory. Existing unmanaged core data will not be modified": "Choose an empty Data folder. Existing node data is not changed"
            case "Core wallet_file must be an absolute path. Configure the external daemon explicitly": "Node settings need a full wallet file path"
            case "Core wallet_file must have a parent directory": "Node settings need a full wallet file path"
            case "Core settings must be a JSON object": "Node settings file could not be read"
            case "Core settings could not be parsed": "Node settings file could not be read"
            case "Application and core settings must use different files": "Node settings must be a separate file"
            case "API endpoint must be a loopback HTTP origin": "Node URL must be a local http address"
            case "Access to the configured API cookie was denied": "Node access file cannot be read"
            case CoreRelease.MismatchMessage: "Node program is not the verified " + CoreRelease.Version + " release"
            case "No pinned core is available for this platform": "No verified node release for this platform"
            case "API listener identity could not be verified": "Local node process could not be verified"
            case "API listener is not the app-owned core process": "Local node is not the process started by this app"
            case "API listener identity changed during connection": "Local node changed during connection"
            case "File must be a regular no-follow file": "Access file must be a regular file, not a link"
            case "File ownership or permissions are not private": "Access file must belong to you with private permissions"
            case "File exceeds the supported size": "Access file exceeds the size limit"
            case "API cookie must contain exactly 64 hexadecimal characters": "Node access file must contain a 64-character hex token"
            case "Daemon rejected the request. Check the wallet inputs, funds and memo limits": "Node rejected the request. Check amount, funds and memo"
            case "Node access denied. Check the cookie configuration": "Node access denied. Check the Data folder"
            case "Wrong wallet password": "Wrong password"
            case "No wallet is loaded or the daemon is not ready": "Node not ready or no wallet loaded"
            case "Daemon returned no recovery phrase": "Node returned no recovery phrase"
            case "Daemon did not return a dry-run estimate": "Node returned no fee estimate"
            case "Daemon returned an invalid response": "Node sent an invalid response"
            case "Daemon returned invalid wallet data": "Node sent an invalid response"
            case "Daemon returned an invalid recovery phrase response": "Node sent an invalid response"
            case "Daemon returned an incomplete outgoing history page": "Node sent an invalid response"
            case "Daemon response omitted a required timestamp": "Node sent an invalid response"
            case "Daemon response omitted a required numeric field": "Node sent an invalid response"
            case "Daemon response exceeds the supported size": "Node sent an invalid response"
            case "Daemon owner is closed": "App is closing"
            case "Wallet controller is closed": "App is closing"
            case "This application has not loaded a wallet. An external wallet will not be changed": "Wallet was loaded outside this app and is left unchanged"
            case "Data and wallet directories must be valid absolute paths": "Data and Wallets must be full folder paths"
            case "Data and wallet directories must be absolute paths": "Data and Wallets must be full folder paths"
            case "Invalid Blocknet ID. Use $$ followed by 1 to 64 letters, digits, dots, underscores or hyphens": "Invalid Blocknet ID. Use $$ and up to 64 letters, digits, . _ or -"
            case "Blocknet ID was not found": "Blocknet ID not found"
            case "Blocknet ID resolver is unavailable": "Blocknet ID lookup unavailable"
            case "Blocknet ID response exceeds the supported size": "Blocknet ID lookup failed"
            case "Blocknet ID request was cancelled or timed out": "Blocknet ID lookup timed out"
            case "Cannot reach the Blocknet ID resolver": "Blocknet ID lookup unreachable. Check your connection"
            case "Cannot read the Blocknet ID response": "Blocknet ID lookup failed"
            case "Could not verify the Blocknet ID destination": "Blocknet ID address could not be verified"
            default: message.Replace("Daemon request failed with HTTP", strings.Get("Node request failed with code"))
        }
    )

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

    private func SideItem(
        label string,
        selected bool,
        disabled bool,
        action Action,
        icon string = "",
        checked AccessibilityChecked = AccessibilityChecked.Unspecified
    ) Blob -> Goo
        .Button{
        Height: 40,
        FlexShrink: 0,
        Padding: Edges{Left: 9, Right: 8},
        BorderWidth: Edges{Left: 3, Top: 1, Right: 1, Bottom: 1},
        BorderRadius: 4,
        BorderColor: if selected {
            rule
        } else {
            Color.Transparent
        },
        BorderStartColor: if selected {
            lime
        } else {
            Color.Transparent
        },
        BackgroundColor: if selected {
            Color.Parse("#0b1203")
        } else {
            Color.Transparent
        },
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        JustifyContent: JustifyContent.FlexStart,
        Gap: if icon.Length > 0 {
            10.0
        } else {
            0.0
        },
        Disabled: disabled,
        Hover: Style{BackgroundColor: rule},
        Focus: Theme.Read().FocusStyle,
        Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: strings.Get(label), Checked: checked},
        OnClick: action,
        if icon.Length > 0 {
            Container{FlexShrink: 0, MaterialIcons.Create(icon, 16, dim)}
        } else {
            Container{}
        },
        Label(
            strings.Get(label),
            14,
            if disabled {
                dim
            } else if selected {
                lime
            } else if icon.Length > 0 {
                body
            } else {
                ink
            },
            ""
        )
    }

    private func Sidebar(page string) Blob {
        let blocked = Working()
        let island = Glass()
        island.Width = 176
        island.FlexShrink = 0
        island.Margin = Edges{Top: 24, Left: 24, Bottom: 24}
        island.Padding = 8
        island.Add(
            Container{
                FlexGrow: 1,
                Gap: 4,
                SideItem("overview", page == "Overview", blocked, () -> Navigate("Overview")),
                if wallet.Snapshot.ViewOnly {
                    Container{}
                } else {
                    SideItem("send", page == "Send", blocked, () -> Navigate("Send"))
                },
                SideItem("receive", page == "Receive", blocked, () -> Navigate("Receive")),
                SideItem("history", page == "Transactions", blocked, () -> Navigate("Transactions")),
                SideItem("tools", page == "Tools", blocked, () -> Navigate("Tools")),
                SideItem("contacts", page == "Contacts", blocked, () -> Navigate("Contacts")),
                Container{FlexGrow: 1},
                if let indicator = SyncIndicator(16, 12) {
                    Container{Padding: Edges{Left: 10}, FlexShrink: 0, indicator}
                } else {
                    Container{}
                },
                Container{Height: 1, FlexShrink: 0, Margin: Edges{Top: 8, Bottom: 8}, BackgroundColor: rule},
                SideItem(
                    "privacy",
                    privacy,
                    false,
                    () -> TogglePrivacy(),
                    if privacy {
                        "visibility_off"
                    } else {
                        "visibility"
                    },
                    if privacy {
                        AccessibilityChecked.True
                    } else {
                        AccessibilityChecked.False
                    }
                ),
                SideItem("settings", page == "Settings", blocked, () -> Navigate("Settings"), "settings"),
                SideItem("lock", false, wallet.LockQueued, () -> Lock(), "lock")
            }
        )
        return island
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

    private func Chrome() Blob -> WindowChrome{
        Host: window,
        Height: 44,
        ControlWidth: 46,
        ControlColor: body,
        HoverBackgroundColor: rule,
        EnableDoubleClick: true,
        EnableContextMenu: true,
        CreateControlContent: (chrome, command) -> ControlGlyph(chrome, command),
        LeadingContent: Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Padding: Edges{Left: 14},
            Image{Width: 18, Height: 18, Source: appIcon},
            Label("gyroid", 14, ink, ""),
            Label(wallet.Snapshot.ViewOnly ? strings.Get("view only"): "", 12, orange, "")
        }
    }.Build()

    private func ControlGlyph(chrome WindowChrome, command WindowChromeAction) Blob {
        let buttonWidth = chrome.ControlWidth * pixelScale
        let buttonHeight = chrome.Height * pixelScale
        let size = Math.Round(10 * pixelScale)
        let line = Math.Max(1.0, Math.Floor(pixelScale))
        let left = width * pixelScale - buttonWidth * switch command {
            case WindowChromeAction.Minimize: 3
            case WindowChromeAction.Close: 1
            default: 2
        }
        let x = Math.Floor(left + (buttonWidth - size) / 2) - left
        let top = -pixelScale / 2
        let y = Math.Floor(top + (buttonHeight - size) / 2) - top
        let path = PathBuilder(0, 0, buttonWidth, buttonHeight)
        if command == WindowChromeAction.Minimize {
            Outline(path, x, y + Math.Floor((size - line) / 2), []float64{0, 0, size, 0, size, line, 0, line})
        } else if command == WindowChromeAction.Close {
            let edge = line / Math.Sqrt(2)
            Outline(path, x, y, []float64{0, 0, edge, 0, size, size - edge, size, size, size - edge, size, 0, edge})
            Outline(path, x, y, []float64{size, edge, edge, size, 0, size, 0, size - edge, size - edge, 0, size, 0})
        } else {
            let offset = command == WindowChromeAction.Restore ? Math.Round(2 * pixelScale): 0.0
            let front = size - offset
            let inner = front - line
            Outline(path, x, y + offset, []float64{0, 0, front, 0, front, front, 0, front})
            Outline(path, x, y + offset, []float64{line, line, line, inner, inner, inner, inner, line})
            if offset > 0 {
                Outline(
                    path,
                    x + offset,
                    y,
                    []float64{0, 0, front, 0, front, front, inner, front, inner, line, 0, line}
                )
            }
        }
        return Shape{
            Width: chrome.ControlWidth,
            Height: chrome.Height,
            Path: path.Build(),
            Fit: ShapeFit.Fill,
            UseCurrentColor: true
        }
    }

    private func Outline(path PathBuilder, x float64, y float64, points[]float64) {
        path.MoveTo(x + points[0], y + points[1])
        for index in 1 ... points.Length / 2 {
            path.LineTo(x + points[2 * index], y + points[2 * index + 1])
        }
        path.Close()
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
