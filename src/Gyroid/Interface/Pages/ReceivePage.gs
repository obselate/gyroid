package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Gyroid.History
import Gyroid.Wallet
import Net.Codecrete.QrCodeGenerator
import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Threading.Tasks

class ReceiveRequest {
    var Amount string = ""
    var Memo string = ""
    var Reference string = ""
    var Since uint64
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
        }
        let full = if request.Memo.Length > 0 {
            request.Memo + " " + request.Reference
        } else {
            request.Reference
        }
        let amountIssue = ui.AmountIssue(request.Amount)
        let memoIssue = ui.MemoIssue(full)
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
        let dim = List[TextStyleRange]{TextStyleRange(TextRange(0, 11), Style{Color: ui.Dim})}
        var start = 11 + input.Address.Length
        for part in query {
            dim.Add(TextStyleRange(TextRange(start, part.IndexOf('=') + 2), Style{Color: ui.Dim}))
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
        let paid = Payment(input, full)
        let possible = if paid == nil && request.Amount.Length > 0 {
            Payment(input, request.Memo)
        } else {
            nil
        }
        let status = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8}
        if let output = paid {
            let confirmations = Confirmations(input, output)
            status.Add(MaterialIcons.Create("check", 14, ui.Lime))
            status.Add(ui.Label(ui.Amount(output.Amount), 12.5, ui.Ink, ""))
            if confirmations < 10 {
                status.Add(ui.Label(confirmations.ToString() + "/10", 12.5, ui.Dim, ""))
            }
        } else if let output = possible {
            status.Add(ui.Badge(ui.Strings.Get("possible payment"), ui.Orange, "warning"))
            status.Add(ui.Label(ui.Amount(output.Amount), 14, ui.Ink, ""))
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
        let side = Math.Clamp(input.Height - 340, 180.0, 320.0)
        let code = Container{
            Width: side,
            Height: side,
            BorderRadius: 10,
            Overflow: Overflow.Hidden,
            BackgroundColor: if input.Privacy || paid != nil {
                ui.Surface
            } else {
                ui.Ink
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
            code.Add(MaterialIcons.Create("visibility_off", 32, ui.Dim))
        } else if paid != nil {
            code.Add(
                Shape{
                    Position: PositionType.Absolute,
                    Width: side,
                    Height: side,
                    Path: qrPath,
                    Fit: ShapeFit.Fill,
                    BackgroundColor: ui.Rule
                }
            )
            code.Add(MaterialIcons.Create("check", 56, ui.Mint))
        } else {
            code.Add(Shape{Width: side, Height: side, Path: qrPath, Fit: ShapeFit.Fill, BackgroundColor: ui.Black})
        }
        let copied = ReadOnlySpan[char](input.Clipboard).SequenceEqual(System.MemoryExtensions.AsSpan(payload))
        let tabs = Container{
            FlexDirection: FlexDirection.Row,
            Padding: 3,
            BorderRadius: 10,
            BackgroundColor: ui.Black,
            BorderWidth: 1,
            BorderColor: ui.Rule,
            FlexShrink: 0,
            Accessibility: Accessibility{Role: AccessibilityRole.TabList, Name: ui.Strings.Get("Share as")}
        }
        for (id, label) in[]KeyValuePair[string, string]{
            KeyValuePair[string, string]("link", "Link"),
            KeyValuePair[string, string]("address", "Address"),
            KeyValuePair[string, string]("qr", "QR")
        } {
            if id == "link" && empty {
                continue
            }
            tabs.Add(
                Goo
                    .Button{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    Height: 28,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    BorderRadius: 7,
                    BackgroundColor: shown == id ? Color.Parse("#1a1a1a"): Color.Transparent,
                    Hover: Style{BackgroundColor: ui.Rule},
                    Focus: Theme.Read().FocusStyle,
                    Accessibility: Accessibility{
                        Role: AccessibilityRole.Tab,
                        Name: ui.Strings.Get(label),
                        Selected: shown == id
                    },
                    OnClick: () -> {
                        request.Format = id
                        Rebuild()
                    },
                    ui.Label(ui.Strings.Get(label), 13, shown == id ? ui.Ink: ui.Body, "")
                }
            )
        }
        let grouped = ui.Grouped(input.Address)
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
                    TextStyleRange(TextRange(first, grouped.LastIndexOf(' ') - first), Style{Color: ui.Body})
                }
            } else if shown == "qr" {
                []TextStyleRange{TextStyleRange(TextRange(0, link.Length), Style{Color: ui.Dim})}
            } else {
                dim.ToArray()
            },
            FontFamily: ui.Font,
            FontSize: 12.5,
            Color: ui.Ink,
            TextWrap: TextWrap.Wrap
        }
        let action = if paid != nil {
            Action(
                input,
                "add",
                "New request",
                ui.Ink,
                ui.Edge,
                Color.Parse("#0b0b0b"),
                "",
                () -> {
                    request.Amount = ""
                    request.Memo = ""
                    request.Reference = ""
                    Rebuild()
                }
            )
        } else if copied {
            Action(input, "check", "Copied", ui.Mint, ui.Mint, Color.Parse("#00140d"), "clears in 2 min", () -> { })
        } else if shown == "qr" {
            Action(
                input,
                "download",
                "Save QR image",
                ui.Lime,
                ui.Lime,
                Color.Parse("#0b1203"),
                "",
                () -> SaveQr(input)
            )
        } else {
            Action(
                input,
                "content_copy",
                shown == "link" ? "Copy link": "Copy address",
                ui.Lime,
                ui.Lime,
                Color.Parse("#0b1203"),
                "",
                () -> ui.Copy(payload, 120000)
            )
        }
        let card = ui.Glass()
        card.Width = Percent(100)
        card.MaxWidth = 900
        card.MaxHeight = Percent(100)
        card.BorderRadius = 14
        card.Padding = input.Height < 700 ? 18.0: 22.0
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Gap: 12,
                MinHeight: 26,
                FlexShrink: 0,
                ui.Label(ui.Strings.Get("receive"), 17, ui.Ink, ""),
                status
            }
        )
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 28,
                MinHeight: 0,
                Container{
                    FlexShrink: 0,
                    Padding: 4,
                    BorderWidth: 2,
                    BorderRadius: 14,
                    BorderColor: shown == "qr" && paid == nil ? ui.Lime: Color.Transparent,
                    Margin: -6,
                    code
                },
                ui.Grow(
                    Container{
                        Gap: 18,
                        Container{
                            FlexDirection: FlexDirection.Row,
                            Gap: 10,
                            FlexShrink: 0,
                            Container{
                                FlexGrow: 0.7,
                                TextAlign: TextAlign.Right,
                                FlexBasis: 0,
                                MinWidth: 0,
                                ui.Entry(
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
                                        Trailing: ui.Label("BNT", 12, ui.Dim, ""),
                                        OnChange: value -> {
                                            request.Amount = value.Trim()
                                            Rebuild()
                                        }
                                    }
                                )
                            },
                            ui.Grow(
                                Container{
                                    MinWidth: 0,
                                    ui.Entry(
                                        TextField{
                                            AccessibilityName: ui.Strings.Get("Memo"),
                                            Placeholder: ui.Strings.Get("memo"),
                                            Value: request.Memo,
                                            Controlled: true,
                                            Password: input.Privacy,
                                            Disabled: input.Busy || paid != nil,
                                            Invalid: memoIssue.Length > 0,
                                            IssueText: if memoIssue.Length > 0 {
                                                ui.Strings.Explain(memoIssue)
                                            } else {
                                                nil
                                            },
                                            Leading: MaterialIcons.Create("notes", 16, ui.Dim),
                                            Trailing: Container{
                                                FlexDirection: FlexDirection.Row,
                                                AlignItems: AlignItems.Center,
                                                Gap: 8,
                                                ui.Label(ui.Hidden(request.Reference), 14, ui.Dim, ""),
                                                ui.Meter(
                                                    Encoding.UTF8.GetByteCount(full),
                                                    WalletValidation.MemoLimit,
                                                    true
                                                )
                                            },
                                            OnChange: value -> {
                                                request.Memo = value
                                                Rebuild()
                                            }
                                        }
                                    )
                                }
                            )
                        },
                        Container{
                            Gap: 12,
                            FlexShrink: 0,
                            tabs,
                            Container{
                                MinHeight: 72,
                                Padding: Edges{Left: 14, Right: 14, Top: 12, Bottom: 12},
                                BorderWidth: 1,
                                BorderRadius: 8,
                                BorderColor: copied ? ui.Mint: Color.Parse("#2a2a2a"),
                                BackgroundColor: Color.Parse("#080808"),
                                Accessibility: Accessibility{Role: AccessibilityRole.Status},
                                preview
                            },
                            action
                        }
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
        note string,
        click Action
    ) Blob {
        let ui = input.Ui
        let button = Goo
            .Button{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Gap: 8,
            Height: 38,
            FlexShrink: 0,
            BorderWidth: 1,
            BorderRadius: 8,
            BorderColor: border,
            BackgroundColor: fill,
            Disabled: input.Busy,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get(label)},
            OnClick: click,
            MaterialIcons.Create(icon, 16, color),
            ui.Label(ui.Strings.Get(label), 14, color, "")
        }
        if note.Length > 0 {
            button.Add(ui.Label(ui.Strings.Get(note), 14, ui.Dim, ""))
        }
        return button
    }

    private func Payment(input ReceivePageInput, expected string) WalletOutput? {
        let request = input.Request
        let atoms = if request.Amount.Length > 0 && input.Ui.AmountIssue(request.Amount).Length == 0 {
            WalletAmount.Parse(request.Amount)
        } else {
            uint64(0)
        }
        if request.Reference.Length == 0 || request.Amount.Length > 0 && atoms == 0 {
            return nil
        }
        for output in input.History {
            if (output.BlockHeight == 0 || output.BlockHeight >= request.Since) &&
                output.Memo == expected &&
                (atoms == 0 || output.Amount == atoms) {
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
            (path string) -> input.Ui.Run(File.WriteAllBytesAsync(path, code.ToPngBitmap(4, 8)))
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
