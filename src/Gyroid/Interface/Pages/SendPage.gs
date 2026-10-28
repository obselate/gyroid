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

partial class App {
    private var address string = ""

    private var amount string = ""

    private var memo string = ""

    private var estimate SendEstimate?

    private func SendPanel() Blob {
        if wallet.Send.Error.Length > 0 {
            let card = ui.PageContent(ui.Strings.Get("send"), 640)
            card.Add(
                Text{
                    Content: ui.Strings.Explain(wallet.Send.Error),
                    FontFamily: ui.Font,
                    FontSize: 13,
                    Color: ui.Orange,
                    TextWrap: TextWrap.Wrap
                }
            )
            return card
        }
        if wallet.Send.Pending != nil || wallet.Send.Outcome.Text.Length > 0 {
            let card = ui.PageContent(ui.Strings.Get("send"), 640)
            card.Add(PendingSendBanner())
            return card
        }
        let blank = address.Trim().Length == 0 || amount.Trim().Length == 0
        let amountIssue = ui.AmountIssue(amount, wallet.Snapshot.Balance?.Spendable)
        let memoIssue = ui.MemoIssue(memo)
        let remaining = WalletValidation.MemoLimit - Encoding.UTF8.GetByteCount(memo)
        let card = ui.PageContent(
            ui.Strings.Get("send"),
            640,
            if let units = wallet.Snapshot.Balance?.Spendable {
                ui.Figure("Available", ui.Amount(units) + " BNT", ui.Lime, 14)
            } else {
                nil
            }
        )
        let memoField = Container{
            MinWidth: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            ui.Grow(
                Container{
                    MinWidth: 0,
                    ui.Field(
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
            memoField.Add(ui.Label(remaining.ToString(CultureInfo.InvariantCulture), 12, ui.Body))
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
                ui.Grow(
                    Container{
                        MinWidth: 0,
                        ui.Field(
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
                            Placeholder: ui.Strings.Get("contacts"),
                            AccessibilityName: ui.Strings.Get("contacts"),
                            Searchable: contacts.Count > 8,
                            Width: 180,
                            CreateRow: (input ComboBoxInput, option ComboBoxOption, row Container) -> {
                                row.Margin = 0
                                row.BorderRadius = 0
                                return row
                            },
                            Disabled: ui.Working(),
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
                ui.Grow(
                    Container{
                        MinWidth: 0,
                        ui.Field(
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
                ui.Grow(memoField)
            }
        )
        card.Add(
            ui.ActionRow(
                []Blob{
                    ui.Button(
                        "Review",
                        () -> Review(),
                        ui.Working() || blank || amountIssue.Length > 0 || memoIssue.Length > 0,
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
        if ui.Working() || address.Trim().Length == 0 || amount.Trim().Length == 0 {
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
        if ui.Working() {
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
            Accessibility: Accessibility{
                Name: ui.Strings.Get("Recipient") + " " + pending.Handle + " " + pending.Address
            },
            ui.Label(ui.Strings.Get("Recipient"), 12, ui.Body)
        }
        if pending.Handle.Length > 0 {
            recipient.Add(ui.Label(pending.Handle, 16, ui.Lime, ""))
        }
        recipient.Add(
            Text{
                Content: ui.Grouped(pending.Address),
                FontFamily: ui.Font,
                FontSize: 14,
                Color: ui.Ink,
                TextWrap: TextWrap.Wrap
            }
        )
        let content = Container{
            Gap: 14,
            ui.Accent(ui.Pink, recipient),
            ui.Figure("Amount", ui.Money(pending.Amount) + " BNT", ui.Ink),
            ui.Figure("Fee", ui.Money(pending.Fee) + " BNT", ui.Ink),
            ui.Figure("Total", ui.Money(pending.Total) + " BNT", ui.Lime, 18)
        }
        if pending.Memo.Length > 0 {
            content.Add(ui.Figure("Memo", pending.Memo, ui.Ink))
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "confirm-send",
            ModalDialog{
                Open: true,
                CreateRoot: ui.DialogRoot,
                Preset: ModalDialogPreset.Confirm,
                AccessibilityName: ui.Strings.Get("Confirm send"),
                Width: Math.Min(width - 48, 600),
                Content: content,
                ConfirmText: ui.Strings.Get("Send"),
                CancelText: ui.Strings.Get("Cancel"),
                ConfirmDisabled: ui.Working(),
                OnConfirm: () -> Submit(),
                OnCancel: close,
                OnClose: close
            }
        )
    }
}
