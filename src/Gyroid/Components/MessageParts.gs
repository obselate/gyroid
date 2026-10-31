package Gyroid.Components

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Gyroid.Components.ControlParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import Gyroid.Views
import System
import System.Collections.Generic
import System.Linq

class MessageSlide(From float64, Delay float64) : Simulation {
    override func Position(time float64) float64 {
        let elapsed = Math.Max(0.0, time - Delay)
        if elapsed < 0.26 {
            return From * Math.Pow(1 - elapsed / 0.26, 3)
        }
        let t = Math.Clamp((elapsed - 0.26) / 0.16, 0.0, 1.0) * 4
        return if t < 1 {
            6 * t
        } else if t < 2 {
            6 - 9 * (t - 1)
        } else if t < 3 {
            -3 + 4 * (t - 2)
        } else {
            4 - t
        }
    }

    override func Velocity(elapsed float64) float64 -> 0

    override func Done(elapsed float64) bool -> elapsed >= Delay + 0.42
}

data struct MessageBubbleInput {
    var Ui Presentation
    var Message Message
    var Group bool
    var First bool
    var Last bool
    var ShowState bool
    var Animate bool
    var Highlight bool
    var CanRetry bool
    var Width float64
    var OnOpen Action
    var OnRetry Action
    var Handle ElementHandle
}

class MessageBubble : Cell[MessageBubbleInput] {
    private let shift Anim[Point]
    private var started bool
    private var hovered bool

    init() {
        shift = AnimateValue(Point{X: 0, Y: 0})
    }

    protected override func Build(input MessageBubbleInput) Blob {
        let ui = input.Ui
        let message = input.Message
        if !started {
            started = true
            if input.Animate {
                let from = message.Outgoing ? input.Width: -input.Width
                shift.Snap(Point{X: from, Y: 0})
                shift.To(
                    Point{X: 0, Y: 0},
                    (start, end, velocity) -> MessageSlide(start, message.Outgoing ? 0.16: 0.0),
                    Motion.Tween(0, Easing.Linear)
                )
            }
        }
        if !ui.Actions.playbackActive() {
            shift.Snap(Point{X: 0, Y: 0})
        }
        let invalid = message.Verification == Verification.Invalid
        let verification = switch message.Verification {
            case Verification.Checking: "Checking"
            case Verification.Unverified: "Unverified"
            case Verification.Invalid: "Invalid"
            case Verification.Verified: "Verified"
        }
        let color = invalid ? ui.Pink: message.Verification == Verification.Unverified ? ui.Orange: ui.Dim
        let column = Container{
            Handle: input.Handle,
            FlexShrink: 0,
            MinWidth: 0,
            Gap: 3,
            Margin: Edges{Top: input.First ? 12.0: 2.0},
            AlignItems: message.Outgoing ? AlignItems.FlexEnd: AlignItems.FlexStart,
            TranslateAnim: shift
        }
        if input.Group && input.First && !message.Outgoing {
            column.Add(Label(ui, Hidden(ui.Privacy, message.SenderName), 11, color, ""))
        }
        let bubble = Goo
            .Button{
            MaxWidth: Percent(70),
            MinWidth: 0,
            Padding: Edges{Left: 13, Right: 13, Top: 9, Bottom: 9},
            BorderRadius: 18,
            BorderBottomLeftRadius: input.Last && !message.Outgoing ? 4.0: 18.0,
            BorderBottomRightRadius: input.Last && message.Outgoing ? 4.0: 18.0,
            BorderWidth: invalid || input.Highlight ? 2.0: 0.0,
            BorderColor: invalid ? ui.Pink: ui.Blue,
            BackgroundColor: message.Outgoing ? ui.Lime: ui.Rule,
            OnPointerEnter: (event PointerEvent) -> {
                hovered = true
                Rebuild()
            },
            OnPointerLeave: (event PointerEvent) -> {
                hovered = false
                Rebuild()
            },
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: Hidden(ui.Privacy, message.Text) +
                    " " +
                    message
                    .SentAt
                    .ToLocalTime()
                    .ToString("HH:mm") +
                    " " +
                    ui
                    .Strings
                    .Get(verification)
            },
            OnClick: input.OnOpen,
            Text{
                Content: Hidden(ui.Privacy, message.Text),
                FontFamily: ui.Font,
                FontSize: 13,
                Color: message.Outgoing ? ui.Black: ui.Ink,
                TextWrap: TextWrap.Wrap,
                MinWidth: 0
            }
        }
        WidgetKeyBindings.BindActivation(bubble)
        column.Add(bubble)
        if hovered {
            column.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Right: 0,
                    Top: -12,
                    AlignItems: message.Outgoing ? AlignItems.FlexEnd: AlignItems.FlexStart,
                    HitTestSelf: false,
                    Label(ui, message.SentAt.ToLocalTime().ToString("HH:mm"), 10, ui.Dim, "")
                }
            )
        }
        if !message.Outgoing && message.Verification != Verification.Verified && (!input.Group || input.First) {
            column.Add(Label(ui, ui.Strings.Get(verification), 10, color, ""))
        }
        if message.State == MessageState.Failed {
            column.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    Label(ui, ui.Strings.Get("Not sent"), 11, ui.Pink, ""),
                    Button(ui, "Retry", input.OnRetry, !input.CanRetry)
                }
            )
        } else if message.Outgoing && input.ShowState {
            let state = switch message.State {
                case MessageState.InProgress: ui.Strings.Get("In progress")
                case MessageState.Pending: ui.Strings.Get("Pending") + " ~" + Math.Max(
                    1.0,
                    Math.Ceiling(message.EtaSeconds / 60)
                )
                    .ToString("0") + " " + ui.Strings.Get("min")
                case MessageState.Confirmed: ui.Strings.Get("Confirmed") + " " + Math.Min(10, message.Confirmations)
                    .ToString() + "/10"
                case MessageState.Failed: ui.Strings.Get("Not sent")
            }
            column.Add(
                Label(
                    ui,
                    state,
                    11,
                    message.State == MessageState.Confirmed ? ui.Dim: message.State == MessageState.Pending ? ui.Orange: ui.Blue,
                    ""
                )
            )
        }
        return column
    }
}

data struct MessageComposerInput {
    var Ui Presentation
    var Session WalletSession
    var Conversation Conversation
    var Draft string
    var Width float64
    var OnDraft Action[string]
    var OnSend Action[string]
}

class MessageComposer : Cell[MessageComposerInput], IDisposable {
    private let arrow Anim[Point]
    private let fill Anim[float64]
    private var ready bool
    private var sending bool
    private var initialized bool
    private var timer WindowTimer?

    init() {
        arrow = AnimateValue(Point{X: 0, Y: 36})
        fill = AnimateValue(0.0)
    }

    func Dispose() {
        timer?.Dispose()
    }

    private func Send(input MessageComposerInput, enabled bool) {
        if !enabled || sending {
            return
        }
        let text = input.Draft
        sending = true
        input.OnDraft("")
        let animate = input.Ui.Actions.playbackActive()
        if animate {
            arrow.To(Point{X: 0, Y: -36}, Motion.Tween(0.16, Easing.EaseIn))
        } else {
            arrow.Set(Point{X: 0, Y: -36})
        }
        input.OnSend(text)
        timer?.Dispose()
        timer = input
            .Ui
            .Actions
            .Delay(
            animate ? 160.0: 0.0,
            () -> {
                sending = false
                ready = false
                arrow.Set(Point{X: 0, Y: 36})
                if animate {
                    fill.To(0, Motion.Tween(0.2, Easing.Linear))
                } else {
                    fill.Set(0)
                }
                Rebuild()
            }
        )
        Rebuild()
    }

    protected override func Build(input MessageComposerInput) Blob {
        let ui = input.Ui
        let mode = input.Session.Messages.Mode
        let recipient = input.Conversation.Members.Any(member -> member != input.Session.Messages.OwnAddress)
        if mode != MessengerMode.Send || !recipient {
            return Container{
                Padding: 14,
                FlexShrink: 0,
                Label(
                    ui,
                    ui.Strings.Get(
                        input
                            .Session
                            .Snapshot
                            .State == WalletState.Locked ? "Wallet is locked": input
                            .Session
                            .Snapshot
                            .ViewOnly ? "View-only wallet": !recipient ? "No recipient": "Node not connected"
                    ),
                    12,
                    ui.Dim,
                    ""
                )
            }
        }
        let estimate = input.Session.Messages.Measure(input.Conversation, input.Draft)
        let hasText = !String.IsNullOrWhiteSpace(input.Draft)
        let enabled = hasText && estimate.Fits
        let animate = ui.Actions.playbackActive()
        if !initialized || !animate {
            initialized = true
            ready = hasText
            if !sending {
                arrow.Snap(Point{X: 0, Y: hasText ? 0.0: 36.0})
                fill.Snap(hasText ? 1.0: 0.0)
            }
        } else if !sending && hasText != ready {
            ready = hasText
            arrow.To(
                Point{X: 0, Y: hasText ? 0.0: 36.0},
                Motion.Tween(hasText ? 0.18: 0.14, hasText ? Easing.EaseOut: Easing.EaseIn)
            )
            fill.To(hasText ? 1.0: 0.0, Motion.Tween(hasText ? 0.18: 0.14, Easing.Linear))
        }
        let send Action = () -> Send(input, enabled)
        let rows = Math.Clamp(
            1 + input.Draft.Count(character -> character == '\n') +
                int32(input.Draft.Length / Math.Max(18.0, (input.Width - 100) / 8)),
            1,
            5
        )
        let field = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexEnd,
            Padding: 5,
            Gap: 6,
            BorderWidth: 1,
            BorderRadius: 12,
            BorderColor: estimate.Fits ? ui.Edge: ui.Pink,
            BackgroundColor: ui.Black,
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                Cell.Mount[TextAreaInput, TextArea](
                    "draft",
                    TextAreaInput{
                        Value: input.Draft,
                        OnChange: input.OnDraft,
                        Placeholder: ui.Strings.Get("Message"),
                        AccessibilityName: ui.Strings.Get("Message"),
                        Wrap: TextWrap.Wrap,
                        Width: Percent(100),
                        Height: rows * 19.0 + 14,
                        MinimumRows: 1,
                        MinimumHeight: 33,
                        FontSize: 13,
                        FontFamily: ui.Font,
                        BackgroundColor: ui.Black,
                        TextColor: ui.Ink,
                        CreateEditor: (value, editor) -> {
                            editor.BorderWidth = 0
                            editor.Padding = Edges{Left: 8, Right: 4, Top: 7, Bottom: 7}
                            editor.KeyBindings = []KeyBinding{
                                KeyBinding{Key: Key.Enter, Action: send},
                                KeyBinding{Key: Key.KeypadEnter, Action: send}
                            }
                            return editor
                        }
                    }
                )
            }
        }
        let button = Goo
            .Button{
            Width: 34,
            Height: 34,
            FlexShrink: 0,
            BorderRadius: 8,
            Overflow: Overflow.Hidden,
            BackgroundColor: ui.Rule,
            Disabled: !enabled || sending,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get("Send message")},
            OnClick: send,
            Container{
                Position: PositionType.Absolute,
                Left: 0,
                Right: 0,
                Top: 0,
                Bottom: 0,
                BackgroundColor: estimate.Fits ? ui.Lime: ui.Pink,
                OpacityAnim: fill
            },
            Container{
                Position: PositionType.Absolute,
                Left: 8,
                Top: 8,
                TranslateAnim: arrow,
                MaterialIcons.Create("arrow_upward", 18, ui.Black)
            }
        }
        WidgetKeyBindings.BindActivation(button)
        field.Add(button)
        let recipients = Math.Max(
            1,
            input.Conversation.Members.Count(member -> member != input.Session.Messages.OwnAddress)
        )
        let bytes = estimate.BytesUsed / recipients
        let lap = Math.Clamp((Math.Max(1, bytes) - 1) / 124, 0, 4)
        let color = switch lap {
            case 0: ui.Lime
            case 1: ui.Blue
            case 2: ui.Mint
            case 3: ui.Violet
            default: ui.Orange
        }
        let track = switch lap {
            case 0: ui.Rule
            case 1: ui.Lime
            case 2: ui.Blue
            case 3: ui.Mint
            default: ui.Violet
        }
        let ring = Ring((bytes - lap * 124) / 124.0, estimate.Fits ? color: ui.Pink, estimate.Fits ? track: ui.Pink)
        return Container{
            Padding: 14,
            Gap: 6,
            FlexShrink: 0,
            BorderWidth: Edges{Top: 1},
            BorderColor: ui.Rule,
            field,
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 7,
                ring,
                Label(
                    ui,
                    estimate.Outputs.ToString() + " " + ui.Strings.Get("memos"),
                    11,
                    estimate.Fits ? ui.Dim: ui.Pink,
                    ""
                )
            }
        }
    }
}
