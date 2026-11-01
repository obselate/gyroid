package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
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
    var Clipboard[]char
    var Height float64
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
}

class ReceivePage : Cell[ReceivePageInput] {
    private var qrText string = ""

    private var qrCode QrCode?

    private var qrPath VectorPath = VectorPath.Empty

    protected override func Build(input ReceivePageInput) Blob {
        let ui = input.Ui
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
        let amountIssue = WalletValidation.AmountIssue(request.Amount)
        let memoIssue = WalletValidation.MemoIssue(full)
        let shown = if empty && request.Format == "link" {
            "address"
        } else {
            request.Format
        }
        let query = List[string]()
        if request.Amount.Length > 0 && amountIssue.Length == 0 {
            query.Add("amount=" + request.Amount)
        }
        if full.Length > 0 && memoIssue.Length == 0 {
            query.Add("memo=" + Uri.EscapeDataString(full))
        }
        let link = "blocknet://" + input.Address + if query.Count > 0 {
            "?" + String.Join("&", query)
        } else {
            ""
        }
        let dim = List[TextStyleRange]{TextStyleRange(TextRange(0, 11), Style{Color: AppTheme.Dim})}
        var start = 11 + input.Address.Length
        for part in query {
            dim.Add(TextStyleRange(TextRange(start, part.IndexOf('=') + 2), Style{Color: AppTheme.Dim}))
            start += part.Length + 1
        }
        let payload = if shown == "address" {
            input.Address
        } else {
            link
        }
        if payload != qrText {
            let encoded = QrCode.EncodeText(payload, QrCode.Ecc.Medium)
            qrText = payload
            qrCode = encoded
            qrPath = QrPath(encoded)
        }
        let paid = Payment(input, true)
        let possible = if paid == nil && request.Amount.Length > 0 {
            Payment(input, false)
        } else {
            nil
        }
        let status = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: AppTheme.Space8}
        if let output = paid {
            let confirmations = Confirmations(input, output)
            status.Add(MaterialIcons.Create("check", AppTheme.Icon14, AppTheme.Lime))
            status.Add(Label(ui, Amount(ui.Privacy, output.Amount), AppTheme.Type13, AppTheme.Ink, ""))
            if confirmations < 10 {
                status.Add(Label(ui, confirmations.ToString() + "/10", AppTheme.Type13, AppTheme.Dim, ""))
            }
        } else if let output = possible {
            status.Add(
                Label(
                    ui,
                    ui.Strings.Get("possible payment") + " " + Amount(ui.Privacy, output.Amount),
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
                                .Replace("{0}", request.Reference)
                        },
                        Language: input.Language,
                        Width: 300
                    }
                )
            )
        }
        let side = Math.Clamp(input.Height - 340, 180.0, 400.0)
        let code = Container{
            Width: side,
            Height: side,
            BorderRadius: AppTheme.Radius10,
            Overflow: Overflow.Hidden,
            BackgroundColor: if input.Privacy || paid != nil {
                AppTheme.Surface
            } else {
                AppTheme.Ink
            },
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: ui.Strings.Get(
                    if input.Privacy {
                        "Address QR code hidden"
                    } else {
                        "Payment request QR code"
                    }
                )
            }
        }
        if input.Privacy {
            code.Add(MaterialIcons.Create("visibility_off", AppTheme.Icon32, AppTheme.Dim))
        } else if paid != nil {
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
        let copied = shown != "qr" && ReadOnlySpan[char](input.Clipboard).SequenceEqual(
            System.MemoryExtensions.AsSpan(payload)
        )
        let options = List[NavigationItem]()
        if !empty {
            options.Add(NavigationItem{Id: "link", Label: ui.Strings.Get("Link")})
        }
        options.Add(NavigationItem{Id: "address", Label: ui.Strings.Get("Address")})
        options.Add(NavigationItem{Id: "qr", Label: ui.Strings.Get("QR")})
        let tabs = Tabs(
            ui,
            "share-as",
            "Share as",
            options.ToArray(),
            shown,
            id -> {
                request.Format = id
                Rebuild()
            },
            true
        )
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
                dim.ToArray()
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
            copied ? AppTheme.Mint: AppTheme.Edge
        )
        field.MinHeight = 72
        field.Accessibility = Accessibility{Role: AccessibilityRole.Status}
        if shown == "link" {
            field.Accessibility = Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get("Copy link")}
            field.Disabled = input.Busy || amountIssue.Length > 0 || memoIssue.Length > 0
            field.OnClick = () -> ui.Actions.Copy(payload, 120000)
            WidgetKeyBindings.BindActivation(field)
        }
        let disabled = input.Busy || shown != "address" && (amountIssue.Length > 0 || memoIssue.Length > 0)
        let action = if paid != nil {
            Action(
                input,
                "add",
                "New request",
                AppTheme.Ink,
                AppTheme.Edge,
                AppTheme.Raised,
                disabled,
                () -> {
                    request.Amount = ""
                    request.Memo = ""
                    request.Reference = ""
                    Rebuild()
                }
            )
        } else if copied {
            Action(input, "check", "Copied", AppTheme.Mint, AppTheme.Mint, AppTheme.MintQuiet, disabled, () -> { })
        } else if shown == "qr" {
            Action(
                input,
                "download",
                "Save QR image",
                AppTheme.Lime,
                AppTheme.Lime,
                AppTheme.LimeQuiet,
                disabled,
                () -> SaveQr(input)
            )
        } else {
            Action(
                input,
                "content_copy",
                shown == "link" ? "Copy link": "Copy address",
                AppTheme.Lime,
                AppTheme.Lime,
                AppTheme.LimeQuiet,
                disabled,
                () -> ui.Actions.Copy(payload, 120000)
            )
        }
        let card = WalletParts.PageCard(
            ui,
            900,
            input.Height,
            fill: true,
            padding: input.Height < 700 ? AppTheme.Space16: AppTheme.Space22,
            gap: AppTheme.Space16
        )
        let form = WalletForm(ui, false, nil, []string{})
        card.Add(
            WalletParts.Header(
                Label(ui, ui.Strings.Get("receive"), AppTheme.Type17, AppTheme.Ink, ""),
                AppTheme.Space12,
                status
            )
        )
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space28,
                MinHeight: 0,
                Container{
                    FlexShrink: 0,
                    Padding: AppTheme.Space4,
                    BorderWidth: AppTheme.Border2,
                    BorderRadius: AppTheme.Radius14,
                    BorderColor: shown == "qr" && paid == nil ? AppTheme.Lime: Color.Transparent,
                    Margin: -AppTheme.Space6,
                    code
                },
                Grow(
                    Container{
                        Gap: AppTheme.Space16,
                        Container{
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
                                        Value: request.Amount,
                                        Controlled: true,
                                        Password: input.Privacy,
                                        Disabled: input.Busy || paid != nil,
                                        Invalid: amountIssue.Length > 0,
                                        IssueText: if amountIssue.Length > 0 {
                                            ui.Strings.Explain(amountIssue)
                                        } else {
                                            nil
                                        },
                                        OnChange: value -> {
                                            request.Amount = value.Trim()
                                            Rebuild()
                                        }
                                    }
                                )
                            },
                            Grow(
                                Container{
                                    MinWidth: 0,
                                    form.Field(
                                        "Memo",
                                        request.Memo,
                                        value -> {
                                            request.Memo = value
                                            Rebuild()
                                        },
                                        issue: memoIssue,
                                        disabled: input.Busy || paid != nil,
                                        labelled: false,
                                        hidden: input.Privacy,
                                        placeholder: ui.Strings.Get("memo"),
                                        leading: MaterialIcons.Create("notes", AppTheme.Icon16, AppTheme.Dim),
                                        trailing: Container{
                                            FlexDirection: FlexDirection.Row,
                                            AlignItems: AlignItems.Center,
                                            Gap: AppTheme.Space8,
                                            Label(
                                                ui,
                                                Hidden(ui.Privacy, request.Reference),
                                                AppTheme.Type14,
                                                AppTheme.Dim,
                                                ""
                                            ),
                                            Meter(
                                                ui,
                                                Encoding.UTF8.GetByteCount(full),
                                                WalletValidation.MemoLimit,
                                                true
                                            )
                                        }
                                    )
                                }
                            )
                        },
                        Container{Gap: AppTheme.Space12, FlexShrink: 0, tabs, field, action}
                    }
                )
            }
        )
        return card
    }

    private func Action(
        input ReceivePageInput,
        icon string,
        label string,
        color Color,
        border Color,
        fill Color,
        disabled bool,
        click Action
    ) Blob -> ControlParts
        .Button(
        input.Ui,
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

    private func Payment(input ReceivePageInput, reference bool) WalletOutput? {
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

    private func Confirmations(input ReceivePageInput, output WalletOutput) uint64 -> if output.BlockHeight == 0 ||
        input.ChainHeight < output.BlockHeight {
        uint64(0)
    } else {
        input.ChainHeight - output.BlockHeight + 1
    }

    private func SaveQr(input ReceivePageInput) {
        guard let code = qrCode else {
            return
        }
        input.ChooseFile.Invoke(
            FileDialogKind.SaveFile,
            "Save QR image",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "blocknet-request.png"),
            (path string) -> input.Ui.Actions.Run(ct -> File.WriteAllBytesAsync(path, code.ToPngBitmap(4, 8), ct))
        )
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
