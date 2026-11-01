package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Navigation
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import Net.Codecrete.QrCodeGenerator
import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Threading
import System.Threading.Tasks

data struct ReceivePageInput {
    var Ui Presentation
    var Request ReceiveRequest
    var Address string
    var History[]WalletOutput
    var ChainHeight uint64
    var Privacy bool
    var Busy bool
    var Language string
    var Height float64
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
}

data struct ReceiveFormInput {
    var Ui Presentation
    var Draft ReceiveDraft
    var Privacy bool
    var Disabled bool
    var Language string
    var Change Action[string, string]
}

data struct ReceiveStatusInput {
    var Ui Presentation
    var Paid bool
    var Possible bool
    var Amount uint64
    var Confirmations uint64
    var Reference string
    var Privacy bool
    var Language string
}

data struct ReceivePresentationInput {
    var Ui Presentation
    var Draft ReceiveDraft
    var Prepared ReceivePrepared?
    var Error string
    var Address string
    var Privacy bool
    var Busy bool
    var Paid bool
    var Language string
    var Height float64
    var Change Action[string, string]
    var Select Action[string]
    var Reset Action
}

class ReceivePage : Cell, IDisposable {
    private var input ReceivePageInput
    private var presentation ReceivePresentationInput
    private var status ReceiveStatusInput
    private let change Action[string, string]
    private let selectFormat Action[string]
    private let reset Action
    private var prepared ReceivePrepared?
    private var generation int32
    private var lifetime CancellationTokenSource?

    init() {
        change = (field, value) -> {
            if field == "amount" {
                input.Request.Amount = value
            } else {
                input.Request.Memo = value
            }
            Prepare()
        }
        selectFormat = format -> {
            input.Request.Format = format
            Prepare()
        }
        reset = () -> {
            input.Request.Amount = ""
            input.Request.Memo = ""
            Prepare()
        }
    }

    public func Accept(next ReceivePageInput) {
        if input == next {
            return
        }
        let presentationChanged = input.Privacy != next.Privacy ||
            input.Busy != next.Busy ||
            input.Language != next.Language ||
            input.Height != next.Height
        input = next
        if presentationChanged {
            if let result = prepared {
                Publish(result)
            }
        }
        Prepare()
    }

    private func Prepare() {
        guard let owner = input.Ui.Actions.window else {
            return
        }
        let cancellation = lifetime ?? CancellationTokenSource.CreateLinkedTokenSource(owner.Closed)
        lifetime = cancellation
        generation++
        let id = generation
        let source = input.Request
        let request = ReceiveRequest{
            Amount: source.Amount,
            Memo: source.Memo,
            Reference: source.Reference,
            Since: source.Since,
            ExistingOutputs: source.ExistingOutputs,
            Format: source.Format
        }
        let history = input.History
        let address = input.Address
        let height = input.ChainHeight
        let previous = prepared
        let token = cancellation.Token
        go PrepareRequest(owner, request, history, address, height, previous, id, token)
    }

    private func PrepareRequest(
        owner Window,
        request ReceiveRequest,
        history[]WalletOutput,
        address string,
        height uint64,
        previous ReceivePrepared?,
        id int32,
        token CancellationToken
    ) {
        try {
            let result = WalletSession.PrepareReceive(request, address, history, height, previous, token)
            owner.TryPost(
                () -> {
                    if id != generation ||
                        token.IsCancellationRequested ||
                        input.Address != address ||
                        input
                        .Request
                        .Amount
                        .Trim() != result
                        .Draft
                        .Amount ||
                        input
                        .Request
                        .Memo
                        .Trim() != result
                        .Draft
                        .Memo ||
                        input
                        .Request
                        .Format != request.Format {
                        return
                    }
                    prepared = result
                    input.Request.Reference = request.Reference
                    input.Request.Since = request.Since
                    input.Request.ExistingOutputs = request.ExistingOutputs
                    Publish(result)
                }
            )
        } catch (failure OperationCanceledException) when token.IsCancellationRequested { } catch (failure Exception) {
            owner.TryPost(
                () -> {
                    if id == generation && !token.IsCancellationRequested {
                        presentation.Error = failure.Message
                        Rebuild()
                    }
                }
            )
        }
    }

    private func Publish(result ReceivePrepared) {
        let output = result.Paid ?? result.Possible
        status = ReceiveStatusInput{
            Ui: input.Ui,
            Paid: result.Paid != nil,
            Possible: result.Possible != nil,
            Amount: output?.Amount ?? uint64(0),
            Confirmations: if let value = result.Paid {
                if value.BlockHeight == 0 || input.ChainHeight < value.BlockHeight {
                    uint64(0)
                } else {
                    Math.Min(uint64(10), input.ChainHeight - value.BlockHeight + 1)
                }
            } else {
                uint64(0)
            },
            Reference: result.Possible != nil ? result.Request.Reference: "",
            Privacy: input.Privacy,
            Language: input.Language
        }
        presentation = ReceivePresentationInput{
            Ui: input.Ui,
            Draft: result.Draft,
            Prepared: result,
            Error: "",
            Address: input.Address,
            Privacy: input.Privacy,
            Busy: input.Busy,
            Paid: result.Paid != nil,
            Language: input.Language,
            Height: input.Height,
            Change: change,
            Select: selectFormat,
            Reset: reset
        }
        Rebuild()
    }

    override func Build() Blob {
        let card = WalletParts.PageCard(input.Ui, 900, input.Height, fill: true)
        card.Add(
            WalletParts.Header(
                Label(input.Ui, input.Ui.Strings.Get("receive"), AppTheme.Type17, AppTheme.Ink, ""),
                AppTheme.Space12,
                prepared != nil ? Cell.Mount[ReceiveStatusInput, ReceiveStatus]("payment-status", status): Container{}
            )
        )
        card.Add(Cell.Mount[ReceivePresentationInput, ReceivePresentation]("request-presentation", presentation))
        return card
    }

    public func Dispose() {
        generation++
        lifetime?.Cancel()
        lifetime?.Dispose()
        lifetime = nil
    }
}

class ReceiveStatus : Cell[ReceiveStatusInput] {
    protected override func Build(input ReceiveStatusInput) Blob {
        let ui = input.Ui
        let status = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: AppTheme.Space8}
        if input.Paid {
            status.Add(MaterialIcons.Create("check", AppTheme.Icon14, AppTheme.Lime))
            status.Add(Label(ui, Amount(input.Privacy, input.Amount), AppTheme.Type13, AppTheme.Ink, ""))
            if input.Confirmations < 10 {
                status.Add(Label(ui, input.Confirmations.ToString() + "/10", AppTheme.Type13, AppTheme.Dim, ""))
            }
        } else if input.Possible {
            status.Add(
                Label(
                    ui,
                    ui.Strings.Get("possible payment") + " " + Amount(input.Privacy, input.Amount),
                    AppTheme.Type14,
                    AppTheme.Orange,
                    ""
                )
            )
            status.Add(
                Cell.Mount[InfoTipInput, InfoTip](
                    "possible",
                    InfoTipInput{
                        Ui: ui,
                        Topic: "About possible payment",
                        Lines: []string{
                            ui
                                .Strings
                                .Get("Amount and memo match, but the reference {0} is missing. Check with the sender")
                                .Replace("{0}", input.Reference)
                        },
                        Language: input.Language,
                        Width: 300
                    }
                )
            )
        }
        return status
    }
}

class ReceiveForm : Cell[ReceiveFormInput] {
    protected override func Build(input ReceiveFormInput) Blob {
        let ui = input.Ui
        let draft = input.Draft
        let form = WalletForm(ui, false, nil, []string{})
        return Container{
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space10,
            FlexShrink: 0,
            Container{
                FlexGrow: 0.7,
                TextAlign: TextAlign.Right,
                FlexBasis: 0,
                MinWidth: 0,
                form.Amount(
                    TextField{
                        AccessibilityName: ui.Strings.Get("Amount"),
                        Placeholder: ui.Strings.Get("amount"),
                        Value: draft.Amount,
                        Controlled: true,
                        Password: input.Privacy,
                        Disabled: input.Disabled,
                        Invalid: draft.AmountIssue.Length > 0,
                        IssueText: if draft.AmountIssue.Length > 0 {
                            ui.Strings.Explain(draft.AmountIssue)
                        } else {
                            nil
                        },
                        OnChange: value -> input.Change.Invoke("amount", value)
                    }
                )
            },
            Grow(
                Container{
                    MinWidth: 0,
                    form.Field(
                        "Memo",
                        draft.Memo,
                        value -> input.Change.Invoke("memo", value),
                        issue: draft.MemoIssue,
                        disabled: input.Disabled,
                        labelled: false,
                        hidden: input.Privacy,
                        placeholder: ui.Strings.Get("memo"),
                        leading: MaterialIcons.Create("notes", AppTheme.Icon16, AppTheme.Dim),
                        trailing: Container{
                            FlexDirection: FlexDirection.Row,
                            AlignItems: AlignItems.Center,
                            Gap: AppTheme.Space8,
                            Label(ui, Hidden(input.Privacy, draft.Reference), AppTheme.Type14, AppTheme.Dim, ""),
                            Meter(ui, Encoding.UTF8.GetByteCount(draft.FullMemo), WalletValidation.MemoLimit, true)
                        }
                    )
                }
            )
        }
    }
}

class ReceivePresentation : Cell[ReceivePresentationInput], IDisposable {
    private var qrText string = ""
    private var qrCode QrCode?
    private var qrPath VectorPath = VectorPath.Empty
    private var generation int32
    private var exportResult string = ""

    protected override func Build(input ReceivePresentationInput) Blob {
        let ui = input.Ui
        let draft = input.Draft
        guard let prepared = input.Prepared else {
            return Container{}
        }
        let empty = draft.Amount.Length == 0 && draft.Memo.Length == 0
        let shown = prepared.Shown
        let link = prepared.Link
        let payload = prepared.Payload
        let ranges = List[TextStyleRange]{TextStyleRange(TextRange(0, 11), Style{Color: AppTheme.Dim})}
        let amountStart = link.IndexOf("?amount=", StringComparison.Ordinal)
        if amountStart >= 0 {
            ranges.Add(TextStyleRange(TextRange(amountStart, 8), Style{Color: AppTheme.Dim}))
        }
        let memoStart = link.IndexOf("memo=", StringComparison.Ordinal)
        if memoStart >= 0 {
            ranges.Add(TextStyleRange(TextRange(memoStart - 1, 6), Style{Color: AppTheme.Dim}))
        }
        if payload != qrText {
            generation++
            exportResult = ""
            qrText = payload
            qrCode = prepared.Code
            qrPath = prepared.Path
        }
        let side = Math.Clamp(input.Height - 340, 180.0, 400.0)
        let code = Container{
            Width: side,
            Height: side,
            BorderRadius: AppTheme.Radius10,
            Overflow: Overflow.Hidden,
            BackgroundColor: input.Privacy || input.Paid ? AppTheme.Surface: AppTheme.Ink,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: ui.Strings.Get(input.Privacy ? "Address QR code hidden": "Payment request QR code")
            }
        }
        if input.Privacy {
            code.Add(MaterialIcons.Create("visibility_off", AppTheme.Icon32, AppTheme.Dim))
        } else if input.Paid {
            code.Add(
                Shape{
                    Position: PositionType.Absolute,
                    Width: side,
                    Height: side,
                    Path: qrPath,
                    Fit: ShapeFit.Fill,
                    BackgroundColor: AppTheme.Rule
                }
            )
            code.Add(MaterialIcons.Create("check", 56, AppTheme.Mint))
        } else {
            code.Add(
                Shape{Width: side, Height: side, Path: qrPath, Fit: ShapeFit.Fill, BackgroundColor: AppTheme.Black}
            )
        }
        let options = [empty ? 2: 3]NavigationItem
        if !empty {
            options[0] = NavigationItem{Id: "link", Label: ui.Strings.Get("Link")}
        }
        let offset = empty ? 0: 1
        options[offset] = NavigationItem{Id: "address", Label: ui.Strings.Get("Address")}
        options[offset + 1] = NavigationItem{Id: "qr", Label: ui.Strings.Get("QR")}
        let tabs = Tabs(ui, "share-as", "Share as", options, shown, input.Select, true)
        let grouped = Grouped(input.Address)
        let first = grouped.IndexOf(' ')
        let preview = Text{
            Content: if input.Privacy {
                "••••••••"
            } else if shown == "address" {
                grouped
            } else {
                link
            },
            StyleRanges: if input.Privacy || shown == "address" && first < 0 {
                []TextStyleRange{}
            } else if shown == "address" {
                []TextStyleRange{
                    TextStyleRange(TextRange(first, grouped.LastIndexOf(' ') - first), Style{Color: AppTheme.Body})
                }
            } else if shown == "qr" {
                []TextStyleRange{TextStyleRange(TextRange(0, link.Length), Style{Color: AppTheme.Dim})}
            } else {
                ranges.ToArray()
            },
            FontFamily: AppTheme.Font,
            FontSize: AppTheme.Type13,
            Color: AppTheme.Ink,
            TextWrap: TextWrap.Wrap
        }
        let field = FieldBox(
            ui,
            preview,
            Edges{Left: AppTheme.Space14, Right: AppTheme.Space14, Top: AppTheme.Space12, Bottom: AppTheme.Space12},
            AppTheme.Edge
        )
        field.MinHeight = 72
        field.Accessibility = Accessibility{Role: AccessibilityRole.Status}
        if shown == "link" {
            field.Accessibility = Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get("Copy link")}
            field.Disabled = input.Busy || draft.AmountIssue.Length > 0 || draft.MemoIssue.Length > 0
            field.OnClick = () -> ui.Actions.Copy(payload, 120000)
            WidgetKeyBindings.BindActivation(field)
        }
        let disabled = input.Busy || shown != "address" && (draft.AmountIssue.Length > 0 || draft.MemoIssue.Length > 0)
        let action = if input.Paid {
            Action(ui, "add", "New request", AppTheme.Ink, AppTheme.Edge, AppTheme.Raised, disabled, input.Reset)
        } else if shown == "qr" {
            Action(
                ui,
                "download",
                "Save QR image",
                AppTheme.Lime,
                AppTheme.Lime,
                AppTheme.LimeQuiet,
                disabled,
                () -> SaveQr(input)
            )
        } else {
            TextParts.Copy(ui, payload, shown == "link" ? "Copy link": "Copy address", disabled: disabled, text: true)
        }
        let actions = Container{Gap: AppTheme.Space12, FlexShrink: 0, tabs, field, action}
        let message = exportResult.Length > 0 ? exportResult: input.Error
        if message.Length > 0 {
            actions.Add(Label(ui, ui.Strings.Get(message), AppTheme.Type13, AppTheme.Body, ""))
        }
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space28,
            MinHeight: 0,
            Container{
                FlexShrink: 0,
                Padding: AppTheme.Space4,
                BorderWidth: AppTheme.Border2,
                BorderRadius: AppTheme.Radius14,
                BorderColor: shown == "qr" && !input.Paid ? AppTheme.Lime: Color.Transparent,
                Margin: -AppTheme.Space6,
                code
            },
            Grow(
                Container{
                    Gap: AppTheme.Space16,
                    Cell.Mount[ReceiveFormInput, ReceiveForm](
                        "request-form",
                        ReceiveFormInput{
                            Ui: ui,
                            Draft: draft,
                            Privacy: input.Privacy,
                            Disabled: input.Busy || input.Paid,
                            Language: input.Language,
                            Change: input.Change
                        }
                    ),
                    actions
                }
            )
        }
    }

    private func Action(
        ui Presentation,
        icon string,
        label string,
        color Color,
        border Color,
        fill Color,
        disabled bool,
        click Action
    ) Blob -> ControlParts
        .Button(
        ui,
        label,
        click,
        disabled,
        busy: false,
        appearance: AppTheme.Button with{
            BorderColor = border,
            BackgroundColor = fill,
            TextColor = color,
            Leading = MaterialIcons.Create(icon, AppTheme.Icon16, disabled ? AppTheme.Dim: color)
        }
    )

    private func SaveQr(input ReceivePresentationInput) {
        guard let code = qrCode else {
            return
        }
        guard let owner = input.Ui.Actions.window else {
            return
        }
        generation++
        let current = generation
        try {
            let pending = owner.ShowFileDialogAsync(
                FileDialogKind.SaveFile,
                FileDialogOptions{
                    Title: input.Ui.Strings.Get("Save QR image"),
                    InitialPath: Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                        "blocknet-request.png"
                    )
                }
            )
            exportResult = ""
            input.Ui.Actions.Run(ct -> CompleteExport(owner, pending, code, current, ct))
        } catch (failure Exception) {
            exportResult = failure.Message
        }
    }

    private async func CompleteExport(
        owner Window,
        pending Task[FileDialogResult],
        code QrCode,
        current int32,
        ct CancellationToken
    ) {
        var result = ""
        try {
            let chosen = await pending
            if chosen.Status == FileDialogStatus.Success && chosen.Paths.Count > 0 {
                await WalletSession.ExportReceiveAsync(chosen.Paths[0], code, ct)
                result = "Saved"
            } else if chosen.Status != FileDialogStatus.Cancelled {
                result = "File dialog unavailable"
            }
        } catch (failure Exception) {
            result = failure.Message
        }
        let message = result
        owner.TryPost(
            () -> {
                if current == generation {
                    exportResult = message
                    Rebuild()
                }
            }
        )
    }

    public func Dispose() {
        generation++
    }
}
