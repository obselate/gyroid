package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Data
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Send
import Gyroid.Wallet
import Net.Codecrete.QrCodeGenerator
import System
import System.Collections.Generic
import System.Globalization
import System.Linq
import System.Text
import System.Threading.Tasks

partial class WalletView {
    private var requestAmount string = ""

    private var requestMemo string = ""

    private var qrText string = ""

    private var qrPath VectorPath = VectorPath.Empty

    private func ReceivePanel(receiving string) Blob {
        let panel = PageContent(strings.Get("receive"), 640)
        if receiving.Length == 0 {
            return panel
        }
        let amountIssue = AmountIssue(requestAmount)
        let memoIssue = MemoIssue(requestMemo)
        let query = List[string]()
        if requestAmount.Length > 0 && amountIssue.Length == 0 {
            query.Add("amount=" + requestAmount)
        }
        if requestMemo.Length > 0 && memoIssue.Length == 0 {
            query.Add("memo=" + Uri.EscapeDataString(requestMemo))
        }
        let request = if query.Count > 0 {
            "blocknet://" + receiving + "?" + String.Join("&", query)
        } else {
            receiving
        }
        if request != qrText {
            qrText = request
            qrPath = QrPath(request)
        }
        let size = Math.Clamp(height - 230 - bannerHeight, 160.0, 300.0)
        let copied = ReadOnlySpan[char](clipboardText).SequenceEqual(System.MemoryExtensions.AsSpan(receiving))
        panel.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: 24,
                FlexShrink: 0,
                if privacy {
                    Container{
                        Width: size,
                        Height: size,
                        FlexShrink: 0,
                        BackgroundColor: surface,
                        BorderWidth: 1,
                        BorderColor: edge,
                        BorderRadius: 4,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.Center,
                        Accessibility: Accessibility{
                            Role: AccessibilityRole.Image,
                            Name: strings.Get("Address QR code hidden")
                        },
                        MaterialIcons.Create("visibility_off", 32, dim)
                    }
                } else {
                    Container{
                        Width: size,
                        Height: size,
                        FlexShrink: 0,
                        BackgroundColor: ink,
                        BorderRadius: 4,
                        Accessibility: Accessibility{
                            Role: AccessibilityRole.Image,
                            Name: strings.Get("Address QR code")
                        },
                        Shape{Width: size, Height: size, Path: qrPath, Fit: ShapeFit.Fill, BackgroundColor: black}
                    }
                },
                Grow(
                    Container{
                        Gap: 16,
                        JustifyContent: JustifyContent.Center,
                        Container{
                            Gap: 6,
                            Label(strings.Get("Address"), 12, body),
                            Container{
                                FlexDirection: FlexDirection.Row,
                                AlignItems: AlignItems.FlexStart,
                                Gap: 8,
                                Grow(
                                    Text{
                                        Content: if privacy {
                                            "•••••••• •••••••• •••••••• ••••••••"
                                        } else {
                                            Grouped(receiving)
                                        },
                                        FontFamily: font,
                                        FontSize: 14,
                                        Color: ink,
                                        TextWrap: TextWrap.Wrap,
                                        Accessibility: Accessibility{
                                            Name: if privacy {
                                                strings.Get("Address hidden")
                                            } else {
                                                strings.Get("Address") + " " + receiving
                                            }
                                        }
                                    }
                                ),
                                IconButton{
                                    Icon: MaterialIcons.Create(
                                        if copied {
                                            "check"
                                        } else {
                                            "content_copy"
                                        },
                                        16,
                                        if copied {
                                            lime
                                        } else {
                                            body
                                        }
                                    ),
                                    AccessibilityName: strings.Get("Copy address"),
                                    OnClick: () -> {
                                        Copy(receiving, 120000)
                                        Rebuild()
                                    }
                                }.Build()
                            }
                        },
                        Field(
                            "Amount",
                            requestAmount,
                            value -> {
                                requestAmount = value.Trim()
                                Rebuild()
                            },
                            issue: amountIssue
                        ),
                        Field(
                            "Memo",
                            requestMemo,
                            value -> {
                                requestMemo = value
                                Rebuild()
                            },
                            issue: memoIssue
                        ),
                        if request != receiving {
                            Copyable("Request", request, Hidden("blocknet://…?" + String.Join("&", query)))
                        } else {
                            Container{}
                        }
                    }
                )
            }
        )
        return panel
    }

    private func QrPath(content string) VectorPath {
        let code = QrCode.EncodeText(content, QrCode.Ecc.Medium)
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
