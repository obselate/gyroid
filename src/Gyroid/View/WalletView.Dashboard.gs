package Gyroid.View

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
    private var address string = ""
    private var amount string = ""
    private var memo string = ""
    private var requestAmount string = ""
    private var requestMemo string = ""
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
    private let historyHandle ElementHandle = ElementHandle()
    private var loadingHistory bool
    private var shownOutput WalletOutput?
    private var shownSend WalletSend?
    private var shownTransaction TransactionDetails?
    private var transactionFailed bool
    private var upgradeShown bool

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
        if wallet.Send.Pending != nil || wallet.Send.Outcome.Text.Length > 0 {
            content.Add(PendingSendBanner())
        }
        content.Add(Balance(snapshot))
        if wallet.Node.Status.UpgradeDate.Length > 0 {
            content.Add(Upgrade(wallet.Node.Status))
        }
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
        let room = width - 680
        let size = Math.Max(24, Math.Min(height * 0.07, room / (0.62 * total.Length)))
        let figure = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: 10,
            MinWidth: 0,
            Label(total, size, totalColor, "balance")
        }
        if balance?.Balance != nil {
            figure.Add(Container{FlexShrink: 0, Label("BNT", 18, body, "")})
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
                Stat("Available", spendable, ink),
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

    private func AmountIssue(value string, available uint64? = nil) string {
        if value.Length == 0 {
            return ""
        }
        try {
            return if WalletAmount.Parse(value) > (available ?? uint64.MaxValue) {
                "Exceeds spendable balance"
            } else {
                ""
            }
        } catch (error WalletException) {
            return error.Message
        }
    }

    private func MemoIssue(value string) string {
        try {
            WalletValidation.MemoBytes(value)
            return ""
        } catch (error WalletException) {
            return error.Message
        }
    }

    private func PendingSendBanner() Blob {
        let pending = wallet.Send.Pending
        let content = Glass()
        content.FlexShrink = 0
        content.Gap = 10
        content.Add(Label(strings.Get("Pending send"), 14, orange))
        let outcome = wallet.Send.Outcome
        let message = if let value = pending {
            strings.Get(value.State)
        } else if outcome.TxId.Length > 0 {
            strings.Get("Submitted") + ": " + outcome.TxId
        } else {
            strings.Get("Send failed") + ": " + (outcome.Error ?? "")
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
        let resume = wallet.Send.Pending?.Retryable == true
        let close Action = () -> {
            confirmPendingSend = false
            Rebuild()
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "pending-send",
            ModalDialog{
                Open: true,
                CreateRoot: DialogRoot,
                Preset: ModalDialogPreset.Confirm,
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
                        Run(wallet.Send.ResumeAsync(), () -> Refresh())
                    } else {
                        Run(wallet.Send.DismissAsync())
                    }
                },
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func SendPanel() Blob {
        if wallet.Send.Error.Length > 0 {
            let card = PageContent(strings.Get("send"), 640)
            card.Add(
                Text{
                    Content: Explain(wallet.Send.Error),
                    FontFamily: font,
                    FontSize: 13,
                    Color: orange,
                    TextWrap: TextWrap.Wrap
                }
            )
            return card
        }
        if wallet.Send.Pending != nil || wallet.Send.Outcome.Text.Length > 0 {
            let card = PageContent(strings.Get("send"), 640)
            card.Add(PendingSendBanner())
            return card
        }
        let blank = address.Trim().Length == 0 || amount.Trim().Length == 0
        let amountIssue = AmountIssue(amount, wallet.Snapshot.Balance?.Spendable)
        let memoIssue = MemoIssue(memo)
        let remaining = WalletValidation.MemoLimit - Encoding.UTF8.GetByteCount(memo)
        let card = PageContent(
            strings.Get("send"),
            640,
            if let units = wallet.Snapshot.Balance?.Spendable {
                Figure("Available", Amount(units) + " BNT", lime, 14)
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
        var chosen string? = nil
        for (label, destination) in contacts {
            if destination == address {
                chosen = label
            }
        }
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexEnd,
                Gap: 8,
                FlexShrink: 0,
                Grow(
                    Container{
                        MinWidth: 0,
                        Field(
                            "Address",
                            address,
                            value -> {
                                address = value.Trim()
                                Rebuild()
                            },
                            () -> Review()
                        )
                    }
                ),
                if contacts.Count > 0 {
                    Cell.Mount[ComboBoxInput, ComboBox](
                        "contact",
                        ComboBoxInput{
                            Items: contacts
                                .Keys
                                .Select((label string) -> ComboBoxOption{Id: label, Label: label})
                                .ToArray(),
                            SelectedId: chosen,
                            Placeholder: strings.Get("contacts"),
                            AccessibilityName: strings.Get("contacts"),
                            Searchable: contacts.Count > 8,
                            Width: 180,
                            CreateRow: (input ComboBoxInput, option ComboBoxOption, row Container) -> {
                                row.Margin = 0
                                row.BorderRadius = 0
                                return row
                            },
                            Disabled: Working(),
                            OnSelect: id -> {
                                address = contacts[id]
                                Rebuild()
                            }
                        }
                    )
                } else {
                    Container{}
                }
            }
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
        if let trace = SendTrace() {
            card.Add(trace)
        }
        return card
    }

    private func Review() {
        if Working() || address.Trim().Length == 0 || amount.Trim().Length == 0 {
            return
        }
        let task = Task.Run(() -> wallet.Send.EstimateAsync(address, amount, memo))
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
        let task = Task.Run(() -> wallet.Send.SubmitAsync(pending))
        Run(
            task,
            () -> {
                address = ""
                amount = ""
                memo = ""
                historyTab = "sent"
                screen = "Transactions"
                if task.Result.Fee > 0 {
                    TraceSend(pending, task.Result)
                } else {
                    CloseTrace()
                }
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
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "confirm-send",
            ModalDialog{
                Open: true,
                CreateRoot: DialogRoot,
                Preset: ModalDialogPreset.Confirm,
                AccessibilityName: strings.Get("Confirm send"),
                Width: Math.Min(width - 48, 600),
                Content: content,
                ConfirmText: strings.Get("Send"),
                CancelText: strings.Get("Cancel"),
                ConfirmDisabled: Working(),
                OnConfirm: () -> Submit(),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func RevealSeed() {
        if Working() || revealPassword.Length == 0 {
            return
        }
        let buffer = revealPassword.ToCharArray()
        revealPassword = ""
        seedFromWallet = true
        Run(wallet.Keys.RevealSeedAsync(buffer), nil, buffer)
    }

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

    private func History(snapshot WalletSnapshot) Blob {
        if !Object.ReferenceEquals(historySource, snapshot) {
            historySource = snapshot
            outputs = snapshot.History
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
        if historyTab == "received" {
            list.Handle = historyHandle
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
                        Tabs(
                            "history-tabs",
                            "Transactions",
                            []NavigationItem{
                                NavigationItem{
                                    Id: "received",
                                    Label: strings.Get("received") + " " + snapshot.HistoryTotal.ToString()
                                },
                                NavigationItem{Id: "sent", Label: strings.Get("sent") + " " + sends.Length.ToString()}
                            },
                            historyTab,
                            id -> {
                                historyTab = id
                                Rebuild()
                            }
                        )
                    }
                ),
                Chain(snapshot)
            }
        )
        if let trace = SendTrace() {
            panel.Add(trace)
        }
        if rows > 0 {
            panel.Add(Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, Overflow: Overflow.Hidden, list})
        }
        return panel
    }

    private func ReceivedRow(output WalletOutput) Blob -> Goo
        .Button{
        Height: 44,
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        JustifyContent: JustifyContent.FlexStart,
        Gap: 16,
        Padding: Edges{Left: 13, Right: 16},
        BorderWidth: Edges{Left: 3, Bottom: 1},
        BorderColor: rule,
        BorderStartColor: if output.Spent {
            edge
        } else {
            mint
        },
        BackgroundColor: Color.Transparent,
        Hover: Style{BackgroundColor: rule},
        Focus: Theme.Read().FocusStyle,
        Accessibility: Accessibility{
            Role: AccessibilityRole.Button,
            Name: strings.Get("received") + " " + Amount(output.Amount) + " " + Count(output.BlockHeight)
        },
        OnClick: () -> ShowTransaction(output, nil),
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
                },
                ""
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

    private func ChainState(state string, confirmations uint64) string -> if state == "confirmed" {
        strings.Get("Confirmed") + " " + Count(confirmations)
    } else if state == "mempool" {
        strings.Get("Pending")
    } else if state == "not_found" {
        strings.Get("Not found")
    } else {
        state
    }

    private func Time(seconds int64) string -> DateTimeOffset
        .FromUnixTimeSeconds(seconds)
        .ToLocalTime()
        .ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)

    private func SentRow(send WalletSend) Blob {
        let confirmed = send.Status == "confirmed"
        let status = ChainState(send.Status, send.Confirmations)
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
        return Goo
            .Button{
            Height: 56,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.FlexStart,
            Gap: 16,
            Padding: Edges{Left: 13, Right: 16},
            BorderWidth: Edges{Left: 3, Bottom: 1},
            BorderColor: rule,
            BorderStartColor: pink,
            BackgroundColor: Color.Transparent,
            Hover: Style{BackgroundColor: rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: strings.Get("sent") + " " + Amount(send.Amount) + " " + status
            },
            OnClick: () -> ShowTransaction(nil, send),
            Container{
                Width: 200,
                FlexShrink: 0,
                Gap: 4,
                Label("-" + Amount(send.Amount), 14, pink, ""),
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
                Label(Time(send.Timestamp), 12, body)
            }
        }
    }

    private func Upgrade(node NodeStatus) Blob {
        let strip = Glass()
        strip.FlexShrink = 0
        strip.FlexDirection = FlexDirection.Row
        strip.AlignItems = AlignItems.Center
        strip.Gap = 24
        strip.Padding = Edges{Top: 6, Left: 20, Right: 8, Bottom: 6}
        strip.BorderWidth = Edges{Left: 3, Top: 1, Right: 1, Bottom: 1}
        strip.BorderStartColor = orange
        strip.Add(Figure("Network upgrade", node.UpgradeDate, ink))
        strip.Add(Grow(Figure("Blocks left", Count(node.UpgradeBlocksLeft), orange)))
        strip.Add(
            IconButton{
                Icon: MaterialIcons.Create("info", 16, body),
                AccessibilityName: strings.Get("Network upgrade"),
                OnClick: () -> {
                    upgradeShown = true
                    Rebuild()
                }
            }.Build()
        )
        return strip
    }

    private func UpgradeDialog() Blob {
        let node = wallet.Node.Status
        let close Action = () -> {
            upgradeShown = false
            Rebuild()
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "upgrade",
            ModalDialog{
                Open: true,
                CreateRoot: DialogRoot,
                AccessibilityName: strings.Get("Network upgrade"),
                Width: Math.Min(width - 48, 600),
                Header: Label(strings.Get("Network upgrade"), 18, ink, ""),
                Content: Container{
                    Gap: 14,
                    Figure("Date", node.UpgradeDate, ink),
                    Figure("Blocks left", Count(node.UpgradeBlocksLeft), orange),
                    Figure("Migration deadline", node.UpgradeDeadline, ink),
                    Text{
                        Content: node.UpgradeNotice,
                        FontFamily: font,
                        FontSize: 13,
                        Color: body,
                        TextWrap: TextWrap.Wrap
                    }
                },
                Footer: ActionRow([]Blob{Button("Close", close)}),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func MoreHistory(metrics ElementMetrics) {
        let remaining = metrics.ScrollRange.Y - metrics.ScrollOffset.Y
        let more = wallet.Snapshot.HistoryMore
        if loadingHistory || !more || remaining > 440 || historyTab != "received" || !metrics.IsMounted {
            return
        }
        LoadHistory()
    }

    private async func LoadHistory() {
        loadingHistory = true
        var message = ""
        try {
            await Task.Run(() -> wallet.History.LoadMoreAsync())
        } catch (failure WalletException) {
            message = failure.Message
        } catch (failure Exception) {
            message = "Refresh failed"
        }
        window?.TryPost(
            () -> {
                loadingHistory = false
                if message.Length > 0 {
                    refreshError = message
                    Rebuild()
                }
                Sync()
            }
        )
    }

    private async func ShowTransaction(output WalletOutput?, send WalletSend?) {
        shownOutput = output
        shownSend = send
        shownTransaction = nil
        transactionFailed = false
        Rebuild()
        let txid = output?.TxId ?? send?.TxId ?? ""
        var details TransactionDetails? = nil
        try {
            details = await Task.Run(() -> wallet.History.TransactionAsync(txid))
        } catch (failure Exception) {
            details = nil
        }
        window?.TryPost(
            () -> {
                if (shownOutput?.TxId ?? shownSend?.TxId) == txid {
                    shownTransaction = details
                    transactionFailed = details == nil
                    Rebuild()
                }
            }
        )
    }

    private func TransactionDialog() Blob {
        let close Action = () -> {
            shownOutput = nil
            shownSend = nil
            Rebuild()
        }
        let chain = shownTransaction
        let waiting = chain == nil && !transactionFailed
        let output = shownOutput
        let send = shownSend
        let txid = output?.TxId ?? send?.TxId ?? ""
        let state = if let value = chain {
            if value.InMempool {
                "mempool"
            } else {
                "confirmed"
            }
        } else {
            send?.Status ?? ""
        }
        let height = chain?.Height ?? output?.BlockHeight ?? uint64(0)
        let time = if let value = send {
            value.Timestamp
        } else {
            chain?.Timestamp
        }
        let content = Container{
            Gap: 14,
            MinHeight: 0,
            FlexShrink: 1,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Theme.Read().Scrollbar
        }
        if let value = output {
            content.Add(Figure("Amount", "+" + Amount(value.Amount) + " BNT", mint, 18))
        }
        if let value = send {
            content.Add(Figure("Amount", "-" + Amount(value.Amount) + " BNT", pink, 18))
            content.Add(Figure("Fee", Amount(value.Fee) + " BNT", ink))
        }
        if state.Length > 0 {
            content.Add(
                Figure(
                    "Status",
                    ChainState(state, chain?.Confirmations ?? send?.Confirmations ?? uint64(0)),
                    if state == "confirmed" {
                        lime
                    } else {
                        orange
                    }
                )
            )
        } else if waiting {
            content.Add(Figure("Status", "…", body))
        }
        if height > 0 {
            content.Add(Figure("Height", Count(height), ink))
        } else if waiting {
            content.Add(Figure("Height", "…", body))
        }
        if let seconds = time {
            content.Add(Figure("Time", Time(seconds), ink))
        } else if waiting {
            content.Add(Figure("Time", "…", body))
        }
        if let value = output {
            if value.Memo.Length > 0 {
                content.Add(Figure("Memo", Hidden(value.Memo), ink))
            }
        }
        content.Add(Copyable("Transaction", txid, Hidden(Grouped(txid))))
        if proofTx == txid && proofKey.Length > 0 {
            content.Add(Copyable("Proof key", proofKey, Hidden(Grouped(proofKey))))
        }
        for recipient in send?.Recipients ?? Array.Empty[WalletRecipient]() {
            let entry = Container{
                Gap: 6,
                Label(strings.Get("Recipient"), 12, body),
                Text{
                    Content: Hidden(Grouped(recipient.Address)),
                    FontFamily: font,
                    FontSize: 13,
                    Color: ink,
                    TextWrap: TextWrap.Wrap
                },
                Figure("Amount", Amount(recipient.Amount) + " BNT", ink)
            }
            if recipient.Memo.Length > 0 {
                entry.Add(Figure("Memo", Hidden(recipient.Memo), ink))
            }
            content.Add(Accent(pink, entry))
        }
        let title = if send != nil {
            "sent"
        } else {
            "received"
        }
        let actions = List[Blob]()
        if let value = send {
            if state == "confirmed" && proofTx != txid {
                actions.Add(Button("Prove", () -> Prove(value), Working()))
            }
        }
        actions.Add(Button("Close", close))
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "transaction",
            ModalDialog{
                Open: true,
                CreateRoot: DialogRoot,
                AccessibilityName: strings.Get(title),
                Width: Math.Min(width - 48, 600),
                Header: Label(strings.Get(title), 18, ink, ""),
                Content: content,
                Footer: ActionRow(actions.ToArray()),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func Prove(send WalletSend) {
        let task = wallet.Proofs.ProveAsync(send.TxId)
        Run(
            task,
            () -> {
                proofTx = send.TxId
                proofKey = task.Result
                proofAddress = send.Recipients.Length > 0 ? send.Recipients[0].Address: ""
                proofAmount = send.Recipients.Length > 0 ? Money(send.Recipients[0].Amount): ""
                ResetVerdict()
            }
        )
    }
}
