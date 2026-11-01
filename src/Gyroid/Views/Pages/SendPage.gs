package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Linq
import System.Text
import System.Threading.Tasks

class SendRow {
    var Address string = ""
    var Amount string = ""
    var Memo string = ""
    var MemoOpen bool
    var Suggest bool
    let Anchor ElementHandle = ElementHandle()
}

data struct SendPageInput {
    var Session WalletSession
    var Rows List[SendRow]
    var Ui Presentation
    var Window Window?
    var Snapshot WalletSnapshot
    var Contacts SortedDictionary[string, string]
    var Network string
    var Privacy bool
    var Busy bool
    var Language string
    var Animate bool
    var Height float64
    var OnSent Action
}

class SendPage : Cell[SendPageInput] {
    private var rows List[SendRow]
    private var reviewFocus bool
    private var form WalletForm

    private var estimate SendEstimate?

    private var sent SendEstimate?

    private var result SendResult?

    private var openRow int32 = -1

    protected override func Build(input SendPageInput) Blob {
        rows = input.Rows
        if rows.Count == 0 {
            rows.Add(SendRow())
        }
        let ui = input.Ui
        let spendable = input.Snapshot.Balance?.Spendable ?? uint64(0)
        let multi = rows.Count > 1
        var total uint64 = 0
        var ready = !input.Busy
        for row in rows {
            let atoms = Atoms(row.Amount)
            total = Add(total, atoms ?? uint64(0))
            ready = ready && atoms != nil && Kind(input, row.Address).Length > 0 && WalletValidation.MemoIssue(row.Memo)
                .Length == 0
        }
        let over = total > spendable
        form = WalletForm(ui, ready && !over && total > 0, () -> Review(input), []string{})
        let maxWidth = Math.Clamp((multi ? 780.0: 600.0) + Math.Max(0, input.Height - 640) * 0.6, 600.0, 900.0)
        let card = WalletParts.PageCard(ui, maxWidth, input.Height, maxWidth, true)
        card.Add(
            WalletParts.Header(
                Label(ui, ui.Strings.Get("send"), AppTheme.Type17, AppTheme.Ink, ""),
                AppTheme.Space12,
                if input.Snapshot.Balance?.Spendable != nil {
                    Figure(ui, "Spendable", WalletText.Amount(ui.Privacy, spendable), AppTheme.Ink, AppTheme.Type14, "")
                } else {
                    Container{}
                }
            )
        )
        if multi {
            let size = AppTheme.GetTotalSize(input.Height)
            let sum = Hidden(ui.Privacy, WalletAmount.Format(total))
            card.Add(Hero(input, Label(ui, sum, size, AppTheme.Lime, ""), sum.Length, size))
            let list = Container{Gap: AppTheme.Space8, MinHeight: 0, FlexShrink: 1, OverflowY: Overflow.Scroll}
            for index in 0 ... rows.Count {
                list.Add(Recipient(input, index))
            }
            card.Add(ListParts.Viewport(list, grow: false))
        } else {
            let size = AppTheme.GetAmountSize(input.Height)
            card.Add(Hero(input, Amount(input, over, size), rows[0].Amount.Length, size))
            let amountIssue = WalletValidation.AmountIssue(rows[0].Amount)
            if amountIssue.Length > 0 {
                card.Add(Status(ui, ui.Strings.Get(amountIssue), AppTheme.Pink, "warning"))
            }
            card.Add(
                Container{Gap: AppTheme.Space10, FlexShrink: 0, AddressField(input, rows[0]), MemoField(input, rows[0])}
            )
        }
        card.Add(Bar(input, rows.Select((row SendRow) -> Atoms(row.Amount) ?? uint64(0)).ToArray(), 0, 0, spendable))
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.FlexEnd,
                FlexShrink: 0,
                Figure(
                    ui,
                    "Remaining",
                    if over {
                        "−" + WalletText.Amount(ui.Privacy, total - spendable)
                    } else {
                        WalletText.Amount(ui.Privacy, spendable - total)
                    },
                    over ? AppTheme.Pink: AppTheme.Ink,
                    AppTheme.Type14,
                    ""
                )
            }
        )
        let review = Button(ui, "Review", form.Submit, !form.CanSubmit, true, reviewFocus, input.Busy)
        reviewFocus = false
        review.MinWidth = 140
        let addRecipient = ControlParts.Button(
            ui,
            "recipient",
            () -> {
                rows.Add(SendRow())
                Rebuild()
            },
            input.Busy,
            busy: false,
            appearance: AppTheme.CompactButton with{
                BackgroundColor = Color.Transparent,
                BorderWidth = AppTheme.Border0,
                TextColor = AppTheme.Lime,
                Leading = MaterialIcons.Create("add", AppTheme.Icon16, input.Busy ? AppTheme.Dim: AppTheme.Lime),
                AccessibilityName = ui.Strings.Get("Add recipient")
            }
        )
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Gap: AppTheme.Space12,
                FlexShrink: 0,
                addRecipient,
                review
            }
        )
        if let shown = sent, let outcome = result {
            card.Add(
                Cell.Mount[SendTraceInput, SendTrace](
                    "trace",
                    SendTraceInput{
                        Ui: ui,
                        Estimate: shown,
                        Result: outcome,
                        Sends: input.Snapshot.Sends,
                        Animate: input.Animate,
                        Privacy: input.Privacy,
                        Language: input.Language,
                        OnClose: () -> {
                            sent = nil
                            result = nil
                            Rebuild()
                        }
                    }
                )
            )
        }
        if let pending = estimate {
            card.Add(Confirm(input, pending, spendable))
        }
        return card
    }

    private func Hero(input SendPageInput, amount Blob, digits int32, size float64) Blob {
        let ui = input.Ui
        let hero = Container{
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space14,
            FlexShrink: 0,
            Padding: Edges{Top: AppTheme.GetHeroPadding(input.Height), Bottom: AppTheme.GetHeroPadding(input.Height)},
            Container{
                Width: Percent(100),
                TextAlign: TextAlign.Center,
                amount,
                Container{
                    Position: PositionType.Absolute,
                    Left: Percent(50),
                    Bottom: size * 0.25,
                    Margin: Edges{Left: Math.Max(1, digits) * size * 0.3 + AppTheme.Space12},
                    Label(ui, "BNT", AppTheme.Type14, AppTheme.Dim, "")
                }
            }
        }
        if rows.Count == 1 {
            let spendable = input.Snapshot.Balance?.Spendable ?? uint64(0)
            hero.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: AppTheme.Space8,
                    Share(input, "25%", spendable, () -> Fill(spendable / 4)),
                    Share(input, "50%", spendable, () -> Fill(spendable / 2)),
                    Share(input, "max", spendable, () -> Maximum(input))
                }
            )
        } else {
            hero.Padding = Edges{
                Top: AppTheme.GetAmountPadding(input.Height),
                Bottom: AppTheme.GetAmountPadding(input.Height)
            }
        }
        return hero
    }

    private func Amount(input SendPageInput, over bool, size float64) Blob {
        let ui = input.Ui
        let row = rows[0]
        return form.Bind(
            AppTheme.FieldInput with{
                AccessibilityName = ui.Strings.Get("Amount"),
                Value = row.Amount,
                Controlled = true,
                Placeholder = "0",
                Password = input.Privacy,
                Disabled = input.Busy,
                FontSize = size,
                TextColor = over ? AppTheme.Pink: AppTheme.Lime,
                BackgroundColor = Color.Transparent,
                BorderWidth = AppTheme.Border0,
                FocusRingWidth = AppTheme.Border0,
                PaddingHorizontal = AppTheme.Space0,
                EntryHeight = size * 1.25,
                Width = Percent(100),
                OnChange = value -> {
                    row.Amount = value.Trim()
                    Rebuild()
                }
            }
        )
            .Build()
    }

    private func Fill(atoms uint64) {
        rows[0].Amount = WalletAmount.Format(atoms)
        Rebuild()
    }

    private func Maximum(input SendPageInput) {
        let row = rows[0]
        let text = row.Address.Trim()
        let address = if Kind(input, text).Length > 0 {
            AddressBook.Resolve(input.Contacts, text)
        } else {
            input.Snapshot.Address
        }
        var amount uint64
        input
            .Ui
            .Actions
            .Run(
            async (ct) -> {
                amount = await input.Session.Send.MaximumAsync([]WalletRecipient{}, address, row.Memo, ct)
            },
            () -> Fill(amount)
        )
    }

    private func Share(input SendPageInput, label string, atoms uint64, click Action) Blob -> ControlParts.Button(
        input.Ui,
        label,
        click,
        input.Busy || atoms == 0,
        busy: false,
        appearance: AppTheme.CompactButton with{BackgroundColor = AppTheme.Black, TextColor = AppTheme.Body}
    )

    private func Recipient(input SendPageInput, index int32) Blob {
        let ui = input.Ui
        let row = rows[index]
        let memoUsed = Encoding.UTF8.GetByteCount(row.Memo)
        let line = Container{
            Gap: AppTheme.Space8,
            FlexShrink: 0,
            ZIndex: rows.Count - index,
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexStart,
                Gap: AppTheme.Space8,
                Container{
                    Width: 18,
                    Height: AppTheme.ControlRegular,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Label(ui, (index + 1).ToString(), AppTheme.Type12, AppTheme.Dim, "")
                },
                Grow(AddressField(input, row)),
                Container{
                    Width: 150,
                    TextAlign: TextAlign.Right,
                    FlexShrink: 0,
                    form.Amount(
                        TextField{
                            AccessibilityName: ui.Strings.Get("Amount") + " " + (index + 1).ToString(),
                            Value: row.Amount,
                            Controlled: true,
                            Password: input.Privacy,
                            Disabled: input.Busy,
                            Invalid: WalletValidation.AmountIssue(row.Amount).Length > 0,
                            OnChange: value -> {
                                row.Amount = value.Trim()
                                Rebuild()
                            }
                        }
                    )
                },
                Icon(
                    ui,
                    if memoUsed > 0 {
                        Meter(ui, memoUsed, WalletValidation.MemoLimit, false)
                    } else {
                        MaterialIcons.Create("notes", AppTheme.Icon16, AppTheme.Dim)
                    },
                    ui.Strings.Get("Memo"),
                    () -> {
                        row.MemoOpen = !row.MemoOpen
                        Rebuild()
                    },
                    input.Busy,
                    row.MemoOpen,
                    AppTheme.ControlCompact,
                    AppTheme.DisclosureStyle,
                    row.MemoOpen
                ),
                Icon(
                    ui,
                    MaterialIcons.Create("close", AppTheme.Icon16, AppTheme.Dim),
                    ui.Strings.Get("Remove recipient"),
                    () -> {
                        rows.RemoveAt(index)
                        Rebuild()
                    },
                    input.Busy,
                    size: AppTheme.ControlCompact,
                    style: AppTheme.DisclosureStyle
                )
            }
        }
        if row.MemoOpen {
            line.Add(
                Container{
                    Padding: Edges{Left: AppTheme.Space24, Right: AppTheme.ControlRegular * 2},
                    MemoField(input, row)
                }
            )
        }
        return line
    }

    private func AddressField(input SendPageInput, row SendRow) Blob {
        let ui = input.Ui
        let text = row.Address.Trim()
        let issue = Issue(input, text)
        let kind = Kind(input, text)
        let trailing = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            MinWidth: 0
        }
        if kind == "contact" {
            trailing.Add(Label(ui, Hidden(ui.Privacy, Short(input.Contacts[text])), AppTheme.Type14, AppTheme.Dim, ""))
        }
        if issue.Length > 0 {
            trailing.Add(MaterialIcons.Create("warning", AppTheme.Icon16, AppTheme.Pink))
        } else if kind.Length > 0 {
            trailing.Add(MaterialIcons.Create("check", AppTheme.Icon16, AppTheme.Mint))
        } else if text.Length == 0 && input.Contacts.Count > 0 {
            trailing.Add(
                Icon(
                    ui,
                    MaterialIcons.Create("menu_book", AppTheme.Icon16, AppTheme.Body),
                    ui.Strings.Get("contacts"),
                    () -> {
                        row.Suggest = !row.Suggest
                        Rebuild()
                    },
                    input.Busy,
                    row.Suggest,
                    AppTheme.ControlCompact,
                    AppTheme.DisclosureStyle,
                    row.Suggest
                )
            )
        }
        let field = Container{
            MinWidth: 0,
            Handle: row.Anchor,
            form.Entry(
                TextField{
                    AccessibilityName: ui.Strings.Get("Recipient"),
                    Placeholder: ui.Strings.Get("address, contact or $$id"),
                    Value: row.Address,
                    Controlled: true,
                    Password: input.Privacy,
                    Disabled: input.Busy,
                    Invalid: issue.Length > 0,
                    IssueText: if issue.Length > 0 {
                        ui.Strings.Explain(issue)
                    } else {
                        nil
                    },
                    TextColor: kind == "handle" ? AppTheme.Blue: AppTheme.Ink,
                    Leading: switch kind {
                        case "contact": MaterialIcons.Create("person", AppTheme.Icon14, AppTheme.Dim)
                        case "handle": MaterialIcons.Create("alternate_email", AppTheme.Icon14, AppTheme.Blue)
                        default: nil
                    },
                    Trailing: trailing,
                    OnChange: value -> {
                        if let payment = PaymentLink.Parse(value) {
                            row.Address = payment.Address
                            row.Amount = payment.Amount
                            row.Memo = payment.Memo
                            row.MemoOpen = payment.Memo.Length > 0
                            row.Suggest = false
                        } else {
                            row.Address = value
                            row.Suggest = true
                        }
                        Rebuild()
                    }
                }
            )
        }
        if input.Privacy || !row.Suggest || kind.Length > 0 {
            return field
        }
        let matches = input
            .Contacts
            .Where(
            (entry KeyValuePair[string, string]) -> entry.Key.StartsWith(text, StringComparison.OrdinalIgnoreCase)
        )
            .Take(5)
            .ToArray()
        if matches.Length == 0 {
            return field
        }
        let list = Container{
            Accessibility: Accessibility{Role: AccessibilityRole.List, Name: ui.Strings.Get("contacts")}
        }
        for (name, destination) in matches {
            let button = Goo
                .Button{
                BasedOn: AppTheme.ListRowStyle,
                Height: AppTheme.ControlRegular,
                Padding: Edges{Left: AppTheme.Space10, Right: AppTheme.Space10},
                BorderRadius: AppTheme.Radius8,
                BorderWidth: AppTheme.Border0,
                Hover: Style{BackgroundColor: AppTheme.Rule},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{Role: AccessibilityRole.ListItem, Name: name},
                OnClick: () -> {
                    row.Address = name
                    row.Suggest = false
                    Rebuild()
                },
                MaterialIcons.Create("person", AppTheme.Icon14, AppTheme.Dim),
                Grow(
                    Text{
                        Content: name,
                        StyleRanges: []TextStyleRange{
                            TextStyleRange(TextRange(0, text.Length), Style{Color: AppTheme.Lime})
                        },
                        FontFamily: AppTheme.Font,
                        FontSize: AppTheme.Type14,
                        Color: AppTheme.Ink,
                        TextWrap: TextWrap.NoWrap,
                        TextTrimming: TextTrimming.Ellipsis
                    }
                ),
                Label(ui, Short(destination), AppTheme.Type13, AppTheme.Dim, "")
            }
            WidgetKeyBindings.BindActivation(button)
            list.Add(button)
        }
        field.Add(
            Cell.Mount[PopoverInput, Popover](
                "suggest",
                PopoverInput{
                    Open: true,
                    Anchor: row.Anchor,
                    Placement: PopoverPlacement.BottomStart,
                    Gap: AppTheme.Space6,
                    Width: Math.Max(240.0, row.Anchor.BorderBox.Width),
                    CreatePanel: (value, bounds, content) -> Container{
                        BasedOn: AppTheme.TooltipStyle,
                        Padding: AppTheme.Space6
                    },
                    TakeFocus: false,
                    Content: list,
                    AccessibilityName: ui.Strings.Get("contacts"),
                    OnDismiss: reason -> {
                        row.Suggest = false
                        Rebuild()
                    }
                }
            )
        )
        return field
    }

    private func MemoField(input SendPageInput, row SendRow) Blob {
        let ui = input.Ui
        let issue = WalletValidation.MemoIssue(row.Memo)
        return form.Entry(
            TextField{
                AccessibilityName: ui.Strings.Get("Memo"),
                Value: row.Memo,
                Controlled: true,
                Password: input.Privacy,
                Disabled: input.Busy,
                Invalid: issue.Length > 0,
                IssueText: if issue.Length > 0 {
                    ui.Strings.Explain(issue)
                } else {
                    nil
                },
                Leading: Label(ui, ui.Strings.Get("Memo"), AppTheme.Type12, AppTheme.Body, ""),
                Trailing: Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space6,
                    Meter(ui, Encoding.UTF8.GetByteCount(row.Memo), WalletValidation.MemoLimit, true),
                    Cell.Mount[InfoTipInput, InfoTip](
                        "memo-info",
                        InfoTipInput{
                            Ui: ui,
                            Topic: "About memos",
                            Lines: []string{
                                "Use this optional note for a payment reference, invoice number or message (up to 124 UTF-8 bytes).",
                                "It is encrypted on chain for the recipient.",
                                "The sender keeps a copy in their wallet."
                            },
                            Language: input.Language,
                            Width: 300
                        }
                    )
                },
                OnChange: value -> {
                    row.Memo = value
                    Rebuild()
                }
            }
        )
    }

    private func Bar(input SendPageInput, amounts[]uint64, fee uint64, change uint64, spendable uint64) Blob {
        let ui = input.Ui
        let bar = Container{
            FlexDirection: FlexDirection.Row,
            Height: AppTheme.Track8,
            Gap: AppTheme.Space2,
            FlexShrink: 0
        }
        var total = Add(fee, change)
        for amount in amounts {
            total = Add(total, amount)
        }
        if input.Privacy || spendable == 0 {
            bar.Add(BarSegment(1, AppTheme.Edge))
            return bar
        }
        if total > spendable {
            bar.Add(BarSegment(float64(spendable), AppTheme.Lime))
            bar.Add(BarSegment(float64(total - spendable), AppTheme.Pink))
            return bar
        }
        for index in 0 ... amounts.Length {
            if amounts[index] == 0 {
                continue
            }
            let segment = BarSegment(float64(amounts[index]), AppTheme.Lime)
            if amounts.Length < 2 || input.Window == nil {
                bar.Add(segment)
                continue
            }
            let lines = Container{Gap: AppTheme.Space4}
            for other in 0 ... amounts.Length {
                lines.Add(
                    Container{
                        FlexDirection: FlexDirection.Row,
                        JustifyContent: JustifyContent.SpaceBetween,
                        Gap: AppTheme.Space24,
                        Label(
                            ui,
                            Name(input, rows[other].Address),
                            AppTheme.Type13,
                            other == index ? AppTheme.Ink: AppTheme.Dim,
                            ""
                        ),
                        Label(
                            ui,
                            WalletAmount.Format(amounts[other]),
                            AppTheme.Type13,
                            other == index ? AppTheme.Ink: AppTheme.Dim,
                            ""
                        )
                    }
                )
            }
            bar.Add(
                Cell.Mount[TooltipInput, Tooltip](
                    "share" + index.ToString(),
                    TooltipInput{
                        Window: input.Window,
                        Target: segment,
                        Content: lines,
                        BubbleStyle: AppTheme.PassiveTooltipStyle,
                        Placement: PortalPlacement.Top,
                        RootStyle: Style{FlexGrow: float64(amounts[index]), FlexBasis: 0, MinWidth: 3}
                    }
                )
            )
        }
        if fee > 0 {
            bar.Add(BarSegment(0, AppTheme.Orange))
        }
        if change > 0 {
            bar.Add(BarSegment(float64(change), AppTheme.Mint))
        }
        bar.Add(BarSegment(float64(spendable - total), AppTheme.Edge))
        return bar
    }

    private func Confirm(input SendPageInput, pending SendEstimate, spendable uint64) Blob {
        let ui = input.Ui
        let compact = input.Height < 700
        let close Action = () -> {
            estimate = nil
            openRow = -1
            reviewFocus = true
            Rebuild()
        }
        let list = Container{
            MinHeight: 0,
            FlexShrink: 1,
            OverflowY: Overflow.Scroll,
            BorderWidth: Edges{Top: AppTheme.Border1},
            BorderColor: AppTheme.Rule
        }
        for index in 0 ... pending.Recipients.Length {
            list.Add(Recipient(input, pending, index))
        }
        let remaining = spendable - Math.Min(spendable, pending.Total)
        let content = Container{
            Gap: compact ? AppTheme.Space14: AppTheme.Space16,
            MinHeight: 0,
            FlexShrink: 1,
            WalletParts.Header(
                Label(
                    ui,
                    WalletText.Amount(ui.Privacy, pending.Total),
                    AppTheme.GetReviewAmountSize(input.Height),
                    AppTheme.Lime,
                    ""
                ),
                AppTheme.Space10,
                value: Label(ui, "BNT", AppTheme.Type14, AppTheme.Dim, ""),
                alignment: AlignItems.Baseline
            ),
            ListParts.Viewport(list, grow: false),
            Bar(
                input,
                pending.Recipients.Select((recipient WalletRecipient) -> recipient.Amount).ToArray(),
                pending.Fee,
                pending.Change,
                spendable
            ),
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space24,
                FlexShrink: 0,
                Figure(ui, "Fee", WalletText.Amount(ui.Privacy, pending.Fee), AppTheme.Orange, AppTheme.Type14, ""),
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space2,
                    Figure(
                        ui,
                        "Change",
                        WalletText.Amount(ui.Privacy, pending.Change),
                        AppTheme.Mint,
                        AppTheme.Type14,
                        ""
                    ),
                    Cell.Mount[InfoTipInput, InfoTip](
                        "change",
                        InfoTipInput{
                            Ui: ui,
                            Topic: "About change",
                            Lines: changeLines,
                            Language: input.Language,
                            Width: 280
                        }
                    )
                },
                Container{FlexGrow: 1},
                Figure(ui, "Remaining", WalletText.Amount(ui.Privacy, remaining), AppTheme.Ink, AppTheme.Type14, "")
            }
        }
        return WalletParts.Modal(
            ui,
            "confirm-send",
            ModalDialog{
                Open: true,
                Preset: ModalDialogPreset.Confirm,
                AccessibilityName: ui.Strings.Get("Confirm send"),
                Width: 640,
                MaxHeight: Percent(100),
                Padding: compact ? AppTheme.Space20: AppTheme.Space22,
                Content: content,
                Footer: ActionRow(
                    []Blob{
                        ControlParts.Button(ui, "Cancel", close, busy: false),
                        ControlParts.Button(ui, "Send", () -> Submit(input), input.Busy, true, busy: input.Busy)
                    }
                ),
                ConfirmText: ui.Strings.Get("Send"),
                CancelText: ui.Strings.Get("Cancel"),
                ConfirmDisabled: input.Busy,
                OnConfirm: () -> Submit(input),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private let changeLines[]string = []string{"Returns to this wallet. Spendable after 10 confirmations"}

    private func Recipient(input SendPageInput, pending SendEstimate, index int32) Blob {
        let ui = input.Ui
        let recipient = pending.Recipients[index]
        let handle = pending.Handles[index]
        let expanded = openRow == index
        let typed = rows[index].Address.Trim()
        let head = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            MinWidth: 0
        }
        if Kind(input, typed) == "contact" {
            head.Add(Label(ui, Hidden(ui.Privacy, typed), AppTheme.Type14, AppTheme.Ink, ""))
        }
        if handle.Length > 0 {
            head.Add(Label(ui, Hidden(ui.Privacy, handle), AppTheme.Type14, AppTheme.Blue, ""))
            head.Add(MaterialIcons.Create("check", AppTheme.Icon14, AppTheme.Mint))
        }
        head.Add(
            Grow(
                Label(
                    ui,
                    Hidden(ui.Privacy, Short(recipient.Address)),
                    AppTheme.Type14,
                    head.Children.Count > 0 ? AppTheme.Dim: AppTheme.Ink,
                    ""
                )
            )
        )
        head.Add(Label(ui, WalletText.Amount(ui.Privacy, recipient.Amount), AppTheme.Type14, AppTheme.Ink, ""))
        head.Add(MaterialIcons.Create(expanded ? "expand_less": "expand_more", AppTheme.Icon14, AppTheme.Dim))
        let entry = Goo
            .Button{
            BasedOn: AppTheme.ListRowStyle,
            FlexDirection: FlexDirection.Column,
            Gap: AppTheme.Space6,
            AlignItems: AlignItems.Stretch,
            FlexShrink: 0,
            Padding: Edges{
                Top: AppTheme.Space12,
                Bottom: AppTheme.Space12,
                Left: expanded ? AppTheme.Space10: AppTheme.Space4,
                Right: expanded ? AppTheme.Space10: AppTheme.Space4
            },
            BorderRadius: expanded ? AppTheme.Radius8: AppTheme.Radius0,
            BackgroundColor: expanded ? AppTheme.Raised: Color.Transparent,
            BorderColor: AppTheme.Rule,
            Hover: Style{BackgroundColor: AppTheme.Raised},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get("Recipient") + " " + (index + 1).ToString(),
                Expanded: expanded
            },
            OnClick: () -> {
                openRow = expanded ? -1: index
                Rebuild()
            },
            head
        }
        WidgetKeyBindings.BindActivation(entry)
        if recipient.Memo.Length > 0 {
            entry.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: expanded ? AlignItems.FlexStart: AlignItems.Center,
                    Gap: AppTheme.Space8,
                    MinWidth: 0,
                    MaterialIcons.Create("notes", AppTheme.Icon16, AppTheme.Dim),
                    Grow(
                        Text{
                            Content: Hidden(ui.Privacy, recipient.Memo),
                            FontFamily: AppTheme.Font,
                            FontSize: AppTheme.Type13,
                            Color: AppTheme.Dim,
                            TextWrap: expanded ? TextWrap.Wrap: TextWrap.NoWrap,
                            TextTrimming: TextTrimming.Ellipsis
                        }
                    )
                }
            )
        }
        if expanded {
            let grouped = Grouped(recipient.Address)
            let first = grouped.IndexOf(' ')
            let last = grouped.LastIndexOf(' ')
            entry.Add(
                Text{
                    Content: Hidden(ui.Privacy, grouped),
                    StyleRanges: if input.Privacy || first < 0 {
                        []TextStyleRange{}
                    } else {
                        []TextStyleRange{TextStyleRange(TextRange(first, last - first), Style{Color: AppTheme.Body})}
                    },
                    FontFamily: AppTheme.Font,
                    FontSize: AppTheme.Type13,
                    Color: AppTheme.Ink,
                    TextWrap: TextWrap.Wrap
                }
            )
            if handle.Length > 0 {
                entry.Add(Status(ui, ui.Strings.Get("signed by blocknet.id"), AppTheme.Mint, "check"))
            }
        }
        return entry
    }

    private func Name(input SendPageInput, value string) string {
        let text = value.Trim()
        return if Kind(input, text) == "contact" || text.StartsWith("$", StringComparison.Ordinal) {
            text
        } else {
            Short(text)
        }
    }

    private func Kind(input SendPageInput, value string) string {
        let text = value.Trim()
        return if text.Length == 0 || Issue(input, text).Length > 0 {
            ""
        } else if !AddressBook.IsDestination(text) && PaymentLink.Parse(text) == nil && input.Contacts.ContainsKey(
            text
        ) {
            "contact"
        } else if text.StartsWith("$", StringComparison.Ordinal) {
            "handle"
        } else if text.Length >= 64 {
            "address"
        } else {
            ""
        }
    }

    private func Issue(input SendPageInput, text string) string {
        if text.Length == 0 || !input.Contacts.ContainsKey(text) &&
            input
            .Contacts
            .Keys
            .Any((name string) -> name.StartsWith(text, StringComparison.OrdinalIgnoreCase)) {
            return ""
        }
        let destination = AddressBook.Resolve(input.Contacts, text)
        try {
            if destination.StartsWith("$", StringComparison.Ordinal) {
                BlocknetIdService.Normalize(destination)
                return ""
            }
            return WalletValidation.AddressIssue(WalletValidation.ValidateAddress(destination), input.Network)
        } catch (error WalletException) {
            return error.Message
        }
    }

    private func Atoms(text string) uint64? {
        try {
            return WalletAmount.Parse(text)
        } catch (error WalletException) {
            return nil
        }
    }

    private func Add(left uint64, right uint64) uint64 -> if left > uint64.MaxValue - right {
        uint64.MaxValue
    } else {
        left + right
    }

    private func Review(input SendPageInput) {
        let requests = rows.Select(
            (row SendRow) -> WalletRecipient{
                Address: AddressBook.Resolve(input.Contacts, row.Address),
                Amount: Atoms(row.Amount) ?? uint64(0),
                Memo: row.Memo
            }
        )
            .ToArray()
        var task Task[SendEstimate]
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                task = input.Session.Send.EstimateAsync(requests, ct)
                return task
            },
            () -> {
                estimate = task.Result
                Rebuild()
            }
        )
    }

    private func Submit(input SendPageInput) {
        guard let pending = estimate else {
            return
        }
        if input.Busy {
            return
        }
        estimate = nil
        openRow = -1
        var task Task[SendResult]
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                task = input.Session.Send.SubmitAsync(pending, ct)
                return task
            },
            () -> {
                rows.Clear()
                rows.Add(SendRow())
                if task.Result.Fee > 0 {
                    sent = pending
                    result = task.Result
                } else {
                    sent = nil
                    result = nil
                }
                Rebuild()
                input.OnSent()
            }
        )
    }
}
