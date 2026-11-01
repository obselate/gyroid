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

class ReceiveRequest {
    var Amount string = ""
    var Memo string = ""
    var Reference string = ""
    var Since uint64
    let ExistingOutputs HashSet[string] = HashSet[string](StringComparer.Ordinal)
    var Format string = "link"
}

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

data struct ReceiveDraft {
    var Amount string
    var Memo string
    var Reference string
    var FullMemo string
    var AmountIssue string
    var MemoIssue string
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
    var Address string
    var Format string
    var Privacy bool
    var Busy bool
    var Paid bool
    var Language string
    var Height float64
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var Change Action[string, string]
    var Select Action[string]
    var Reset Action
}

class ReceivePage : Cell {
    private var input ReceivePageInput
    private var presentation ReceivePresentationInput
    private var status ReceiveStatusInput
    private let change Action[string, string]
    private let selectFormat Action[string]
    private let reset Action

    init() {
        change = (amount, memo) -> {
            input.Request.Amount = amount.Trim()
            input.Request.Memo = memo.Trim()
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
        input = next
        Prepare()
    }

    private func Prepare() {
        let request = input.Request
        let empty = request.Amount.Length == 0 && request.Memo.Length == 0
        if empty {
            request.Reference = ""
        } else if request.Reference.Length == 0 {
            request.Reference = "#" + Random.Shared.Next(0x1000000).ToString("x6")
            request.Since = input.ChainHeight
            request.ExistingOutputs.Clear()
            for output in input.History {
                request.ExistingOutputs.Add(output.TxId + ":" + output.OutputIndex.ToString())
            }
        }
        let full = if request.Memo.Length > 0 {
            request.Memo + " " + request.Reference
        } else {
            request.Reference
        }
        let draft = ReceiveDraft{
            Amount: request.Amount,
            Memo: request.Memo,
            Reference: request.Reference,
            FullMemo: full,
            AmountIssue: WalletValidation.AmountIssue(request.Amount),
            MemoIssue: WalletValidation.MemoIssue(full)
        }
        let paid = Payment(true)
        let possible = if paid == nil && request.Amount.Length > 0 {
            Payment(false)
        } else {
            nil
        }
        let output = paid ?? possible
        status = ReceiveStatusInput{
            Ui: input.Ui,
            Paid: paid != nil,
            Possible: possible != nil,
            Amount: output?.Amount ?? uint64(0),
            Confirmations: if let value = paid {
                if value.BlockHeight == 0 || input.ChainHeight < value.BlockHeight {
                    uint64(0)
                } else {
                    Math.Min(uint64(10), input.ChainHeight - value.BlockHeight + 1)
                }
            } else {
                uint64(0)
            },
            Reference: possible != nil ? request.Reference: "",
            Privacy: input.Privacy,
            Language: input.Language
        }
        presentation = ReceivePresentationInput{
            Ui: input.Ui,
            Draft: draft,
            Address: input.Address,
            Format: request.Format,
            Privacy: input.Privacy,
            Busy: input.Busy,
            Paid: paid != nil,
            Language: input.Language,
            Height: input.Height,
            ChooseFile: input.ChooseFile,
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
                Cell.Mount[ReceiveStatusInput, ReceiveStatus]("payment-status", status)
            )
        )
        card.Add(Cell.Mount[ReceivePresentationInput, ReceivePresentation]("request-presentation", presentation))
        return card
    }

    private func Payment(reference bool) WalletOutput? {
        let request = input.Request
        let atoms = if request.Amount.Length > 0 && WalletValidation.AmountIssue(request.Amount).Length == 0 {
            WalletAmount.Parse(request.Amount)
        } else {
            uint64(0)
        }
        if request.Reference.Length == 0 || request.Amount.Length > 0 && atoms == 0 {
            return nil
        }
        for output in input.History {
            if output.Coinbase ||
                output.BlockHeight != 0 &&
                output.BlockHeight < request.Since ||
                request
                .ExistingOutputs
                .Contains(output.TxId + ":" + output.OutputIndex.ToString()) {
                continue
            }
            if (atoms == 0 || output.Amount == atoms) && if reference {
                output.Memo.Contains(request.Reference, StringComparison.Ordinal)
            } else {
                output.Memo == request.Memo
            } {
                return output
            }
        }
        return nil
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
                        OnChange: value -> input.Change.Invoke(value, draft.Memo)
                    }
                )
            },
            Grow(
                Container{
                    MinWidth: 0,
                    form.Field(
                        "Memo",
                        draft.Memo,
                        value -> input.Change.Invoke(draft.Amount, value),
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

    protected override func Build(input ReceivePresentationInput) Blob {
        let ui = input.Ui
        let draft = input.Draft
        let empty = draft.Amount.Length == 0 && draft.Memo.Length == 0
        let shown = if empty && input.Format == "link" {
            "address"
        } else {
            input.Format
        }
        let query = List[string]()
        if draft.Amount.Length > 0 && draft.AmountIssue.Length == 0 {
            query.Add("amount=" + draft.Amount)
        }
        if draft.FullMemo.Length > 0 && draft.MemoIssue.Length == 0 {
            query.Add("memo=" + Uri.EscapeDataString(draft.FullMemo))
        }
        let link = "blocknet://" + input.Address + if query.Count > 0 {
            "?" + String.Join("&", query)
        } else {
            ""
        }
        let ranges = List[TextStyleRange]{TextStyleRange(TextRange(0, 11), Style{Color: AppTheme.Dim})}
        var start = 11 + input.Address.Length
        for part in query {
            ranges.Add(TextStyleRange(TextRange(start, part.IndexOf('=') + 2), Style{Color: AppTheme.Dim}))
            start += part.Length + 1
        }
        let payload = shown == "address" ? input.Address: link
        if payload != qrText {
            generation++
            qrText = payload
            let encoded = QrCode.EncodeText(payload, QrCode.Ecc.Medium)
            qrCode = encoded
            qrPath = QrPath(encoded)
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
                    Container{Gap: AppTheme.Space12, FlexShrink: 0, tabs, field, action}
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
        let current = generation
        input.ChooseFile.Invoke(
            FileDialogKind.SaveFile,
            "Save QR image",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "blocknet-request.png"),
            (path string) -> {
                if current == generation {
                    input.Ui.Actions.Run(ct -> File.WriteAllBytesAsync(path, code.ToPngBitmap(4, 8), ct))
                }
            }
        )
    }

    public func Dispose() {
        generation++
    }

    private func QrPath(code QrCode) VectorPath {
        let margin = 4
        let path = PathBuilder(0, 0, code.Size + margin * 2, code.Size + margin * 2)
        var y = 0
        while y < code.Size {
            var x = 0
            while x < code.Size {
                if !code.GetModule(x, y) {
                    x++
                    continue
                }
                let start = x
                while x < code.Size && code.GetModule(x, y) {
                    x++
                }
                path.MoveTo(start + margin, y + margin)
                path.LineTo(x + margin, y + margin)
                path.LineTo(x + margin, y + margin + 1)
                path.LineTo(start + margin, y + margin + 1)
                path.Close()
            }
            y++
        }
        return path.Build()
    }
}
