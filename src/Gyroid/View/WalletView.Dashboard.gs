package Gyroid.View

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Data
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Model
import Gyroid.Services
import Net.Codecrete.QrCodeGenerator
import System
import System.Collections.Generic
import System.Globalization
import System.Linq
import System.Text

partial class WalletView {
    private var address string = ""
    private var amount string = ""
    private var memo string = ""
    private var estimate SendEstimate?
    private var historyTab string = "received"
    private var confirmPendingSend bool
    private var revealPassword string = ""
    private var historySource WalletSnapshot?
    private var outputs[]WalletOutput
    private var sends[]WalletSend
    private var qrText string = ""
    private var qrPath VectorPath = VectorPath.Empty
    private let receivedRow Func[WalletOutput, Blob]
    private let sentRow Func[WalletSend, Blob]

    private func Money(value uint64) string -> WalletAmount.Format(value)

    private func Hidden(value string) string -> if privacy {
        "••••••••"
    } else {
        value
    }

    private func Amount(value uint64) string -> Hidden(Money(value))

    private func Count(value uint64) string -> value.ToString("N0", CultureInfo.InvariantCulture)

    private func Grouped(value string) string {
        let groups = List[string]()
        var start = 0
        while start < value.Length {
            groups.Add(value.Substring(start, Math.Min(8, value.Length - start)))
            start += 8
        }
        return String.Join(" ", groups)
    }

    private func Grow(blob Blob) Blob {
        blob.FlexGrow = 1
        blob.FlexBasis = 0
        blob.MinWidth = 0
        return blob
    }

    private func Dashboard() Blob {
        let snapshot = wallet.Snapshot
        let content = Container{Gap: 16, FlexGrow: 1, FlexBasis: 0, MinHeight: 0}
        if wallet.Pending != nil || wallet.SendOutcome.Length > 0 {
            content.Add(PendingSendBanner())
        }
        content.Add(Balance(snapshot))
        content.Add(History(snapshot))
        return content
    }

    private func Stat(label string, value string, color Color) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Baseline,
        JustifyContent: JustifyContent.SpaceBetween,
        Gap: 16,
        Accessibility: Accessibility{Name: strings.Get(label) + " " + value},
        Label(strings.Get(label), 12, body),
        Label(value, 16, color, "balance")
    }

    private func Balance(snapshot WalletSnapshot) Blob {
        let balance = snapshot.Balance
        var total = if balance?.Scanning == true {
            strings.Get("Scanning")
        } else {
            strings.Get("Unavailable")
        }
        var totalColor = if balance?.Scanning == true {
            orange
        } else {
            body
        }
        var spendable = strings.Get("Unavailable")
        var pending = strings.Get("Unavailable")
        var pendingColor = body
        if let units = balance?.Balance {
            total = Amount(units)
            totalColor = lime
        }
        if let units = balance?.Spendable {
            spendable = Amount(units)
        }
        if let units = balance?.Pending {
            pending = Amount(units)
            pendingColor = if units > 0 {
                orange
            } else {
                ink
            }
        }
        let room = width - 248 - 40 - 280 - 49
        let size = Math.Max(24, Math.Min(height * 0.07, room / (0.6 * (total.Length + 4))))
        let unit = if balance?.Balance != nil {
            " BNT"
        } else {
            ""
        }
        let figure = Label(total + unit, size, totalColor, "balance")
        if unit.Length > 0 {
            figure.StyleRanges = (figure.StyleRanges ?? Array.Empty[TextStyleRange]()).Append(
                TextStyleRange(TextRange(total.Length, unit.Length), Style{FontSize: 18, Color: body})
            )
                .ToArray()
        }
        let hero = Glass()
        hero.FlexShrink = 0
        hero.FlexDirection = FlexDirection.Row
        hero.AlignItems = AlignItems.Center
        hero.Gap = 24
        hero.BorderWidth = Edges{Left: 3, Top: 1, Right: 1, Bottom: 1}
        hero.BorderStartColor = lime
        hero.Add(
            Grow(
                Container{
                    Gap: 4,
                    Accessibility: Accessibility{Name: strings.Get("Balance") + " " + total},
                    Label(strings.Get("Balance"), 12, body),
                    figure
                }
            )
        )
        hero.Add(Container{Width: 1, AlignSelf: AlignSelf.Stretch, BackgroundColor: rule})
        hero.Add(
            Container{
                Width: 280,
                FlexShrink: 0,
                Gap: 12,
                Stat("Spendable", spendable, ink),
                Stat("Pending", pending, pendingColor)
            }
        )
        return hero
    }

    private func Chain(snapshot WalletSnapshot) Blob {
        guard let value = snapshot.Balance else {
            return Figure("Height", strings.Get("Unavailable"), body)
        }
        if value.Scanning {
            return Figure("Height", Count(value.ScanHeight) + " / " + Count(value.ChainHeight), orange, 14, "sync")
        }
        return Figure("Height", Count(value.ChainHeight), ink, 14, "sync")
    }

    private func AmountIssue() string {
        if amount.Length == 0 {
            return ""
        }
        try {
            let atoms = WalletAmount.Parse(amount)
            if let available = wallet.Snapshot.Balance?.Spendable {
                if atoms > available {
                    return "Exceeds spendable balance"
                }
            }
            return ""
        } catch (error WalletException) {
            return error.Message
        }
    }

    private func MemoIssue() string {
        try {
            WalletController.MemoBytes(memo)
            return ""
        } catch (error WalletException) {
            return error.Message
        }
    }

    private func PendingSendBanner() Blob {
        let pending = wallet.Pending
        let content = Glass()
        content.FlexShrink = 0
        content.Gap = 10
        content.Add(Label(strings.Get("Pending send"), 14, orange))
        let outcome = wallet.SendOutcome
        let message = if let value = pending {
            strings.Get(value.State)
        } else if outcome.StartsWith("Submitted: ", StringComparison.Ordinal) {
            strings.Get("Submitted") + ": " + outcome.Substring(11)
        } else {
            strings.Get("Send failed") + ": " + outcome.Replace("Send failed: ", "")
        }
        content.Add(Text{Content: message, FontFamily: font, FontSize: 13, Color: ink, TextWrap: TextWrap.Wrap})
        content.Add(
            ActionRow(
                []Blob{
                    Button(
                        if pending?.Retryable == true {
                            "Resubmit"
                        } else {
                            "Dismiss"
                        },
                        () -> {
                            confirmPendingSend = true
                            Rebuild()
                        },
                        Working()
                    )
                }
            )
        )
        return content
    }

    private func ConfirmPendingSend() Blob {
        let resume = wallet.Pending?.Retryable == true
        let close Action = () -> {
            confirmPendingSend = false
            Rebuild()
        }
        return ModalDialog{
            Open: true,
            AccessibilityName: strings.Get("Pending send"),
            Width: Math.Min(width - 48, 600),
            Content: Text{
                Content: strings.Get(
                    if resume {
                        "Resubmitting an unknown send can pay twice if the node forgot its record"
                    } else {
                        "Dismissing does not cancel a payment. Sending again can pay twice"
                    }
                ),
                FontFamily: font,
                FontSize: 14,
                Color: orange,
                TextWrap: TextWrap.Wrap
            },
            ConfirmText: strings.Get(
                if resume {
                    "Resubmit"
                } else {
                    "Dismiss"
                }
            ),
            CancelText: strings.Get("Cancel"),
            ConfirmDisabled: Working(),
            OnConfirm: () -> {
                confirmPendingSend = false
                if resume {
                    Run(wallet.ResumeSendAsync(), () -> Refresh())
                } else {
                    Run(wallet.DismissSendAsync())
                }
            },
            OnCancel: close,
            OnClose: close
        }.Build()
    }

    private func SendPanel() Blob {
        if wallet.Pending != nil || wallet.SendOutcome.Length > 0 {
            let card = PageContent(strings.Get("send"), 640)
            card.Add(PendingSendBanner())
            return card
        }
        let blank = address.Trim().Length == 0 || amount.Trim().Length == 0
        let amountIssue = AmountIssue()
        let memoIssue = MemoIssue()
        let remaining = WalletController.MemoLimit - Encoding.UTF8.GetByteCount(memo)
        let card = PageContent(
            strings.Get("send"),
            640,
            if let units = wallet.Snapshot.Balance?.Spendable {
                Figure("Spendable", Amount(units) + " BNT", lime, 14)
            } else {
                nil
            }
        )
        let memoField = Container{
            MinWidth: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            Grow(
                Container{
                    MinWidth: 0,
                    Field(
                        "Memo",
                        memo,
                        value -> {
                            memo = value
                            Rebuild()
                        },
                        () -> Review(),
                        issue: memoIssue
                    )
                }
            )
        }
        if remaining >= 0 && remaining < 25 {
            memoField.Add(Label(remaining.ToString(CultureInfo.InvariantCulture), 12, body))
        }
        card.Add(
            Field(
                "Address",
                address,
                value -> {
                    address = value.Trim()
                    Rebuild()
                },
                () -> Review()
            )
        )
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: 16,
                FlexShrink: 0,
                Grow(
                    Container{
                        MinWidth: 0,
                        Field(
                            "Amount",
                            amount,
                            value -> {
                                amount = value
                                Rebuild()
                            },
                            () -> Review(),
                            issue: amountIssue
                        )
                    }
                ),
                Grow(memoField)
            }
        )
        card.Add(
            ActionRow(
                []Blob{
                    Button(
                        "Review",
                        () -> Review(),
                        Working() || blank || amountIssue.Length > 0 || memoIssue.Length > 0,
                        true
                    )
                }
            )
        )
        return card
    }

    private func Review() {
        if Working() || address.Trim().Length == 0 || amount.Trim().Length == 0 {
            return
        }
        let task = wallet.EstimateAsync(address, amount, memo)
        Run(
            task,
            () -> {
                estimate = task.Result
            }
        )
    }

    private func Submit() {
        guard let pending = estimate else {
            return
        }
        if Working() {
            return
        }
        estimate = nil
        Run(
            wallet.SubmitAsync(pending),
            () -> {
                address = ""
                amount = ""
                memo = ""
                historyTab = "sent"
                screen = "Transactions"
                Refresh()
            }
        )
    }

    private func ConfirmSend(pending SendEstimate) Blob {
        let close Action = () -> {
            estimate = nil
            Rebuild()
        }
        let recipient = Container{
            Gap: 6,
            Accessibility: Accessibility{Name: strings.Get("Recipient") + " " + pending.Handle + " " + pending.Address},
            Label(strings.Get("Recipient"), 12, body)
        }
        if pending.Handle.Length > 0 {
            recipient.Add(Label(pending.Handle, 16, lime, ""))
        }
        recipient.Add(
            Text{Content: Grouped(pending.Address), FontFamily: font, FontSize: 14, Color: ink, TextWrap: TextWrap.Wrap}
        )
        let content = Container{
            Gap: 14,
            Accent(pink, recipient),
            Figure("Amount", Money(pending.Amount) + " BNT", ink),
            Figure("Fee", Money(pending.Fee) + " BNT", ink),
            Figure("Total", Money(pending.Total) + " BNT", lime, 18)
        }
        if pending.Memo.Length > 0 {
            content.Add(Figure("Memo", pending.Memo, ink))
        }
        return ModalDialog{
            Open: true,
            AccessibilityName: strings.Get("Confirm send"),
            Width: Math.Min(width - 48, 600),
            Content: content,
            ConfirmText: strings.Get("Send"),
            CancelText: strings.Get("Cancel"),
            ConfirmDisabled: Working(),
            OnConfirm: () -> Submit(),
            OnCancel: close,
            OnClose: close
        }.Build()
    }

    private func RevealSeed() {
        if Working() || revealPassword.Length == 0 {
            return
        }
        let buffer = revealPassword.ToCharArray()
        revealPassword = ""
        seedFromWallet = true
        Run(wallet.RevealSeedAsync(buffer), nil, buffer)
    }

    private func ReceivePanel(receiving string) Blob {
        let panel = PageContent(strings.Get("receive"), 640)
        if receiving.Length == 0 {
            return panel
        }
        if receiving != qrText {
            qrText = receiving
            qrPath = QrPath(receiving)
        }
        let size = Math.Clamp(height - 230 - bannerHeight, 160.0, 300.0)
        let copied = clipboardText == receiving
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
                        Gap: 6,
                        JustifyContent: JustifyContent.Center,
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

    private func History(snapshot WalletSnapshot) Blob {
        if !Object.ReferenceEquals(historySource, snapshot) {
            historySource = snapshot
            outputs = snapshot.History.OrderByDescending((output WalletOutput) -> output.BlockHeight).ToArray()
            sends = snapshot.Sends.OrderByDescending((send WalletSend) -> send.Timestamp).ToArray()
        }
        let list = if historyTab == "sent" {
            VirtualRows(
                sends,
                56,
                (send WalletSend) -> send.TxId + privacy.ToString() + strings.Language,
                sentRow,
                false
            )
        } else {
            VirtualRows(
                outputs,
                44,
                (output WalletOutput) -> output.TxId + ":" + output.OutputIndex.ToString() + privacy.ToString() +
                    strings.Language,
                receivedRow,
                false
            )
        }
        list.FlexGrow = 1
        list.FlexBasis = 0
        list.MinHeight = 0
        list.ScrollbarY = Theme.Read().Scrollbar
        let rows = if historyTab == "sent" {
            sends.Length
        } else {
            outputs.Length
        }
        let panel = Glass()
        panel.FlexGrow = 1
        panel.AlignSelf = AlignSelf.Stretch
        panel.Padding = Edges{Top: 12, Left: 20, Right: 20, Bottom: 8}
        panel.Gap = 12
        panel.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Gap: 16,
                FlexShrink: 0,
                Grow(
                    Container{
                        MinWidth: 0,
                        Cell.Mount[TabBarInput, TabBar](
                            "history-tabs",
                            TabBarInput{
                                Items: []NavigationItem{
                                    NavigationItem{
                                        Id: "received",
                                        Label: strings.Get("received") + " " + outputs.Length.ToString()
                                    },
                                    NavigationItem{
                                        Id: "sent",
                                        Label: strings.Get("sent") + " " + sends.Length.ToString()
                                    }
                                },
                                SelectedId: historyTab,
                                AccessibilityName: strings.Get("Transactions"),
                                CreateItem: (bar TabBarInput, item NavigationItem, button Button) -> {
                                    button.BorderRadius = 4
                                    button.Overflow = Overflow.Hidden
                                    return button
                                },
                                OnSelect: id -> {
                                    historyTab = id
                                    Rebuild()
                                }
                            }
                        )
                    }
                ),
                Chain(snapshot)
            }
        )
        if rows > 0 {
            panel.Add(Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, Overflow: Overflow.Hidden, list})
        }
        return panel
    }

    private func ReceivedRow(output WalletOutput) Blob -> Container{
        Height: 44,
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 16,
        Padding: Edges{Left: 13, Right: 16},
        BorderWidth: Edges{Left: 3, Bottom: 1},
        BorderColor: rule,
        BorderStartColor: if output.Spent {
            edge
        } else {
            mint
        },
        Container{
            Width: 200,
            FlexShrink: 0,
            Label(
                "+" + Amount(output.Amount),
                14,
                if output.Spent {
                    body
                } else {
                    mint
                }
            )
        },
        Grow(
            Label(
                Hidden(
                    if output.Memo.Length > 0 {
                        output.Memo
                    } else {
                        output.TxId
                    }
                ),
                12,
                body
            )
        ),
        Label(Count(output.BlockHeight), 12, body)
    }

    private func SentRow(send WalletSend) Blob {
        let confirmed = send.Status == "confirmed"
        let status = if confirmed {
            strings.Get("Confirmed") + " " + Count(send.Confirmations)
        } else if send.Status == "mempool" {
            strings.Get("Mempool")
        } else if send.Status == "not_found" {
            strings.Get("Not found")
        } else {
            send.Status
        }
        let notes = Container{
            Gap: 4,
            Label(
                Hidden(String.Join(" ", send.Recipients.Select((recipient WalletRecipient) -> recipient.Address))),
                12,
                body
            )
        }
        let memos = String.Join(
            " ",
            send
                .Recipients
                .Select((recipient WalletRecipient) -> recipient.Memo)
                .Where((memo string) -> memo.Length > 0)
        )
        if memos.Length > 0 {
            notes.Add(Label(Hidden(memos), 12, ink))
        }
        let time = DateTimeOffset
            .FromUnixTimeSeconds(send.Timestamp)
            .ToLocalTime()
            .ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)
        return Container{
            Height: 56,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 16,
            Padding: Edges{Left: 13, Right: 16},
            BorderWidth: Edges{Left: 3, Bottom: 1},
            BorderColor: rule,
            BorderStartColor: pink,
            Container{
                Width: 200,
                FlexShrink: 0,
                Gap: 4,
                Label("-" + Amount(send.Amount), 14, pink),
                Figure("Fee", Amount(send.Fee), body, 12)
            },
            Grow(notes),
            Container{
                AlignItems: AlignItems.FlexEnd,
                FlexShrink: 0,
                Gap: 4,
                Label(
                    status,
                    12,
                    if confirmed {
                        lime
                    } else {
                        orange
                    }
                ),
                Label(time, 12, body)
            }
        }
    }
}
