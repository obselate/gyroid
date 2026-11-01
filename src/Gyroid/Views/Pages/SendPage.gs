package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Data
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
import System.Threading.Tasks

data struct SendPageInput {
    var Session WalletSession
    var Wallet string
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
    var Submit Action
    var Changed Action[SendRow]
    var Remove Action[SendRow]
    var Maximum Action
}

class SendPage : Cell, IDisposable {
    private var input SendPageInput
    private var estimate SendEstimate?
    private var sent SendEstimate?
    private var result SendResult?
    private var reviewRows[]SendReviewRow = []SendReviewRow{}
    private let model SendForm = SendForm()
    private var editorRows[]SendEditorInput = []SendEditorInput{}
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var request CancellationTokenSource?
    private var generation int32
    private var reading bool
    private var issue string = ""
    private var reviewFocus bool
    private let changed Action[SendRow]
    private let submit Action
    private let remove Action[SendRow]
    private let maximum Action
    private let add Action
    private var total SendTotal?
    private var actions SendActions?
    private let configureTotal Action[SendTotal]
    private let configureActions Action[SendActions]
    private let configureReview Action[SendReview]
    private let editorKey Func[SendEditorInput, string]
    private let editorBuilder Func[SendEditorInput, Blob]

    init() {
        changed = row -> {
            Restart()
            SendService.PrepareDraft(row, input.Display.Contacts, input.Display.Network)
            Refresh(false)
        }
        submit = () -> Review()
        remove = row -> {
            input.Rows.Remove(row)
            Restart()
            Refresh()
        }
        maximum = () -> Maximum()
        add = () -> {
            input.Rows.Add(SendRow())
            Restart()
            Refresh()
        }
        configureTotal = child -> {
            total = child
            child.Accept(SendTotalInput{Display: input.Display, Amount: model.Total, Over: model.Over})
        }
        configureActions = child -> {
            actions = child
            child.Accept(ActionsInput())
            reviewFocus = false
        }
        editorKey = row -> row.Row.Id
        configureReview = child -> child.Accept(
            SendReviewInput{
                Display: input.Display,
                Estimate: estimate!!,
                Rows: reviewRows,
                Spendable: input.Spendable ?? uint64(0),
                Submit: () -> Submit(),
                Close: () -> {
                    estimate = nil
                    reviewFocus = true
                    Rebuild()
                }
            }
        )
        editorBuilder = row -> Cell.Mount[SendEditorInput, SendRecipientEditor](row.Row.Id, row)
    }

    public func Accept(next SendPageInput) {
        if (next with{Sends = sent == nil ? input.Sends: next.Sends}) == input {
            return
        }
        if next.Rows.Count == 0 {
            next.Rows.Add(SendRow())
        }
        if input.Display.Network != next.Display.Network || input.Display.Contacts != next.Display.Contacts {
            Restart()
            for row in next.Rows {
                SendService.PrepareDraft(row, next.Display.Contacts, next.Display.Network)
            }
        }
        if input.Display.Network != next.Display.Network || input.Wallet != next.Wallet {
            Restart()
            sent = nil
            result = nil
        }
        input = next
        Refresh()
    }

    private func Restart() {
        request?.Cancel()
        generation++
        estimate = nil
        reading = false
        issue = ""
    }

    private func Refresh(rebuild bool = true) {
        let display = input.Display
        let spendable = input.Spendable ?? uint64(0)
        model.Refresh(input.Rows, spendable, display.Busy || reading)
        let rows = [input.Rows.Count]SendEditorInput
        for index in 0 ... input.Rows.Count {
            let row = input.Rows[index]
            rows[index] = SendEditorInput{
                Display: display,
                Row: row,
                Address: row.Address,
                Amount: row.Amount,
                Memo: row.Memo,
                MemoOpen: row.MemoOpen,
                Suggest: row.Suggest,
                Index: index,
                Count: input.Rows.Count,
                Spendable: input.Rows.Count == 1 ? spendable: uint64(0),
                Submit: submit,
                Changed: changed,
                Remove: remove,
                Maximum: maximum
            }
        }
        if !editorRows.SequenceEqual(rows) {
            editorRows = rows
        }
        if rebuild {
            Rebuild()
        } else {
            actions?.Accept(ActionsInput())
            if input.Rows.Count > 1 {
                total?.Accept(SendTotalInput{Display: display, Amount: model.Total, Over: model.Over})
            }
        }
    }

    private func ActionsInput() SendActionsInput -> SendActionsInput{
        Display: input.Display,
        Balance: SendBalanceInput{
            Display: input.Display,
            Rows: model.Rows,
            Spendable: input.Spendable ?? uint64(0),
            Total: model.Total,
            Remaining: true,
            Over: model.Over,
            Issue: issue
        },
        CanSubmit: model.CanSubmit,
        Loading: input.Display.Busy || reading,
        Focus: reviewFocus,
        Submit: submit,
        Add: add
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
        let multi = input.Rows.Count > 1
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
            card.Add(Cell.Mount[SendTotal]("amount-total", configureTotal))
            let list = VirtualRows(
                editorRows,
                AppTheme.ControlRegular + AppTheme.Space8,
                editorKey,
                editorBuilder,
                false
            )
            list.MinHeight = 0
            list.FlexShrink = 1
            list.FlexGrow = 1
            card.Add(ListParts.Viewport(list, grow: true))
        } else {
            card.Add(editorBuilder(editorRows[0]))
        }
        card.Add(Cell.Mount[SendActions]("actions", configureActions))
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
        if estimate != nil {
            card.Add(Cell.Mount[SendReview]("review", configureReview))
        }
        return card
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
    id == generation && session.Settings.Network == network && session.Settings.ActiveWallet == wallet

    private func Review() {
        if !model.CanSubmit {
            return
        }
        let window = input.Display.Window
        let session = input.Session
        let network = input.Display.Network
        let wallet = input.Wallet
        let token = BeginRequest()
        let id = generation
        let drafts = model.Rows
        let requests = drafts.Select(
            row -> WalletRecipient{Address: row.Destination, Amount: row.Amount, Memo: row.Memo}
        )
            .ToArray()
        reading = true
        issue = ""
        Refresh(false)
        go Estimate(session, window, network, wallet, id, drafts, requests, token)
    }

    private async func Estimate(
        session WalletSession,
        window Window?,
        network string,
        wallet string,
        id int32,
        drafts[]SendReviewRow,
        requests[]WalletRecipient,
        token CancellationToken
    ) Task {
        var found SendEstimate?
        var problem = ""
        var rows = drafts
        try {
            let pending = await session.Send.EstimateAsync(requests, token)
            found = pending
            rows = drafts.Select(
                (row SendReviewRow, index int32) -> row with{
                    Amount = pending.Recipients[index].Amount,
                    Destination = pending.Recipients[index].Address,
                    Memo = pending.Recipients[index].Memo,
                    Handle = pending.Handles[index]
                }
            )
                .ToArray()
        } catch (error OperationCanceledException) {
            return
        } catch (error Exception) {
            problem = error.Message
        }
        window?.TryPost(
            () -> {
                if !Current(id, session, network, wallet) {
                    return
                }
                reading = false
                issue = problem
                estimate = found
                reviewRows = rows
                Refresh()
            }
        )
    }

    private func Maximum() {
        let window = input.Display.Window
        let row = input.Rows[0]
        let address = row.Kind.Length > 0 ? row.Destination: input.Address
        let memo = row.Memo
        let session = input.Session
        let network = input.Display.Network
        let wallet = input.Wallet
        let token = BeginRequest()
        let id = generation
        reading = true
        issue = ""
        Refresh(false)
        go ReadMaximum(session, window, network, wallet, id, row, address, memo, token)
    }

    private async func ReadMaximum(
        session WalletSession,
        window Window?,
        network string,
        wallet string,
        id int32,
        row SendRow,
        address string,
        memo string,
        token CancellationToken
    ) Task {
        var amount uint64
        var problem = ""
        try {
            amount = await session.Send.MaximumAsync([]WalletRecipient{}, address, memo, token)
        } catch (error OperationCanceledException) {
            return
        } catch (error Exception) {
            problem = error.Message
        }
        window?.TryPost(
            () -> {
                if !Current(id, session, network, wallet) {
                    return
                }
                reading = false
                issue = problem
                if problem.Length == 0 {
                    row.Amount = WalletAmount.Format(amount)
                    SendService.PrepareDraft(row, input.Display.Contacts, network)
                }
                Refresh()
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
        let window = input.Display.Window
        estimate = nil
        let session = input.Session
        let network = input.Display.Network
        let wallet = input.Wallet
        let id = generation
        let drafts = input.Rows
        let draftIds = drafts.Select(row -> row.Id).ToArray()
        let onSent = input.OnSent
        input
            .Display
            .Ui
            .Actions
            .Run(
            async (ct) -> {
                let outcome = await session.Send.SubmitAsync(pending, ct)
                window?.TryPost(
                    () -> {
                        if session.Settings.Network != network || session.Settings.ActiveWallet != wallet {
                            return
                        }
                        if drafts.Select(row -> row.Id).SequenceEqual(draftIds) {
                            drafts.Clear()
                            drafts.Add(SendRow())
                        }
                        if Current(id, session, network, wallet) {
                            if outcome.Fee > 0 {
                                sent = pending
                                result = outcome
                            } else {
                                sent = nil
                                result = nil
                            }
                            Refresh()
                        }
                    }
                )
            },
            onSent
        )
    }
}

class SendRecipientEditor : Cell[SendEditorInput] {
    private var form WalletForm
    private var current SendEditorInput
    private let anchor ElementHandle = ElementHandle()
    private let suggestionKey Func[SendSuggestion, string]
    private let suggestionBuilder Func[SendSuggestion, Blob]
    private let changed Action[SendRow]
    private let memoLines[]string = []string{
        "Use this optional note for a payment reference, invoice number or message (up to 124 UTF-8 bytes).",
        "It is encrypted on chain for the recipient.",
        "The sender keeps a copy in their wallet."
    }

    init() {
        changed = row -> {
            current.Changed(row)
            Rebuild()
        }
        suggestionKey = row -> row.Name
        suggestionBuilder = row -> Suggestion(row)
    }

    protected override func Build(value SendEditorInput) Blob {
        current = value
        let input = value with{Changed = changed}
        let display = input.Display
        form = WalletForm(display.Ui, true, input.Submit, []string{})
        if input.Count > 1 {
            return Recipient(display, input)
        }
        let size = AppTheme.GetAmountSize(display.Height)
        let content = Container{Gap: AppTheme.GetPageGap(display.Height), FlexShrink: 0}
        content.Add(Hero(display, Amount(display, input, size), input.Row.Amount.Length, size, input))
        let issue = input.Row.AmountIssue
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
                    item.Changed(item.Row)
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
                TextColor = (row.Atoms ?? uint64(0)) > editor.Spendable ? AppTheme.Pink: AppTheme.Lime,
                BackgroundColor = Color.Transparent,
                BorderWidth = AppTheme.Border0,
                FocusRingWidth = AppTheme.Border0,
                PaddingHorizontal = AppTheme.Space0,
                EntryHeight = size * 1.25,
                Width = Percent(100),
                OnChange = value -> {
                    row.Amount = value.Trim()
                    editor.Changed(row)
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
                            Invalid: row.AmountIssue.Length > 0,
                            OnChange: value -> {
                                row.Amount = value.Trim()
                                editor.Changed(row)
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
                        editor.Changed(row)
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
        let issue = row.AddressIssue
        let kind = row.Kind
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
        } else if !input.Privacy && text.Length == 0 && input.Contacts.Count > 0 {
            trailing.Add(
                Icon(
                    ui,
                    MaterialIcons.Create("menu_book", AppTheme.Icon16, AppTheme.Body),
                    ui.Strings.Get("contacts"),
                    () -> {
                        row.Suggest = !row.Suggest
                        editor.Changed(row)
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
            Handle: anchor,
            OnKeyDown: (event KeyEvent) -> {
                if event.Key == Key.Escape {
                    if row.Suggest && !input.Privacy && kind.Length == 0 && row.Matches.Length > 0 {
                        row.Suggest = false
                        editor.Changed(row)
                    }
                    event.PreventDefault()
                }
            },
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
                            if payment.HasAmount {
                                row.Amount = payment.Amount
                            }
                            if payment.HasMemo {
                                row.Memo = payment.Memo
                                row.MemoOpen = payment.Memo.Length > 0
                            }
                            row.Suggest = false
                        } else {
                            row.Address = value
                            row.Suggest = true
                        }
                        editor.Changed(row)
                    }
                }
            )
        }
        if input.Privacy || !row.Suggest || kind.Length > 0 {
            return field
        }
        let matches = row.Matches
        if matches.Length == 0 {
            return field
        }
        let list = VirtualRows(matches, AppTheme.ControlRegular, suggestionKey, suggestionBuilder, false)
        list.MinHeight = 0
        list.Height = matches.Length * AppTheme.ControlRegular
        list.Accessibility = Accessibility{Role: AccessibilityRole.List, Name: ui.Strings.Get("contacts")}
        field.Add(
            Cell.Mount[PopoverInput, Popover](
                "suggest",
                PopoverInput{
                    Open: true,
                    Anchor: anchor,
                    Placement: PopoverPlacement.BottomStart,
                    Gap: AppTheme.Space6,
                    Width: Math.Max(240.0, anchor.BorderBox.Width),
                    CreatePanel: (value, bounds, content) -> Container{
                        BasedOn: AppTheme.TooltipStyle,
                        Padding: AppTheme.Space6
                    },
                    TakeFocus: false,
                    Content: ListParts.Viewport(list, grow: false),
                    AccessibilityName: ui.Strings.Get("contacts"),
                    OnDismiss: reason -> {
                        row.Suggest = false
                        editor.Changed(row)
                    }
                }
            )
        )
        return field
    }

    private func Suggestion(suggestion SendSuggestion) Blob {
        let input = current
        let ui = input.Display.Ui
        let row = input.Row
        let button = Goo
            .Button{
            BasedOn: AppTheme.ListRowStyle,
            Height: AppTheme.ControlRegular,
            Padding: Edges{Left: AppTheme.Space10, Right: AppTheme.Space10},
            BorderRadius: AppTheme.Radius8,
            BorderWidth: AppTheme.Border0,
            Hover: Style{BackgroundColor: AppTheme.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.ListItem, Name: suggestion.Name},
            OnClick: () -> {
                row.Address = suggestion.Name
                row.Suggest = false
                changed(row)
            },
            MaterialIcons.Create("person", AppTheme.Icon14, AppTheme.Dim),
            Grow(
                Text{
                    Content: suggestion.Name,
                    StyleRanges: []TextStyleRange{
                        TextStyleRange(TextRange(0, suggestion.PrefixLength), Style{Color: AppTheme.Lime})
                    },
                    FontFamily: AppTheme.Font,
                    FontSize: AppTheme.Type14,
                    Color: AppTheme.Ink,
                    TextWrap: TextWrap.NoWrap,
                    TextTrimming: TextTrimming.Ellipsis
                }
            ),
            Label(ui, Short(suggestion.Destination), AppTheme.Type13, AppTheme.Dim, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func MemoField(input SendDisplay, editor SendEditorInput) Blob {
        let ui = input.Ui
        let row = editor.Row
        let issue = row.MemoIssue
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
                            Lines: memoLines,
                            Language: input.Language,
                            Width: 300
                        }
                    )
                },
                OnChange: value -> {
                    row.Memo = value
                    editor.Changed(row)
                }
            }
        )
    }
}

data struct SendTotalInput {
    var Display SendDisplay
    var Amount uint64
    var Over bool
}

class SendTotal : Cell {
    private var current SendTotalInput

    public func Accept(input SendTotalInput) {
        if current == input {
            return
        }
        current = input
        Rebuild()
    }

    override func Build() Blob {
        let input = current
        let display = input.Display
        let size = AppTheme.GetTotalSize(display.Height)
        let sum = Hidden(display.Privacy, WalletAmount.Format(input.Amount))
        return SendRecipientEditor.Hero(
            display,
            Label(display.Ui, sum, size, input.Over ? AppTheme.Pink: AppTheme.Lime, ""),
            sum.Length,
            size,
            nil
        )
    }
}

data struct SendActionsInput {
    var Display SendDisplay
    var Balance SendBalanceInput
    var CanSubmit bool
    var Loading bool
    var Focus bool
    var Submit Action
    var Add Action
}

class SendActions : Cell {
    private var current SendActionsInput

    public func Accept(input SendActionsInput) {
        if current == input {
            return
        }
        current = input
        Rebuild()
    }

    override func Build() Blob {
        let input = current
        let display = input.Display
        let ui = display.Ui
        let review = Button(ui, "Review", input.Submit, !input.CanSubmit, true, input.Focus, input.Loading)
        review.MinWidth = 140
        let add = ControlParts.Button(
            ui,
            "recipient",
            input.Add,
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
        return Container{
            Gap: AppTheme.GetPageGap(display.Height),
            FlexShrink: 0,
            Cell.Mount[SendBalanceInput, SendBalance]("totals", input.Balance),
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Gap: AppTheme.Space12,
                add,
                review
            }
        }
    }
}

data struct SendBalanceInput {
    var Display SendDisplay
    var Rows[]SendReviewRow
    var Spendable uint64
    var Total uint64
    var Fee uint64
    var Change uint64
    var Remaining bool
    var Over bool
    var Issue string
}

class SendBalance : Cell[SendBalanceInput] {
    protected override func Build(input SendBalanceInput) Blob {
        let ui = input.Display.Ui
        let over = input.Over
        let content = Container{Gap: AppTheme.GetPageGap(input.Display.Height), FlexShrink: 0}
        content.Add(Bar(input))
        if input.Remaining {
            let remaining = over ? input.Total - input.Spendable: input.Spendable - input.Total
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    JustifyContent: JustifyContent.FlexEnd,
                    FlexShrink: 0,
                    Figure(
                        ui,
                        "Remaining",
                        (over ? "−": "") + WalletText.Amount(ui.Privacy, remaining),
                        over ? AppTheme.Pink: AppTheme.Ink,
                        AppTheme.Type14,
                        ""
                    )
                }
            )
            if over {
                content.Add(Status(ui, ui.Strings.Get("Exceeds spendable balance"), AppTheme.Pink, "warning"))
            } else if input.Issue.Length > 0 {
                content.Add(Status(ui, ui.Strings.Explain(input.Issue), AppTheme.Pink, "warning"))
            }
        }
        return content
    }

    private func Bar(value SendBalanceInput) Blob {
        let input = value.Display
        let ui = input.Ui
        let spendable = value.Spendable
        let fee = value.Fee
        let change = value.Change
        let bar = Container{
            FlexDirection: FlexDirection.Row,
            Height: AppTheme.Track8,
            Gap: AppTheme.Space2,
            FlexShrink: 0
        }
        let total = SendForm.Add(SendForm.Add(value.Total, fee), change)
        if input.Privacy || spendable == 0 {
            bar.Add(BarSegment(1, AppTheme.Edge))
            return bar
        }
        if total > spendable {
            bar.Add(BarSegment(float64(spendable), AppTheme.Lime))
            bar.Add(BarSegment(float64(total - spendable), AppTheme.Pink))
            return bar
        }
        for row in value.Rows {
            if row.Amount == 0 {
                continue
            }
            let segment = BarSegment(float64(row.Amount), AppTheme.Lime)
            if value.Rows.Length < 2 || input.Window == nil {
                bar.Add(segment)
                continue
            }
            let name = row.Kind == "contact" || row.Kind == "handle" ? row.Address.Trim(): Short(row.Address)
            let lines = Container{
                FlexDirection: FlexDirection.Row,
                Gap: AppTheme.Space24,
                Label(ui, name, AppTheme.Type13, AppTheme.Ink, ""),
                Label(ui, WalletAmount.Format(row.Amount), AppTheme.Type13, AppTheme.Ink, "")
            }
            bar.Add(
                Cell.Mount[TooltipInput, Tooltip](
                    row.Id,
                    TooltipInput{
                        Window: input.Window,
                        Target: segment,
                        Content: lines,
                        BubbleStyle: AppTheme.PassiveTooltipStyle,
                        Placement: PortalPlacement.Top,
                        RootStyle: Style{FlexGrow: float64(row.Amount), FlexBasis: 0, MinWidth: 3}
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

data struct SendReviewInput {
    var Display SendDisplay
    var Estimate SendEstimate
    var Rows[]SendReviewRow
    var Spendable uint64
    var Submit Action
    var Close Action
}

data struct SendReviewItem {
    var Display SendDisplay
    var Row SendReviewRow
    var Index int32
    var Expanded bool
}

class SendReview : Cell {
    private var current SendReviewInput
    private var openRow string = ""
    private var shown[]SendReviewItem = []SendReviewItem{}
    private let rowKey Func[SendReviewItem, string]
    private let rowBuilder Func[SendReviewItem, Blob]

    init() {
        rowKey = row -> row.Row.Id
        rowBuilder = row -> Recipient(row)
    }

    public func Accept(input SendReviewInput) {
        if current == input {
            return
        }
        current = input
        RefreshRows()
    }

    private func RefreshRows() {
        let rows = current
            .Rows
            .Select(
            (row SendReviewRow, index int32) -> SendReviewItem{
                Display: current.Display,
                Row: row,
                Index: index,
                Expanded: row.Id == openRow
            }
        )
            .ToArray()
        if !shown.SequenceEqual(rows) {
            shown = rows
        }
        Rebuild()
    }

    override func Build() Blob {
        let value = current
        let input = value.Display
        let pending = value.Estimate
        let spendable = value.Spendable
        let ui = input.Ui
        let compact = input.Height < 700
        let close = value.Close
        let list = VirtualRows(shown, AppTheme.ControlRegular + AppTheme.Space12, rowKey, rowBuilder, false)
        list.MinHeight = 0
        list.FlexShrink = 1
        list.FlexGrow = 1
        list.BorderWidth = Edges{Top: AppTheme.Border1}
        list.BorderColor = AppTheme.Rule
        let remaining = spendable - Math.Min(spendable, pending.Total)
        let content = Container{
            Gap: compact ? AppTheme.Space14: AppTheme.Space16,
            MinHeight: 0,
            Height: input.Height,
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
            ListParts.Viewport(list, grow: true),
            Cell.Mount[SendBalanceInput, SendBalance](
                "review-totals",
                SendBalanceInput{
                    Display: input,
                    Rows: value.Rows,
                    Total: pending.Amount,
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

    private func Recipient(value SendReviewItem) Blob {
        let input = value.Display
        let ui = input.Ui
        let recipient = value.Row
        let handle = recipient.Handle
        let id = recipient.Id
        let index = value.Index
        let expanded = value.Expanded
        let typed = recipient.Address.Trim()
        let head = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            MinWidth: 0
        }
        if recipient.Kind == "contact" {
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
                    Hidden(ui.Privacy, Short(recipient.Destination)),
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
                RefreshRows()
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
            let grouped = Grouped(recipient.Destination)
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
