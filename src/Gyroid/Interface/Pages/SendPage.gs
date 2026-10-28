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
    private var address string = ""

    private var amount string = ""

    private var memo string = ""

    private var estimate SendEstimate?

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
}
