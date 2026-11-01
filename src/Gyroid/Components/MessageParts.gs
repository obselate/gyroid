package Gyroid.Components

import Goo
import Goo.Widgets
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Gyroid.Components.ControlParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services.WalletText
import Gyroid.Views
import System
import System.Collections.Generic
import System.Linq

class MessageParts {
    shared {
        func Problem(ui Presentation, issue string) Blob -> Banner{
            Content: ui.Strings.Explain(issue),
            AccessibilityName: ui.Strings.Explain(issue),
            BackgroundColor: AppTheme.PinkQuiet,
            BorderColor: AppTheme.Pink,
            TextColor: AppTheme.Pink,
            BorderRadius: AppTheme.Radius8,
            BorderWidth: AppTheme.Border1,
            FontFamily: AppTheme.Font,
            FontSize: AppTheme.Type12,
            MinHeight: AppTheme.Space0,
            PaddingHorizontal: AppTheme.Space10,
            PaddingVertical: AppTheme.Space8
        }.Build()
    }
}

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
    var Animate bool
    var Highlight bool
    var CanRetry bool
    var Width float64
    var Revision int64
    var Privacy bool
    var Language string
    var OnOpen Action[Message]
    var OnRetry Action[Message]
    var Handle ElementHandle
}

class MessageBubble : Cell[MessageBubbleInput] {
    private let shift Anim[Point]
    private var started bool

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
        let verification = message.Verification.ToString()
        let color = invalid ? AppTheme.Pink: message.Verification == Verification.Unverified ? AppTheme.Orange: AppTheme.Dim
        let time = (message.Outgoing ? message.SentAt: message.ArrivedAt ?? message.SentAt).ToLocalTime().ToString(
            "HH:mm"
        )
        let delivered = message.State == MessageState.Confirmed && message.Confirmations > 0
        let statusColor = message.Outgoing ? AppTheme.Black.WithAlpha(0.9): AppTheme.Body
        let metadata = Container{
            FlexDirection: FlexDirection.Row,
            JustifyContent: JustifyContent.FlexEnd,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space4,
            Text{
                Content: time,
                FontFamily: AppTheme.Font,
                FontSize: AppTheme.Type11,
                FontWeight: AppTheme.WeightBold,
                Color: statusColor
            }
        }
        if message.Outgoing && message.State != MessageState.Failed {
            let tip = delivered ? ui
                .Strings
                .Get("Delivered {time}, block {height}")
                .Replace("{time}", (message.ArrivedAt ?? message.SentAt).ToLocalTime().ToString("HH:mm"))
                .Replace("{height}", message.Height.ToString()): ui
                .Strings
                .Get("Waiting for the next block. Usually about 5 min, sometimes longer")
            metadata.Add(
                Cell.Mount[TooltipInput, Tooltip](
                    "status-tip",
                    TooltipInput{
                        Window: ui.Actions.window,
                        DelayMs: 0,
                        Placement: PortalPlacement.BottomEnd,
                        Target: Container{
                            HitTestSelf: true,
                            Accessibility: Accessibility{Role: AccessibilityRole.Text, Name: tip},
                            MaterialIcons.Create(
                                delivered ? "done_all": message.State == MessageState.InProgress ? "schedule": "done",
                                AppTheme.Icon16,
                                statusColor
                            )
                        },
                        Content: Text{
                            Content: tip,
                            FontFamily: AppTheme.Font,
                            FontSize: AppTheme.Type12,
                            Color: AppTheme.Body,
                            TextWrap: TextWrap.Wrap,
                            MaxWidth: 246
                        }
                    }
                )
            )
        }
        let column = Container{
            Handle: input.Handle,
            FlexShrink: 0,
            MinWidth: 0,
            Gap: AppTheme.Space4,
            Margin: Edges{Top: input.First ? AppTheme.Space12: AppTheme.Space2},
            AlignItems: message.Outgoing ? AlignItems.FlexEnd: AlignItems.FlexStart,
            TranslateAnim: shift
        }
        if input.Group && input.First && !message.Outgoing {
            column.Add(Label(ui, Hidden(ui.Privacy, message.SenderName), AppTheme.Type11, color, ""))
        }
        let bubble = Goo
            .Button{
            BasedOn: AppTheme.BubbleStyle,
            MaxWidth: Math.Max(0, (input.Width - 2 * AppTheme.Space16) * 0.7),
            MinWidth: 0,
            BorderBottomLeftRadius: input.Last && !message.Outgoing ? 4.0: 18.0,
            BorderBottomRightRadius: input.Last && message.Outgoing ? 4.0: 18.0,
            BorderWidth: invalid || input.Highlight ? AppTheme.Border2: AppTheme.Border0,
            BorderColor: invalid ? AppTheme.Pink: AppTheme.Blue,
            BackgroundColor: message.Outgoing ? AppTheme.Lime: AppTheme.Rule,
            Gap: AppTheme.Space4,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: Hidden(ui.Privacy, message.Text) + " " + time + " " + ui.Strings.Get(verification)
            },
            OnClick: () -> input.OnOpen(message),
            Text{
                Content: Hidden(ui.Privacy, message.Text),
                FontFamily: AppTheme.Font,
                FontSize: AppTheme.Type13,
                Color: message.Outgoing ? AppTheme.Black: AppTheme.Ink,
                TextWrap: TextWrap.Wrap,
                MinWidth: 0
            },
            metadata
        }
        WidgetKeyBindings.BindActivation(bubble)
        column.Add(bubble)
        if !message.Outgoing && message.Verification != Verification.Verified && (!input.Group || input.First) {
            column.Add(Label(ui, ui.Strings.Get(verification), AppTheme.Type10, color, ""))
        }
        if message.State == MessageState.Failed {
            column.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space8,
                    Label(ui, ui.Strings.Get("Not sent"), AppTheme.Type11, AppTheme.Pink, ""),
                    Button(ui, "Retry", () -> input.OnRetry(message), !input.CanRetry)
                }
            )
        }
        return column
    }
}

data struct MessageComposerInput {
    var Ui Presentation
    var Recipients int32
    var CanSend bool
    var Unavailable string
    var Measure Func[string, MessageEstimate]
    var Language string
    var Revision int64
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
    private var draft string = ""

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
        let text = draft
        sending = true
        draft = ""
        input.OnDraft("")
        let animate = input.Ui.Actions.playbackActive()
        if animate {
            arrow.To(Point{X: 0, Y: -36}, Motion.Tween(160, Easing.EaseIn))
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
                    fill.To(0, Motion.Tween(200, Easing.Linear))
                } else {
                    fill.Set(0)
                }
                Rebuild()
            }
        )
        Rebuild()
    }

    protected override func Build(input MessageComposerInput) Blob {
        if !initialized {
            draft = input.Draft
        }
        let ui = input.Ui
        let recipient = input.Recipients > 0
        if !input.CanSend || !recipient {
            return Container{
                Padding: AppTheme.Space14,
                FlexShrink: 0,
                Label(
                    ui,
                    ui.Strings.Get(!recipient ? "No recipient": input.Unavailable),
                    AppTheme.Type12,
                    AppTheme.Dim,
                    ""
                )
            }
        }
        let estimate = input.Measure(draft)
        let hasText = !String.IsNullOrWhiteSpace(draft)
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
                Motion.Tween(hasText ? 180.0: 140.0, hasText ? Easing.EaseOut: Easing.EaseIn)
            )
            fill.To(hasText ? 1.0: 0.0, Motion.Tween(hasText ? 180.0: 140.0, Easing.Linear))
        }
        let send Action = () -> Send(input, enabled)
        let rows = Math.Clamp(
            1 + draft.Count(character -> character == '\n') +
                int32(draft.Length / Math.Max(18.0, (input.Width - 100) / 8)),
            1,
            5
        )
        let field = Container{
            BasedOn: AppTheme.ComposerStyle,
            BorderColor: estimate.Fits ? AppTheme.Edge: AppTheme.Pink,
            BackgroundColor: AppTheme.Black,
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                Cell.Mount[TextAreaInput, TextArea](
                    "draft",
                    TextAreaInput{
                        Value: draft,
                        OnChange: value -> {
                            draft = value
                            input.OnDraft(value)
                            Rebuild()
                        },
                        Placeholder: ui.Strings.Get("Message"),
                        AccessibilityName: ui.Strings.Get("Message"),
                        Wrap: TextWrap.Wrap,
                        Width: Percent(100),
                        Height: rows * 19.0 + 14,
                        MinimumRows: 1,
                        MinimumHeight: 33,
                        FontSize: AppTheme.Type13,
                        FontFamily: AppTheme.Font,
                        BackgroundColor: AppTheme.Black,
                        TextColor: AppTheme.Ink,
                        CreateEditor: (value, editor) -> {
                            editor.BorderWidth = AppTheme.Border0
                            editor.Padding = Edges{
                                Left: AppTheme.Space8,
                                Right: AppTheme.Space4,
                                Top: AppTheme.Space8,
                                Bottom: AppTheme.Space8
                            }
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
            BasedOn: AppTheme.IconButtonStyle,
            FlexShrink: 0,
            BorderRadius: AppTheme.Radius8,
            Overflow: Overflow.Hidden,
            BackgroundColor: AppTheme.Rule,
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
                BackgroundColor: estimate.Fits ? AppTheme.Lime: AppTheme.Pink,
                OpacityAnim: fill
            },
            Container{
                Position: PositionType.Absolute,
                Left: 8,
                Top: 8,
                TranslateAnim: arrow,
                MaterialIcons.Create("arrow_upward", AppTheme.Icon18, AppTheme.Black)
            }
        }
        WidgetKeyBindings.BindActivation(button)
        field.Add(button)
        let recipients = Math.Max(1, input.Recipients)
        let bytes = estimate.BytesUsed / recipients
        let lap = Math.Clamp((Math.Max(1, bytes) - 1) / 124, 0, 4)
        let color = switch lap {
            case 0: AppTheme.Lime
            case 1: AppTheme.Blue
            case 2: AppTheme.Mint
            case 3: AppTheme.Violet
            default: AppTheme.Orange
        }
        let track = switch lap {
            case 0: AppTheme.Rule
            case 1: AppTheme.Lime
            case 2: AppTheme.Blue
            case 3: AppTheme.Mint
            default: AppTheme.Violet
        }
        let ring = Ring(
            (bytes - lap * 124) / 124.0,
            estimate.Fits ? color: AppTheme.Pink,
            estimate.Fits ? track: AppTheme.Pink
        )
        let details = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            ring,
            Label(
                ui,
                estimate.Outputs.ToString() + " " + ui.Strings.Get(estimate.Outputs == 1 ? "memo": "memos"),
                AppTheme.Type11,
                estimate.Fits ? AppTheme.Dim: AppTheme.Pink,
                ""
            )
        }
        if !estimate.Fits {
            details.Add(Label(ui, ui.Strings.Get("Message exceeds the size limit"), AppTheme.Type11, AppTheme.Pink, ""))
        }
        return Container{
            Padding: AppTheme.Space14,
            Gap: AppTheme.Space6,
            FlexShrink: 0,
            BorderWidth: Edges{Top: AppTheme.Border1},
            BorderColor: AppTheme.Rule,
            field,
            details
        }
    }
}
