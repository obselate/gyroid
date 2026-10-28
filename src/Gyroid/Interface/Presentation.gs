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

partial class WalletView {
    private func Money(value uint64) string -> WalletAmount.Format(value)

    private func Hidden(value string) string -> if privacy {
        "••••••••"
    } else {
        value
    }

    private func Amount(value uint64) string -> Hidden(Money(value))

    private func Count(value uint64) string -> value.ToString("N0", CultureInfo.InvariantCulture)

    private func Grouped(value string) string {
        let groups = List[string]()
        var start = 0
        while start < value.Length {
            groups.Add(value.Substring(start, Math.Min(8, value.Length - start)))
            start += 8
        }
        return String.Join(" ", groups)
    }

    private func Grow(blob Blob) Blob {
        blob.FlexGrow = 1
        blob.FlexBasis = 0
        blob.MinWidth = 0
        return blob
    }

    private func AmountIssue(value string, available uint64? = nil) string {
        if value.Length == 0 {
            return ""
        }
        try {
            return if WalletAmount.Parse(value) > (available ?? uint64.MaxValue) {
                "Exceeds spendable balance"
            } else {
                ""
            }
        } catch (error WalletException) {
            return error.Message
        }
    }

    private func MemoIssue(value string) string {
        try {
            WalletValidation.MemoBytes(value)
            return ""
        } catch (error WalletException) {
            return error.Message
        }
    }

    private func ChainState(state string, confirmations uint64) string -> if state == "confirmed" {
        strings.Get("Confirmed") + " " + Count(confirmations)
    } else if state == "mempool" {
        strings.Get("Pending")
    } else if state == "not_found" {
        strings.Get("Not found")
    } else {
        state
    }

    private func Time(seconds int64) string -> DateTimeOffset
        .FromUnixTimeSeconds(seconds)
        .ToLocalTime()
        .ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)

    private func Tabs(key string, label string, items[]NavigationItem, selected string, chosen Action[string]) Blob ->
    Cell.Mount[TabBarInput, TabBar](
        key,
        TabBarInput{
            Items: items,
            SelectedId: selected,
            AccessibilityName: strings.Get(label),
            CreateItem: (bar TabBarInput, item NavigationItem, button Button) -> {
                button.BorderRadius = 4
                button.Overflow = Overflow.Hidden
                return button
            },
            OnSelect: chosen
        }
    )

    private func ToolField(label string, value string, changed Action[string], submit Action) Blob -> Field(
        label,
        value,
        text -> {
            changed(text)
            ResetVerdict()
            Rebuild()
        },
        submit
    )

    private let strings Strings

    private var operations int32

    private var clipboardTimer WindowTimer?

    private var clipboardText[]char = []char{}

    private let decoding Dictionary[string, int64] = Dictionary[string, int64]()

    private var decodeSeed int32

    private var decodeTimer WindowTimer?

    private var privacy bool

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

    private func Working() bool -> operations > 0

    private func Copy(content string, clearAfterMs float64) {
        guard let host = window else {
            return
        }
        ReleaseClipboard()
        try {
            host.SetClipboardText(content)
        } catch (failure Exception) {
            error = "Copy failed"
            Rebuild()
            return
        }
        clipboardText = content.ToCharArray()
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
                System.Runtime.InteropServices.MemoryMarshal.AsBytes[char](ReadOnlySpan[char](clipboardText))
            ) {
                host.SetClipboardText("")
            }
        } catch (failure Exception) {
            error = "Clipboard could not be cleared"
            Rebuild()
        } finally {
            Array.Clear(clipboardText)
            clipboardText = []char{}
        }
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
        let copied = ReadOnlySpan[char](clipboardText).SequenceEqual(System.MemoryExtensions.AsSpan(value))
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
}
