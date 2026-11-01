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
import System.Threading

class SendRow {
    let Id string = Guid.NewGuid().ToString("N")
    var Address string = ""
    var Amount string = ""
    var Memo string = ""
    var MemoOpen bool
    var Suggest bool
    let Anchor ElementHandle = ElementHandle()
}

data struct SendPageInput {
    var Session WalletSession
    var Wallet string
    var Endpoint string
    var CoreStarted int64
    var Rows List[SendRow]
    var Display SendDisplay
    var Spendable uint64?
    var Address string
    var Sends[]WalletSend
    var Animate bool
    var OnSent Action
}

data struct SendDisplay {
    var Ui Presentation
    var Window Window?
    var Contacts SortedDictionary[string, string]
    var Network string
    var Privacy bool
    var Busy bool
    var Language string
    var Height float64
}

data struct SendEditorInput {
    var Display SendDisplay
    var Row SendRow
    var Address string
    var Amount string
    var Memo string
    var MemoOpen bool
    var Suggest bool
    var Index int32
    var Count int32
    var Spendable uint64
    var Over bool
    var Submit Action
    var Changed Action
    var Remove Action[SendRow]
    var Maximum Action
}

class SendPage : Cell, IDisposable {
    private var input SendPageInput
    private var estimate SendEstimate?
    private var sent SendEstimate?
    private var result SendResult?
    private var reviewRows[]SendReviewRow = []SendReviewRow{}
    private var balanceAmounts[]uint64 = []uint64{}
    private var balanceRows[]SendReviewRow = []SendReviewRow{}
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var request CancellationTokenSource?
    private var generation int32
    private var canSubmit bool
    private var reviewFocus bool
    private let changed Action
    private let submit Action
    private let remove Action[SendRow]
    private let maximum Action

    init() {
        changed = () -> Rebuild()
        submit = () -> Review()
        remove = row -> {
            input.Rows.Remove(row)
            Rebuild()
        }
        maximum = () -> Maximum()
    }

    public func Accept(next SendPageInput) {
        if next == input && input.Rows.Count > 0 {
            return
        }
        if input.Session != next.Session ||
            input
            .Display
            .Network != next
            .Display
            .Network ||
            input.Wallet != next.Wallet ||
            input.Endpoint != next.Endpoint ||
            input.CoreStarted != next.CoreStarted {
            generation++
            request?.Cancel()
            estimate = nil
            sent = nil
            result = nil
        }
        input = next
        if input.Rows.Count == 0 {
            input.Rows.Add(SendRow())
        }
        Rebuild()
    }

    public func Dispose() {
        generation++
        lifetime.Cancel()
        request?.Dispose()
        lifetime.Dispose()
    }

    override func Build() Blob {
        let display = input.Display
        let ui = display.Ui
        let spendable = input.Spendable ?? uint64(0)
        let multi = input.Rows.Count > 1
        var total uint64 = 0
        var ready = !display.Busy
        for row in input.Rows {
            let atoms = Atoms(row.Amount)
            total = Add(total, atoms ?? uint64(0))
            ready = ready && atoms != nil && SendRecipientEditor.Kind(display, row.Address)
                .Length > 0 &&
                WalletValidation
                .MemoIssue(row.Memo).Length == 0
        }
        let over = total > spendable
        canSubmit = ready && !over && total > 0
        let amounts = input.Rows.Select(row -> Atoms(row.Amount) ?? uint64(0)).ToArray()
        if !balanceAmounts.SequenceEqual(amounts) {
            balanceAmounts = amounts
        }
        let rows = input.Rows.Select(row -> SendReviewRow{Id: row.Id, Address: row.Address}).ToArray()
        if !balanceRows.SequenceEqual(rows) {
            balanceRows = rows
        }
        let maxWidth = Math.Clamp((multi ? 780.0: 600.0) + Math.Max(0, display.Height - 640) * 0.6, 600.0, 900.0)
        let card = WalletParts.PageCard(ui, maxWidth, display.Height, maxWidth, true)
        card.Add(
            Cell.Mount[SendSummaryInput, SendSummary](
                "summary",
                SendSummaryInput{
                    Ui: ui,
                    Privacy: display.Privacy,
                    Language: display.Language,
                    Spendable: input.Spendable
                }
            )
        )
        if multi {
            let size = AppTheme.GetTotalSize(display.Height)
            let sum = Hidden(ui.Privacy, WalletAmount.Format(total))
            card.Add(SendRecipientEditor.Hero(display, Label(ui, sum, size, AppTheme.Lime, ""), sum.Length, size, nil))
        }
        let list = Container{Gap: AppTheme.Space8, MinHeight: 0, FlexShrink: multi ? 1: 0}
        if multi {
            list.OverflowY = Overflow.Scroll
        }
        for index in 0 ... input.Rows.Count {
            let row = input.Rows[index]
            list.Add(
                Cell.Mount[SendEditorInput, SendRecipientEditor](
                    row.Id,
                    SendEditorInput{
                        Display: display,
                        Row: row,
                        Address: row.Address,
                        Amount: row.Amount,
                        Memo: row.Memo,
                        MemoOpen: row.MemoOpen,
                        Suggest: row.Suggest,
                        Index: index,
                        Count: input.Rows.Count,
                        Spendable: multi ? uint64(0): spendable,
                        Over: !multi && over,
                        Submit: submit,
                        Changed: changed,
                        Remove: remove,
                        Maximum: maximum
                    }
                )
            )
        }
        if multi {
            card.Add(ListParts.Viewport(list, grow: false))
        } else {
            card.Add(list)
        }
        card.Add(
            Cell.Mount[SendBalanceInput, SendBalance](
                "totals",
                SendBalanceInput{
                    Display: display,
                    Amounts: balanceAmounts,
                    Rows: balanceRows,
                    Spendable: spendable,
                    Total: total,
                    Remaining: true
                }
            )
        )
        let review = Button(ui, "Review", submit, !canSubmit, true, reviewFocus, display.Busy)
        reviewFocus = false
        review.MinWidth = 140
        let addRecipient = ControlParts.Button(
            ui,
            "recipient",
            () -> {
                input.Rows.Add(SendRow())
            },
            display.Busy,
            busy: false,
            appearance: AppTheme.CompactButton with{
                BackgroundColor = Color.Transparent,
                BorderWidth = AppTheme.Border0,
                TextColor = AppTheme.Lime,
                Leading = MaterialIcons.Create("add", AppTheme.Icon16, display.Busy ? AppTheme.Dim: AppTheme.Lime),
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
                        Sends: input.Sends,
                        Animate: input.Animate,
                        Privacy: display.Privacy,
                        Language: display.Language,
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
            card.Add(
                Cell.Mount[SendReviewInput, SendReview](
                    "review",
                    SendReviewInput{
                        Display: display,
                        Estimate: pending,
                        Rows: reviewRows,
                        Spendable: spendable,
                        Submit: () -> Submit(),
                        Close: () -> {
                            estimate = nil
                            reviewFocus = true
                            Rebuild()
                        }
                    }
                )
            )
        }
        return card
    }

    private func Atoms(text string) uint64? {
        try {
            return WalletAmount.Parse(text)
        } catch (error WalletException) {
            return nil
        }
    }

    shared {
        func Add(left uint64, right uint64) uint64 -> if left > uint64.MaxValue - right {
            uint64.MaxValue
        } else {
            left + right
        }
    }

    private func BeginRequest() CancellationToken {
        request?.Cancel()
        request?.Dispose()
        let current = CancellationTokenSource.CreateLinkedTokenSource(
            lifetime.Token,
            input.Display.Window?.Closed ?? default(CancellationToken)
        )
        request = current
        generation++
        return current.Token
    }

    private func Current(id int32, session WalletSession, network string, wallet string) bool ->
    id == generation &&
        session
        .Settings
        .Network == network &&
        session
        .Settings
        .ActiveWallet == wallet &&
        session
        .Settings
        .Endpoint == input.Endpoint &&
        session
        .Node
        .Api
        .verifiedStart == input.CoreStarted

    private func Review() {
        if !canSubmit {
            return
        }
        let session = input.Session
        let network = input.Display.Network
        let wallet = input.Wallet
        let token = BeginRequest()
        let id = generation
        let drafts = input.Rows.Select(row -> SendReviewRow{Id: row.Id, Address: row.Address}).ToArray()
        let requests = input
            .Rows
            .Select(
            row -> WalletRecipient{
                Address: AddressBook.Resolve(input.Display.Contacts, row.Address),
                Amount: Atoms(row.Amount) ?? uint64(0),
                Memo: row.Memo
            }
        )
            .ToArray()
        var found SendEstimate?
        input
            .Display
            .Ui
            .Actions
            .Run(
            async (ct) -> {
                using let linked = CancellationTokenSource.CreateLinkedTokenSource(token, ct)
                try {
                    found = await session.Send.EstimateAsync(requests, linked.Token)
                } catch (error OperationCanceledException) { }
            },
            () -> {
                if Current(id, session, network, wallet) {
                    estimate = found
                    reviewRows = drafts
                    Rebuild()
                }
            }
        )
    }

    private func Maximum() {
        let row = input.Rows[0]
        let display = input.Display
        let address = if SendRecipientEditor.Kind(display, row.Address).Length > 0 {
            AddressBook.Resolve(display.Contacts, row.Address.Trim())
        } else {
            input.Address
        }
        let memo = row.Memo
        let session = input.Session
        let network = display.Network
        let wallet = input.Wallet
        let token = BeginRequest()
        let id = generation
        var amount uint64
        input
            .Display
            .Ui
            .Actions
            .Run(
            async (ct) -> {
                using let linked = CancellationTokenSource.CreateLinkedTokenSource(token, ct)
                try {
                    amount = await session.Send.MaximumAsync([]WalletRecipient{}, address, memo, linked.Token)
                } catch (error OperationCanceledException) { }
            },
            () -> {
                if Current(id, session, network, wallet) {
                    row.Amount = WalletAmount.Format(amount)
                    Rebuild()
                }
            }
        )
    }

    private func Submit() {
        guard let pending = estimate else {
            return
        }
        if input.Display.Busy {
            return
        }
        estimate = nil
        let session = input.Session
        let network = input.Display.Network
        let wallet = input.Wallet
        let id = generation
        let drafts = input.Rows
        let draftIds = drafts.Select(row -> row.Id).ToArray()
        let onSent = input.OnSent
        var outcome SendResult?
        input
            .Display
            .Ui
            .Actions
            .Run(
            async (ct) -> {
                outcome = await session.Send.SubmitAsync(pending, ct)
            },
            () -> {
                if session.Settings.Network != network || session.Settings.ActiveWallet != wallet {
                    return
                }
                if drafts.Select(row -> row.Id).SequenceEqual(draftIds) {
                    drafts.Clear()
                    drafts.Add(SendRow())
                }
                if Current(id, session, network, wallet) {
                    if outcome?.Fee > 0 {
                        sent = pending
                        result = outcome
                    } else {
                        sent = nil
                        result = nil
                    }
                    Rebuild()
                }
                onSent()
            }
        )
    }
}

class SendRecipientEditor : Cell[SendEditorInput] {
    private var form WalletForm

    protected override func Build(input SendEditorInput) Blob {
        let display = input.Display
        form = WalletForm(display.Ui, true, input.Submit, []string{})
        if input.Count > 1 {
            return Recipient(display, input)
        }
        let size = AppTheme.GetAmountSize(display.Height)
        let content = Container{Gap: AppTheme.GetPageGap(display.Height), FlexShrink: 0}
        content.Add(Hero(display, Amount(display, input, size), input.Amount.Length, size, input))
        let issue = WalletValidation.AmountIssue(input.Amount)
        if issue.Length > 0 {
            content.Add(Status(display.Ui, display.Ui.Strings.Get(issue), AppTheme.Pink, "warning"))
        }
        content.Add(
            Container{Gap: AppTheme.Space10, FlexShrink: 0, AddressField(display, input), MemoField(display, input)}
        )
        return content
    }
    shared {
        func Hero(input SendDisplay, amount Blob, digits int32, size float64, editor SendEditorInput?) Blob {
            let ui = input.Ui
            let hero = Container{
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space14,
                FlexShrink: 0,
                Padding: Edges{
                    Top: AppTheme.GetHeroPadding(input.Height),
                    Bottom: AppTheme.GetHeroPadding(input.Height)
                },
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
            if let item = editor {
                let spendable = item.Spendable
                let fill Action[uint64] = atoms -> {
                    item.Row.Amount = WalletAmount.Format(atoms)
                    item.Changed()
                }
                hero.Add(
                    Container{
                        FlexDirection: FlexDirection.Row,
                        Gap: AppTheme.Space8,
                        Share(input, "25%", spendable, () -> fill(spendable / 4)),
                        Share(input, "50%", spendable, () -> fill(spendable / 2)),
                        Share(input, "max", spendable, item.Maximum)
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

        private func Share(input SendDisplay, label string, atoms uint64, click Action) Blob -> ControlParts.Button(
            input.Ui,
            label,
            click,
            input.Busy || atoms == 0,
            busy: false,
            appearance: AppTheme.CompactButton with{BackgroundColor = AppTheme.Black, TextColor = AppTheme.Body}
        )

        func Name(input SendDisplay, value string) string {
            let text = value.Trim()
            return if Kind(input, text) == "contact" || text.StartsWith("$", StringComparison.Ordinal) {
                text
            } else {
                Short(text)
            }
        }

        func Kind(input SendDisplay, value string) string {
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

        private func Issue(input SendDisplay, text string) string {
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
    }

    private func Amount(input SendDisplay, editor SendEditorInput, size float64) Blob {
        let ui = input.Ui
        let row = editor.Row
        return form.Bind(
            AppTheme.FieldInput with{
                AccessibilityName = ui.Strings.Get("Amount"),
                Value = row.Amount,
                Controlled = true,
                Placeholder = "0",
                Password = input.Privacy,
                Disabled = input.Busy,
                FontSize = size,
                TextColor = editor.Over ? AppTheme.Pink: AppTheme.Lime,
                BackgroundColor = Color.Transparent,
                BorderWidth = AppTheme.Border0,
                FocusRingWidth = AppTheme.Border0,
                PaddingHorizontal = AppTheme.Space0,
                EntryHeight = size * 1.25,
                Width = Percent(100),
                OnChange = value -> {
                    row.Amount = value.Trim()
                    editor.Changed()
                }
            }
        )
            .Build()
    }

    private func Recipient(input SendDisplay, editor SendEditorInput) Blob {
        let ui = input.Ui
        let row = editor.Row
        let index = editor.Index
        let memoUsed = Encoding.UTF8.GetByteCount(row.Memo)
        let line = Container{
            Gap: AppTheme.Space8,
            FlexShrink: 0,
            ZIndex: editor.Count - index,
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
                Grow(AddressField(input, editor)),
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
                                editor.Changed()
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
                    () -> editor.Remove(row),
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
                    MemoField(input, editor)
                }
            )
        }
        return line
    }

    private func AddressField(input SendDisplay, editor SendEditorInput) Blob {
        let ui = input.Ui
        let row = editor.Row
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
                        editor.Changed()
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
                    editor.Changed()
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

    private func MemoField(input SendDisplay, editor SendEditorInput) Blob {
        let ui = input.Ui
        let row = editor.Row
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
                    editor.Changed()
                }
            }
        )
    }
}

data struct SendBalanceInput {
    var Display SendDisplay
    var Amounts[]uint64
    var Rows[]SendReviewRow
    var Spendable uint64
    var Total uint64
    var Fee uint64
    var Change uint64
    var Remaining bool
}

class SendBalance : Cell[SendBalanceInput] {
    protected override func Build(input SendBalanceInput) Blob {
        let ui = input.Display.Ui
        let over = input.Total > input.Spendable
        let content = Container{Gap: AppTheme.GetPageGap(input.Display.Height), FlexShrink: 0}
        content.Add(Bar(input))
        if input.Remaining {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    JustifyContent: JustifyContent.FlexEnd,
                    FlexShrink: 0,
                    Figure(
                        ui,
                        "Remaining",
                        over ?
                        "−" + WalletText.Amount(ui.Privacy, input.Total - input.Spendable):
                        WalletText.Amount(ui.Privacy, input.Spendable - input.Total),
                        over ? AppTheme.Pink: AppTheme.Ink,
                        AppTheme.Type14,
                        ""
                    )
                }
            )
        }
        return content
    }

    private func Bar(value SendBalanceInput) Blob {
        let input = value.Display
        let ui = input.Ui
        let amounts = value.Amounts
        let spendable = value.Spendable
        let fee = value.Fee
        let change = value.Change
        let bar = Container{
            FlexDirection: FlexDirection.Row,
            Height: AppTheme.Track8,
            Gap: AppTheme.Space2,
            FlexShrink: 0
        }
        var total = SendPage.Add(fee, change)
        for amount in amounts {
            total = SendPage.Add(total, amount)
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
        let names = value.Rows.Select(row -> SendRecipientEditor.Name(input, row.Address)).ToArray()
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
                        Label(ui, names[other], AppTheme.Type13, other == index ? AppTheme.Ink: AppTheme.Dim, ""),
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
                    value.Rows[index].Id,
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
}

data struct SendReviewRow {
    var Id string
    var Address string
}

data struct SendReviewInput {
    var Display SendDisplay
    var Estimate SendEstimate
    var Rows[]SendReviewRow
    var Spendable uint64
    var Submit Action
    var Close Action
}

class SendReview : Cell[SendReviewInput] {
    private var openRow string = ""
    private var reviewAmounts[]uint64 = []uint64{}

    protected override func Build(value SendReviewInput) Blob {
        let input = value.Display
        let pending = value.Estimate
        let amounts = pending.Recipients.Select(recipient -> recipient.Amount).ToArray()
        if !reviewAmounts.SequenceEqual(amounts) {
            reviewAmounts = amounts
        }
        let spendable = value.Spendable
        let ui = input.Ui
        let compact = input.Height < 700
        let close = value.Close
        let list = Container{
            MinHeight: 0,
            FlexShrink: 1,
            OverflowY: Overflow.Scroll,
            BorderWidth: Edges{Top: AppTheme.Border1},
            BorderColor: AppTheme.Rule
        }
        for index in 0 ... pending.Recipients.Length {
            list.Add(Recipient(value, index))
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
            Cell.Mount[SendBalanceInput, SendBalance](
                "review-totals",
                SendBalanceInput{
                    Display: input,
                    Amounts: reviewAmounts,
                    Rows: value.Rows,
                    Fee: pending.Fee,
                    Change: pending.Change,
                    Spendable: spendable
                }
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
                        ControlParts.Button(ui, "Send", value.Submit, input.Busy, true, busy: input.Busy)
                    }
                ),
                ConfirmText: ui.Strings.Get("Send"),
                CancelText: ui.Strings.Get("Cancel"),
                ConfirmDisabled: input.Busy,
                OnConfirm: value.Submit,
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private let changeLines[]string = []string{"Returns to this wallet. Spendable after 10 confirmations"}

    private func Recipient(value SendReviewInput, index int32) Blob {
        let input = value.Display
        let pending = value.Estimate
        let ui = input.Ui
        let recipient = pending.Recipients[index]
        let handle = pending.Handles[index]
        let id = value.Rows[index].Id
        let expanded = openRow == id
        let typed = value.Rows[index].Address.Trim()
        let head = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            MinWidth: 0
        }
        if SendRecipientEditor.Kind(input, typed) == "contact" {
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
                openRow = expanded ? "": id
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
}

data struct SendSummaryInput {
    var Ui Presentation
    var Privacy bool
    var Language string
    var Spendable uint64?
}

class SendSummary : Cell[SendSummaryInput] {
    protected override func Build(input SendSummaryInput) Blob -> WalletParts.Header(
        Label(input.Ui, input.Ui.Strings.Get("send"), AppTheme.Type17, AppTheme.Ink, ""),
        AppTheme.Space12,
        if let spendable = input.Spendable {
            Figure(
                input.Ui,
                "Spendable",
                WalletText.Amount(input.Privacy, spendable),
                AppTheme.Ink,
                AppTheme.Type14,
                ""
            )
        } else {
            Container{}
        }
    )
}
