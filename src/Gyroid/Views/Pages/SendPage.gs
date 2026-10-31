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
        let compact = input.Height < 700
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
        let card = WalletParts.Card(ui, compact ? 18.0: 22.0, compact ? 13.0: 16.0, 14)
        card.Width = Percent(100)
        card.MaxWidth = Math.Clamp((multi ? 780.0: 600.0) + Math.Max(0, input.Height - 640) * 0.6, 600.0, 900.0)
        card.MaxHeight = Percent(100)
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Gap: 12,
                FlexShrink: 0,
                Label(ui, ui.Strings.Get("send"), 17, ui.Ink, ""),
                if input.Snapshot.Balance?.Spendable != nil {
                    Figure(ui, "Spendable", WalletText.Amount(ui.Privacy, spendable), ui.Ink, 14, "")
                } else {
                    Container{}
                }
            }
        )
        if multi {
            let size = Math.Clamp(input.Height * 0.05, 28.0, 64.0)
            let sum = Hidden(ui.Privacy, WalletAmount.Format(total))
            card.Add(Hero(input, Label(ui, sum, size, ui.Lime, ""), sum.Length, size))
            let list = Container{Gap: 8, MinHeight: 0, FlexShrink: 1, OverflowY: Overflow.Scroll}
            for index in 0 ... rows.Count {
                list.Add(Recipient(input, index))
            }
            card.Add(list)
        } else {
            let size = Math.Clamp(input.Height * 0.07, 36.0, 100.0)
            card.Add(Hero(input, Amount(input, over, size), rows[0].Amount.Length, size))
            let amountIssue = WalletValidation.AmountIssue(rows[0].Amount)
            if amountIssue.Length > 0 {
                card.Add(Status(ui, ui.Strings.Get(amountIssue), ui.Pink, "warning"))
            }
            card.Add(Container{Gap: 10, FlexShrink: 0, AddressField(input, rows[0]), MemoField(input, rows[0])})
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
                    over ? ui.Pink: ui.Ink,
                    14,
                    ""
                )
            }
        )
        let review = Button(ui, "Review", form.Submit, !form.CanSubmit, true, reviewFocus)
        reviewFocus = false
        review.MinWidth = 140
        let addRecipient = Goo
            .Button{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            Height: 30,
            Padding: Edges{Left: 6, Right: 6},
            BorderRadius: 6,
            Disabled: input.Busy,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get("Add recipient")},
            OnClick: () -> {
                rows.Add(SendRow())
                Rebuild()
            },
            MaterialIcons.Create("add", 16, ui.Lime),
            Label(ui, ui.Strings.Get("recipient"), 14, ui.Lime, "")
        }
        WidgetKeyBindings.BindActivation(addRecipient)
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Gap: 12,
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
            Gap: 14,
            FlexShrink: 0,
            Padding: Edges{
                Top: Math.Clamp(input.Height * 0.032, 4.0, 60.0),
                Bottom: Math.Clamp(input.Height * 0.032, 4.0, 60.0)
            },
            Container{
                Width: Percent(100),
                TextAlign: TextAlign.Center,
                amount,
                Container{
                    Position: PositionType.Absolute,
                    Left: Percent(50),
                    Bottom: size * 0.25,
                    Margin: Edges{Left: Math.Max(1, digits) * size * 0.3 + 12},
                    Label(ui, "BNT", 15, ui.Dim, "")
                }
            }
        }
        if rows.Count == 1 {
            let spendable = input.Snapshot.Balance?.Spendable ?? uint64(0)
            hero.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: 8,
                    Share(input, "25%", spendable, () -> Fill(spendable / 4)),
                    Share(input, "50%", spendable, () -> Fill(spendable / 2)),
                    Share(input, "max", spendable, () -> Maximum(input))
                }
            )
        } else {
            hero.Padding = Edges{
                Top: Math.Clamp(input.Height * 0.01, 0.0, 10.0),
                Bottom: Math.Clamp(input.Height * 0.01, 0.0, 10.0)
            }
        }
        return hero
    }

    private func Amount(input SendPageInput, over bool, size float64) Blob {
        let ui = input.Ui
        let row = rows[0]
        return form.Bind(
            TextField{
                AccessibilityName: ui.Strings.Get("Amount"),
                Value: row.Amount,
                Controlled: true,
                Placeholder: "0",
                Password: input.Privacy,
                Disabled: input.Busy,
                FontFamily: ui.Font,
                FontSize: size,
                TextColor: over ? ui.Pink: ui.Lime,
                BackgroundColor: Color.Transparent,
                BorderWidth: 0,
                FocusRingWidth: 0,
                PaddingHorizontal: 0,
                EntryHeight: size * 1.25,
                Width: Percent(100),
                OnChange: value -> {
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
            input.Contacts.TryGetValue(text, out let destination) ? destination: text
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

    private func Share(input SendPageInput, label string, atoms uint64, click Action) Blob {
        let ui = input.Ui
        let button = Goo
            .Button{
            Height: 28,
            Padding: Edges{Left: 14, Right: 14},
            JustifyContent: JustifyContent.Center,
            BorderWidth: 1,
            BorderColor: ui.FieldEdge,
            BorderRadius: 6,
            BackgroundColor: ui.Black,
            Disabled: input.Busy || atoms == 0,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get(label)},
            OnClick: click,
            Label(ui, ui.Strings.Get(label), 12, ui.Body, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Recipient(input SendPageInput, index int32) Blob {
        let ui = input.Ui
        let row = rows[index]
        let memoUsed = Encoding.UTF8.GetByteCount(row.Memo)
        let line = Container{
            Gap: 8,
            FlexShrink: 0,
            ZIndex: rows.Count - index,
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexStart,
                Gap: 8,
                Container{
                    Width: 18,
                    Height: 38,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Label(ui, (index + 1).ToString(), 12, ui.Dim, "")
                },
                Grow(AddressField(input, row)),
                Container{
                    Width: 150,
                    TextAlign: TextAlign.Right,
                    FlexShrink: 0,
                    form.Entry(
                        TextField{
                            AccessibilityName: ui.Strings.Get("Amount") + " " + (index + 1).ToString(),
                            Value: row.Amount,
                            Controlled: true,
                            Password: input.Privacy,
                            Disabled: input.Busy,
                            Invalid: WalletValidation.AmountIssue(row.Amount).Length > 0,
                            Trailing: Label(ui, "BNT", 12, ui.Dim, ""),
                            OnChange: value -> {
                                row.Amount = value.Trim()
                                Rebuild()
                            }
                        }
                    )
                },
                ExpandButton(
                    ui,
                    if memoUsed > 0 {
                        Meter(ui, memoUsed, WalletValidation.MemoLimit, false)
                    } else {
                        MaterialIcons.Create("notes", 16, ui.Dim)
                    },
                    "Memo",
                    row.MemoOpen,
                    input.Busy,
                    () -> {
                        row.MemoOpen = !row.MemoOpen
                        Rebuild()
                    }
                ),
                ExpandButton(
                    ui,
                    MaterialIcons.Create("close", 16, ui.Dim),
                    "Remove recipient",
                    false,
                    input.Busy,
                    () -> {
                        rows.RemoveAt(index)
                        Rebuild()
                    }
                )
            }
        }
        if row.MemoOpen {
            line.Add(Container{Padding: Edges{Left: 26, Right: 76}, MemoField(input, row)})
        }
        return line
    }

    private func AddressField(input SendPageInput, row SendRow) Blob {
        let ui = input.Ui
        let text = row.Address.Trim()
        let issue = Issue(input, text)
        let kind = Kind(input, text)
        let trailing = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, MinWidth: 0}
        if kind == "contact" {
            trailing.Add(Label(ui, Hidden(ui.Privacy, Short(input.Contacts[text])), 14, ui.Dim, ""))
        }
        if issue.Length > 0 {
            trailing.Add(MaterialIcons.Create("warning", 16, ui.Pink))
        } else if kind.Length > 0 {
            trailing.Add(MaterialIcons.Create("check", 16, ui.Mint))
        } else if text.Length == 0 && input.Contacts.Count > 0 {
            trailing.Add(
                ExpandButton(
                    ui,
                    MaterialIcons.Create("menu_book", 16, ui.Body),
                    "contacts",
                    row.Suggest,
                    input.Busy,
                    () -> {
                        row.Suggest = !row.Suggest
                        Rebuild()
                    }
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
                    TextColor: kind == "handle" ? ui.Blue: ui.Ink,
                    Leading: switch kind {
                        case "contact": MaterialIcons.Create("person", 14, ui.Dim)
                        case "handle": MaterialIcons.Create("alternate_email", 14, ui.Blue)
                        default: nil
                    },
                    Trailing: trailing,
                    OnChange: value -> {
                        row.Address = value
                        row.Suggest = true
                        Rebuild()
                    }
                }
            )
        }
        if input.Privacy || !row.Suggest || kind.Length > 0 || issue.Length > 0 {
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
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 10,
                Height: 36,
                Padding: Edges{Left: 10, Right: 10},
                BorderRadius: 7,
                Hover: Style{BackgroundColor: ui.Rule},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{Role: AccessibilityRole.ListItem, Name: name},
                OnClick: () -> {
                    row.Address = name
                    row.Suggest = false
                    Rebuild()
                },
                MaterialIcons.Create("person", 14, ui.Dim),
                Grow(
                    Text{
                        Content: name,
                        StyleRanges: []TextStyleRange{TextStyleRange(TextRange(0, text.Length), Style{Color: ui.Lime})},
                        FontFamily: ui.Font,
                        FontSize: 14,
                        Color: ui.Ink,
                        TextWrap: TextWrap.NoWrap,
                        TextTrimming: TextTrimming.Ellipsis
                    }
                ),
                Label(ui, Short(destination), 13, ui.Dim, "")
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
                    Gap: 6,
                    Width: Math.Max(240.0, row.Anchor.BorderBox.Width),
                    Padding: 6,
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
                Leading: Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 6,
                    Label(ui, ui.Strings.Get("Memo"), 12, ui.Body, ""),
                    Label(ui, ui.Strings.Get("(optional)"), 12, ui.Dim, "")
                },
                Trailing: Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 6,
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
        let bar = Container{FlexDirection: FlexDirection.Row, Height: 8, Gap: 2, FlexShrink: 0}
        var total = Add(fee, change)
        for amount in amounts {
            total = Add(total, amount)
        }
        if input.Privacy || spendable == 0 {
            bar.Add(BarSegment(1, ui.Unallocated))
            return bar
        }
        if total > spendable {
            bar.Add(BarSegment(float64(spendable), ui.Lime))
            bar.Add(BarSegment(float64(total - spendable), ui.Pink))
            return bar
        }
        for index in 0 ... amounts.Length {
            if amounts[index] == 0 {
                continue
            }
            let segment = BarSegment(float64(amounts[index]), ui.Lime)
            if amounts.Length < 2 || input.Window == nil {
                bar.Add(segment)
                continue
            }
            let lines = Container{Gap: 4}
            for other in 0 ... amounts.Length {
                lines.Add(
                    Container{
                        FlexDirection: FlexDirection.Row,
                        JustifyContent: JustifyContent.SpaceBetween,
                        Gap: 24,
                        Label(ui, Name(input, rows[other].Address), 12.5, other == index ? ui.Ink: ui.Dim, ""),
                        Label(ui, WalletAmount.Format(amounts[other]), 12.5, other == index ? ui.Ink: ui.Dim, "")
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
                        Placement: PortalPlacement.Top,
                        RootStyle: Style{FlexGrow: float64(amounts[index]), FlexBasis: 0, MinWidth: 3}
                    }
                )
            )
        }
        if fee > 0 {
            bar.Add(BarSegment(0, ui.Orange))
        }
        if change > 0 {
            bar.Add(BarSegment(float64(change), ui.Mint))
        }
        bar.Add(BarSegment(float64(spendable - total), ui.Unallocated))
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
            BorderWidth: Edges{Top: 1},
            BorderColor: ui.Selected
        }
        for index in 0 ... pending.Recipients.Length {
            list.Add(Recipient(input, pending, index))
        }
        let remaining = spendable - Math.Min(spendable, pending.Total)
        let content = Container{
            Gap: compact ? 14.0: 18.0,
            MinHeight: 0,
            FlexShrink: 1,
            Container{
                Gap: 6,
                FlexShrink: 0,
                Label(ui, ui.Strings.Get("send"), 14, ui.Dim, ""),
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Baseline,
                    Gap: 10,
                    Label(
                        ui,
                        WalletText.Amount(ui.Privacy, pending.Total),
                        Math.Clamp(input.Height * 0.05, 28.0, 40.0),
                        ui.Lime,
                        ""
                    ),
                    Label(ui, "BNT", 14, ui.Dim, "")
                }
            },
            list,
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
                Gap: 24,
                FlexShrink: 0,
                Figure(ui, "Fee", WalletText.Amount(ui.Privacy, pending.Fee), ui.Orange, 14, ""),
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 2,
                    Figure(ui, "Change", WalletText.Amount(ui.Privacy, pending.Change), ui.Mint, 14, ""),
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
                Figure(ui, "Remaining", WalletText.Amount(ui.Privacy, remaining), ui.Ink, 14, "")
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
                Padding: compact ? 20.0: 24.0,
                BackgroundColor: ui.Raised,
                BorderRadius: 14,
                Content: content,
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
        let head = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 10, MinWidth: 0}
        if input.Contacts.ContainsKey(typed) {
            head.Add(Label(ui, Hidden(ui.Privacy, typed), 14, ui.Ink, ""))
        }
        if handle.Length > 0 {
            head.Add(Label(ui, Hidden(ui.Privacy, handle), 14, ui.Blue, ""))
            head.Add(MaterialIcons.Create("check", 14, ui.Mint))
        }
        head.Add(
            Grow(
                Label(
                    ui,
                    Hidden(ui.Privacy, Short(recipient.Address)),
                    14,
                    head.Children.Count > 0 ? ui.Dim: ui.Ink,
                    ""
                )
            )
        )
        head.Add(Label(ui, WalletText.Amount(ui.Privacy, recipient.Amount), 15, ui.Ink, ""))
        head.Add(MaterialIcons.Create(expanded ? "expand_less": "expand_more", 14, ui.Dim))
        let entry = Goo
            .Button{
            Gap: 6,
            AlignItems: AlignItems.Stretch,
            FlexShrink: 0,
            Padding: Edges{Top: 11, Bottom: 11, Left: expanded ? 10.0: 4.0, Right: expanded ? 10.0: 4.0},
            BorderRadius: expanded ? 8.0: 0.0,
            BackgroundColor: expanded ? ui.Field: Color.Transparent,
            BorderWidth: Edges{Bottom: 1},
            BorderColor: ui.Selected,
            Hover: Style{BackgroundColor: ui.Field},
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
                    Gap: 8,
                    MinWidth: 0,
                    MaterialIcons.Create("notes", 13, ui.Dim),
                    Grow(
                        Text{
                            Content: Hidden(ui.Privacy, recipient.Memo),
                            FontFamily: ui.Font,
                            FontSize: 12.5,
                            Color: ui.Dim,
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
                        []TextStyleRange{TextStyleRange(TextRange(first, last - first), Style{Color: ui.Body})}
                    },
                    FontFamily: ui.Font,
                    FontSize: 12.5,
                    Color: ui.Ink,
                    TextWrap: TextWrap.Wrap
                }
            )
            if handle.Length > 0 {
                entry.Add(Status(ui, ui.Strings.Get("signed by blocknet.id"), ui.Mint, "check"))
            }
        }
        return entry
    }

    private func Name(input SendPageInput, value string) string {
        let text = value.Trim()
        return if input.Contacts.ContainsKey(text) || text.StartsWith("$", StringComparison.Ordinal) {
            text
        } else {
            Short(text)
        }
    }

    private func Kind(input SendPageInput, value string) string {
        let text = value.Trim()
        return if text.Length == 0 || Issue(input, text).Length > 0 {
            ""
        } else if input.Contacts.ContainsKey(text) {
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
        if text.Length == 0 {
            return ""
        }
        let destination = input.Contacts.TryGetValue(text, out let address) ? address: text
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
                Address: if input.Contacts.TryGetValue(row.Address.Trim(), out let destination) {
                    destination
                } else {
                    row.Address.Trim()
                },
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
