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
import System.Threading
import System.Threading.Tasks

class Presentation {
    private var window Window?
    let Pane float64 = 0.8
    private let rebuild Action
    private let playbackActive Func[bool]
    private let touch Action
    private let report Action[string]
    private let run Action[Func[CancellationToken, Task], Action?, []?char, []?char]
    private let background Action[Func[CancellationToken, Task]]

    init(
        language string,
        privacy bool,
        rebuild Action,
        playbackActive Func[bool],
        touch Action,
        report Action[string],
        run Action[Func[CancellationToken, Task], Action?, []?char, []?char],
        background Action[Func[CancellationToken, Task]]
    ) {
        Strings = Gyroid.Interface.Strings(language)
        Privacy = privacy
        this.rebuild = rebuild
        this.playbackActive = playbackActive
        this.touch = touch
        this.report = report
        this.run = run
        this.background = background
    }

    func Attach(owner Window) {
        window = owner
        FontSource("JetBrains Mono", 400, false, Resources.Resource("Gyroid.Font.Regular.ttf")).Register()
        FontSource("JetBrains Mono", 700, false, Resources.Resource("Gyroid.Font.Bold.ttf")).Register()
        let palette = (
            Theme.Ink with{
                Translate = key -> Strings.Get(key),
                FontFamily = Font,
                HeadingFontFamily = Font,
                MonoFontFamily = Font,
                FontSize = 14,
                PanelRadius = 6,
                ControlRadius = 4,
                CanvasColor = Black,
                PanelColor = Surface,
                RaisedColor = Raised,
                OverlayColor = Raised,
                FieldColor = Surface,
                SunkenColor = Black,
                HoverColor = Rule,
                PressedColor = Edge,
                ActiveColor = Edge,
                BorderColor = Edge,
                InputBorderColor = Edge,
                StrongBorderColor = Dim,
                TextColor = Ink,
                MutedTextColor = Body,
                SubtleTextColor = Body,
                PlaceholderColor = Dim,
                FaintTextColor = Body,
                DisabledTextColor = Dim,
                AccentColor = Lime,
                OnAccentColor = Black,
                AccentHoverColor = LimeHover,
                AccentPressedColor = Lime,
                FocusColor = Lime,
                LinkColor = Blue,
                InfoColor = Blue,
                SuccessColor = Lime,
                WarningColor = Orange,
                DangerColor = Pink,
                DangerFillColor = Pink,
                DangerHoverColor = Pink,
                InfoFillColor = Color.Parse("#00111a"),
                SuccessFillColor = Color.Parse("#111a00"),
                WarningFillColor = Color.Parse("#1a1100"),
                DangerQuietColor = Color.Parse("#1a0011")
            }
        ).WithGlass() with{
            GlassColor = Black.WithAlpha(Pane),
            HairlineColor = Edge,
            HighlightColor = Surface.WithAlpha(0)
        }
        Theme.Attach(owner, palette)
    }

    func Money(value uint64) string -> WalletAmount.Format(value)

    func Hidden(value string) string -> if Privacy {
        "••••••••"
    } else {
        value
    }

    func Amount(value uint64) string -> Hidden(Money(value))

    func Count(value uint64) string -> value.ToString("N0", CultureInfo.InvariantCulture)

    func Short(address string) string -> if address.Length > 13 {
        address.Substring(0, 8) + "…" + address.Substring(address.Length - 5)
    } else {
        address
    }

    func WalletName(filename string) string -> if filename.EndsWith(".wallet.dat", StringComparison.Ordinal) {
        filename.Substring(0, filename.Length - 11)
    } else {
        filename
    }

    func WalletFile(label string) string {
        let trimmed = label.Trim()
        return if trimmed.EndsWith(".wallet.dat", StringComparison.Ordinal) {
            trimmed
        } else {
            trimmed + ".wallet.dat"
        }
    }

    func Report(message string) {
        report(message)
        rebuild()
    }

    func Background(action Func[CancellationToken, Task]) {
        background(action)
    }

    func Run(task Func[CancellationToken, Task], done Action? = nil, secret[]?char = nil, extra[]?char = nil) {
        run(task, done, secret, extra)
    }

    func Delay(ms float64, action Action) WindowTimer? -> window?.SetTimeout(action, ms)

    func Grouped(value string) string {
        let groups = List[string]()
        var start = 0
        while start < value.Length {
            groups.Add(value.Substring(start, Math.Min(8, value.Length - start)))
            start += 8
        }
        return String.Join(" ", groups)
    }

    func Grow(blob Blob) Blob {
        blob.FlexGrow = 1
        blob.FlexBasis = 0
        blob.MinWidth = 0
        return blob
    }

    func AmountIssue(value string, available uint64? = nil) string {
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

    func MemoIssue(value string) string {
        try {
            WalletValidation.MemoBytes(value)
            return ""
        } catch (error WalletException) {
            return error.Message
        }
    }

    func ChainState(state string, confirmations uint64) string -> if state == "confirmed" {
        Strings.Get("Confirmed") + " " + Count(confirmations)
    } else if state == "mempool" {
        Strings.Get("Pending")
    } else if state == "not_found" {
        Strings.Get("Not found")
    } else {
        state
    }

    func Time(seconds int64) string -> DateTimeOffset
        .FromUnixTimeSeconds(seconds)
        .ToLocalTime()
        .ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)

    func Clock(seconds int64) string -> DateTimeOffset
        .FromUnixTimeSeconds(seconds)
        .ToLocalTime()
        .ToString("HH:mm", CultureInfo.InvariantCulture)

    func Tabs(key string, label string, items[]NavigationItem, selected string, chosen Action[string]) Blob ->
    Cell.Mount[TabBarInput, TabBar](
        key,
        TabBarInput{
            Items: items,
            SelectedId: selected,
            AccessibilityName: Strings.Get(label),
            CreateItem: (bar TabBarInput, item NavigationItem, button Button) -> {
                button.BorderRadius = 4
                button.Overflow = Overflow.Hidden
                return button
            },
            OnSelect: chosen
        }
    )

    let Strings Strings

    var Operations int32

    private var ClipboardTimer WindowTimer?

    var ClipboardText[]char = []char{}

    private var clipboardBytes[]uint8 = []uint8{}

    private var clipboardOwner[]uint8 = []uint8{}

    let Decoding Dictionary[string, int64] = Dictionary[string, int64]()

    private var DecodeSeed int32

    var DecodeTimer WindowTimer?

    var Privacy bool

    let Font string = "JetBrains Mono, Noto Sans CJK, msyh, PingFang"

    let Black Color = Color.Parse("#000000")

    let Surface Color = Color.Parse("#050505")

    let Raised Color = Color.Parse("#0a0a0a")

    let Rule Color = Color.Parse("#1d1d1d")

    let Edge Color = Color.Parse("#2e2e2e")

    let Ink Color = Color.Parse("#f2f2f2")

    let Body Color = Color.Parse("#c8c8c8")

    let Dim Color = Color.Parse("#7a7a7a")

    let Lime Color = Color.Parse("#aaff00")

    let LimeHover Color = Color.Parse("#ccff33")

    let Orange Color = Color.Parse("#ffaa00")

    let Pink Color = Color.Parse("#ff00aa")

    let Blue Color = Color.Parse("#00aaff")

    let Mint Color = Color.Parse("#00ffaa")

    let Violet Color = Color.Parse("#aa00ff")

    func SettleMotion() {
        Motion.TimeScale = playbackActive() ? 1.0: 0.0
    }

    func Decode(channel string) {
        if !playbackActive() {
            return
        }
        Decoding[channel] = Stopwatch.GetTimestamp()
        DecodeSeed = Random.Shared.Next()
        DecodeTimer ??= window?.SetInterval(
            () -> {
                for channel in Decoding.Keys.ToArray() {
                    if Progress(channel) >= 1 {
                        Decoding.Remove(channel)
                    }
                }
                if Decoding.Count == 0 {
                    DecodeTimer?.Dispose()
                    DecodeTimer = nil
                }
                rebuild()
            },
            30
        )
    }

    func Progress(channel string) float64 {
        if !Decoding.ContainsKey(channel) {
            return 1
        }
        return Stopwatch.GetElapsedTime(Decoding[channel]).TotalMilliseconds / 250
    }

    func Frame(content string, t float64, seed int32, digits Random, size float64, color Color) Text {
        let thresholds = Random(seed)
        let reveal = (t - 0.45) / 0.55
        let neon = []Color{Lime, Orange, Pink, Blue, Mint, Violet}
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
            FontFamily: Font,
            FontSize: size,
            Color: color,
            TextWrap: TextWrap.NoWrap,
            MinWidth: 0
        }
    }

    func Working() bool -> Operations > 0

    func Copy(content string, clearAfterMs float64) {
        guard let host = window else {
            return
        }
        ReleaseClipboard()
        try {
            host.SetClipboardText(content)
        } catch (failure Exception) {
            report("Copy failed")
            rebuild()
            return
        }
        ClipboardText = content.ToCharArray()
        ClipboardTimer = host.SetTimeout(
            () -> {
                ReleaseClipboard()
                rebuild()
            },
            clearAfterMs
        )
    }

    func Copy(content[]char, clearAfterMs float64) {
        guard let host = window else {
            return
        }
        ReleaseClipboard()
        let bytes = Encoding.UTF8.GetBytes(content)
        try {
            let text = TransferRepresentation("text/plain;charset=utf-8", ReadOnlyMemory[uint8](bytes))
            System.Runtime.InteropServices.MemoryMarshal.TryGetArray[uint8](text.Bytes, out let segment)
            clipboardBytes = segment.Array ?? throw InvalidOperationException("Clipboard buffer unavailable")
            clipboardOwner = Guid.NewGuid().ToByteArray()
            ClipboardTimer = host.SetTimeout(
                () -> {
                    ReleaseClipboard()
                    rebuild()
                },
                clearAfterMs
            )
            let result = host
                .WriteClipboardAsync(
                TransferData(
                    []TransferRepresentation{
                        text,
                        TransferRepresentation(
                            "application/x-gyroid-clipboard-owner",
                            ReadOnlyMemory[uint8](clipboardOwner)
                        )
                    },
                    Array.Empty[Uri]()
                )
            )
                .GetAwaiter()
                .GetResult()
            if result.Status != DataTransferStatus.Success {
                throw WalletException("Copy failed")
            }
        } catch (failure Exception) {
            ReleaseClipboard()
            report("Copy failed")
            rebuild()
        } finally {
            Array.Clear(bytes)
        }
    }

    func ReleaseClipboard() {
        guard let host = window else {
            return
        }
        if ClipboardTimer == nil && clipboardBytes.Length == 0 && ClipboardText.Length == 0 {
            return
        }
        ClipboardTimer?.Dispose()
        ClipboardTimer = nil
        try {
            if clipboardBytes.Length > 0 {
                let current = host
                    .ReadClipboardDataAsync([]string{"application/x-gyroid-clipboard-owner"})
                    .GetAwaiter()
                    .GetResult()
                for item in current.Data.Representations {
                    if item.Bytes.Span.SequenceEqual(ReadOnlySpan[uint8](clipboardOwner)) {
                        host.SetClipboardText("")
                        break
                    }
                }
            } else {
                let current = host.GetClipboardText()
                if System
                    .Security
                    .Cryptography
                    .CryptographicOperations
                    .FixedTimeEquals(
                    System.Runtime.InteropServices.MemoryMarshal.AsBytes[char](System.MemoryExtensions.AsSpan(current)),
                    System.Runtime.InteropServices.MemoryMarshal.AsBytes[char](ReadOnlySpan[char](ClipboardText))
                ) {
                    host.SetClipboardText("")
                }
            }
        } catch (failure Exception) {
            report("Clipboard could not be cleared")
            rebuild()
        } finally {
            Array.Clear(ClipboardText)
            ClipboardText = []char{}
            Array.Clear(clipboardBytes)
            clipboardBytes = []uint8{}
            Array.Clear(clipboardOwner)
            clipboardOwner = []uint8{}
        }
    }

    func Label(content string, size float64 = 14, color Color? = nil, channel string = "page") Text {
        let t = if channel.Length == 0 {
            1.0
        } else {
            Math.Min(Progress("page"), Progress(channel))
        }
        if size >= 13 && t < 1 {
            return Frame(content, t, DecodeSeed ^ content.GetHashCode(), Random.Shared, size, color ?? Ink)
        }
        return Text{
            Content: content,
            FontFamily: Font,
            FontSize: size,
            Color: color ?? Ink,
            TextWrap: TextWrap.NoWrap,
            TextTrimming: TextTrimming.Ellipsis,
            MinWidth: 0
        }
    }

    func Figure(label string, value string, color Color, size float64 = 14, channel string = "page") Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Baseline,
        Gap: 10,
        MinWidth: 0,
        Accessibility: Accessibility{Name: Strings.Get(label) + " " + value},
        Label(Strings.Get(label), 12, Body),
        Label(value, size, color, channel)
    }

    func Badge(content string, color Color, icon string = "") Container {
        let badge = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 5,
            Height: 20,
            Padding: Edges{Left: 6, Right: 6},
            BorderWidth: 1,
            BorderColor: color,
            BorderRadius: 3,
            FlexShrink: 0
        }
        if icon.Length > 0 {
            badge.Add(MaterialIcons.Create(icon, 12, color))
        }
        badge.Add(Label(content, 11.5, color, ""))
        return badge
    }

    func Status(content string, color Color, icon string = "") Container {
        let status = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 6, FlexShrink: 0}
        if icon.Length > 0 {
            status.Add(MaterialIcons.Create(icon, 14, color))
        }
        status.Add(Label(content, 12.5, color, ""))
        return status
    }

    func DialogRoot(dialog ModalDialog, backdrop Goo.Button, panel Container) Container -> Container{
        Position: PositionType.Absolute,
        Left: 0,
        Right: 0,
        Top: 0,
        Bottom: 0,
        AlignItems: AlignItems.Center,
        JustifyContent: JustifyContent.Center,
        OnPointerDown: (event PointerEvent) -> touch(),
        OnWheel: (event WheelEvent) -> touch()
    }

    func Copyable(label string, value string, shown string, clearAfterMs float64 = 120000) Blob {
        let copied = ReadOnlySpan[char](ClipboardText).SequenceEqual(System.MemoryExtensions.AsSpan(value))
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            Gap: 8,
            FlexShrink: 0,
            Grow(
                Container{
                    Gap: 6,
                    Label(Strings.Get(label), 12, Body),
                    Text{Content: shown, FontFamily: Font, FontSize: 13, Color: Ink, TextWrap: TextWrap.Wrap}
                }
            ),
            IconButton{
                Icon: MaterialIcons.Create(copied ? "check": "content_copy", 16, copied ? Lime: Body),
                AccessibilityName: Strings.Get("Copy") + " " + Strings.Get(label),
                OnClick: () -> {
                    Copy(value, clearAfterMs)
                    rebuild()
                }
            }.Build()
        }
    }

    func Accent(color Color, content Blob) Blob -> Container{
        BorderWidth: Edges{Left: 3},
        BorderColor: color,
        Padding: Edges{Left: 12},
        MinWidth: 0,
        content
    }

    func Button(
        content string,
        action Action,
        disabled bool = false,
        primary bool = false,
        autoFocus bool = false
    ) Blob {
        let theme = Theme.Read()
        let style = if primary {
            theme.PrimaryButton
        } else {
            theme.Button
        }
        let busy = primary && Working()
        let button = (
            style with{
                Content = Strings.Get(content),
                OnClick = action,
                Disabled = disabled || busy,
                DisabledBackgroundColor = busy ? style.BackgroundColor: style.DisabledBackgroundColor,
                DisabledTextColor = busy ? Color.Transparent: Dim,
                FontFamily = Font
            }
        ).Build()
        button.AutoFocus = autoFocus
        return Container{
            Position: PositionType.Relative,
            button,
            if busy && playbackActive() {
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

    func Entry(field TextField) Blob -> (
        field with{
            Width = Percent(100),
            EntryHeight = 38,
            BorderRadius = 8,
            BackgroundColor = Color.Parse("#080808"),
            BorderColor = Color.Parse("#2a2a2a"),
            FontFamily = Font
        }
    ).Build()

    func Meter(used int32, limit int32, counted bool) Blob {
        let share = Math.Min(float64(used) / limit, 1.0)
        let color = if share >= 1 {
            Pink
        } else if share >= 0.75 {
            Orange
        } else {
            Dim
        }
        let track = PathBuilder(0, 0, 18, 18)
        let arc = PathBuilder(0, 0, 18, 18)
        for step in 0 ... 33 {
            let turn = step / 32.0 * Math.PI * 2
            let sweep = turn * share - Math.PI / 2
            if step == 0 {
                track.MoveTo(16, 9)
                arc.MoveTo(9 + 7 * Math.Cos(sweep), 9 + 7 * Math.Sin(sweep))
            } else {
                track.LineTo(9 + 7 * Math.Cos(turn), 9 + 7 * Math.Sin(turn))
                arc.LineTo(9 + 7 * Math.Cos(sweep), 9 + 7 * Math.Sin(sweep))
            }
        }
        let meter = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 6,
            FlexShrink: 0,
            Accessibility: Accessibility{
                Role: AccessibilityRole.ProgressBar,
                Name: Strings.Get("Memo bytes") + " " + used.ToString() + "/" + limit.ToString()
            }
        }
        if counted && share >= 0.75 {
            meter.Add(Label((limit - used).ToString(), 11.5, color, ""))
        }
        meter.Add(
            Container{
                Width: 18,
                Height: 18,
                Shape{
                    Position: PositionType.Absolute,
                    Width: 18,
                    Height: 18,
                    Path: track.Build(),
                    Fit: ShapeFit.Fill,
                    BorderWidth: 2,
                    BorderColor: Color.Parse("#1f1f1f")
                },
                Shape{
                    Position: PositionType.Absolute,
                    Width: 18,
                    Height: 18,
                    Path: arc.Build(),
                    Fit: ShapeFit.Fill,
                    BorderWidth: 2,
                    BorderColor: used > 0 ? color: Color.Transparent
                }
            }
        )
        return meter
    }

    func ActionRow(children[]Blob) Blob {
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

    func UpgradeTimeline(status NodeStatus, span float64) Blob {
        let style = DateTimeStyles.None
        if !DateTime.TryParseExact(
            status.UpgradeDate,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            style,
            out let date
        ) ||
            !DateTime
            .TryParseExact(
            status.UpgradeDeadline,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            style,
            out let deadline
        ) {
            return Container{}
        }
        let end = float64(CoreRelease.UpgradeHeight) + (deadline - date).TotalDays * 288
        let now = status.Syncing ? 0.0: Math.Min(span, span * status.Height / end)
        let upgrade = span * CoreRelease.UpgradeHeight / end
        let bar = Container{
            Width: span,
            Height: 8,
            Accessibility: Accessibility{
                Name: (status.Syncing ? "": Count(status.Height) + " / ") +
                    Count(CoreRelease.UpgradeHeight) +
                    " · " +
                    status.UpgradeDeadline
            },
            Container{Position: PositionType.Absolute, Width: now, Height: 8, BorderRadius: 2, BackgroundColor: Lime}
        }
        if upgrade > now {
            let dashes = PathBuilder(0, 0, upgrade - now, 8)
            var dash = 0.0
            while dash < upgrade - now {
                let right = Math.Min(dash + 6, upgrade - now)
                dashes.MoveTo(dash, 0).LineTo(right, 0).LineTo(right, 8).LineTo(dash, 8).Close()
                dash += 10
            }
            bar.Add(
                Shape{
                    Position: PositionType.Absolute,
                    Left: now,
                    Width: upgrade - now,
                    Height: 8,
                    Path: dashes.Build(),
                    Fit: ShapeFit.Fill,
                    BackgroundColor: Orange
                }
            )
        }
        let stripes = PathBuilder(0, 0, span - upgrade, 8)
        var x = -8.0
        while x < span - upgrade {
            stripes.MoveTo(x, 8).LineTo(x + 8, 0).LineTo(x + 12, 0).LineTo(x + 4, 8).Close()
            x += 10
        }
        bar.Add(
            Container{
                Position: PositionType.Absolute,
                Left: upgrade,
                Width: span - upgrade,
                Height: 8,
                BorderRadius: 2,
                Overflow: Overflow.Hidden,
                BackgroundColor: Color.Parse("#3a0026"),
                Shape{
                    Width: span - upgrade,
                    Height: 8,
                    Path: stripes.Build(),
                    Fit: ShapeFit.Fill,
                    BackgroundColor: Pink
                }
            }
        )
        bar.Add(
            Container{
                Position: PositionType.Absolute,
                Left: now - 1,
                Top: -5,
                Width: 2,
                Height: 18,
                BackgroundColor: Lime
            }
        )
        bar.Add(
            Container{
                Position: PositionType.Absolute,
                Left: upgrade - 1,
                Top: -5,
                Width: 2,
                Height: 18,
                BackgroundColor: Orange
            }
        )
        return bar
    }
}
