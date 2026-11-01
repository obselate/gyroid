package Gyroid.Views

import Goo
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import System
import System.Collections.Generic
import System.Linq

data struct PendingSendInput {
    var Ui Presentation
    var State string
    var Pending bool
    var Retryable bool
    var Error string
    var TxId string
    var OutcomeError string
    var Busy bool
    var Width float64
    var Language string
    var OnConfirm Action[bool]
}

partial class App {
    private let confirmSend Action[bool]

    private func PendingSendCard() Blob {
        let card = WalletParts.PageContent(ui, ui.Strings.Get("send"), 640)
        card.Add(PendingSendBanner())
        return card
    }

    private func PendingSendBanner() Blob -> Cell.Mount[PendingSendInput, PendingSendRegion](
        "pending-send-" +
            wallet
            .Settings
            .ActiveWallet +
            "/" +
            wallet
            .Settings
            .Network +
            "/" +
            (wallet.Send.Pending?.Key ?? wallet.Send.Outcome.TxId),
        PendingSendInput{
            Ui: ui,
            State: wallet.Send.Pending?.State ?? "",
            Pending: wallet.Send.Pending != nil,
            Retryable: wallet.Send.Pending?.Retryable == true,
            Error: wallet.Send.Error,
            TxId: wallet.Send.Outcome.TxId,
            OutcomeError: wallet.Send.Outcome.Error ?? "",
            Busy: ui.Working(),
            Width: width,
            Language: ui.Strings.Language,
            OnConfirm: confirmSend
        }
    )
}

class PendingSendRegion : Cell[PendingSendInput] {
    private var confirmPendingSend bool
    private var resumePendingSend bool

    protected override func Build(input PendingSendInput) Blob {
        let content = Container{FlexShrink: 0, PendingSendBanner(input)}
        if confirmPendingSend {
            content.Add(ConfirmPendingSend(input))
        }
        return content
    }

    private func PendingSendBanner(input PendingSendInput) Blob {
        let ui = input.Ui
        let content = WalletParts.Card(ui, gap: AppTheme.Space10)
        content.FlexShrink = 0
        content.Add(WalletParts.Header(Label(ui, ui.Strings.Get("Pending send"), AppTheme.Type14, AppTheme.Orange)))
        let message = if input.Error.Length > 0 {
            ui.Strings.Explain(input.Error)
        } else if input.Pending {
            ui.Strings.Get(input.State)
        } else if input.TxId.Length > 0 {
            ui.Strings.Get("Submitted") + ": " + input.TxId
        } else {
            ui.Strings.Get("Send failed") + ": " + input.OutcomeError
        }
        if input.Error.Length > 0 || !input.Pending && input.TxId.Length == 0 {
            content.Add(MessageParts.Problem(ui, message))
        } else {
            content.Add(
                Text{
                    Content: message,
                    FontFamily: AppTheme.Font,
                    FontSize: AppTheme.Type13,
                    Color: AppTheme.Ink,
                    TextWrap: TextWrap.Wrap
                }
            )
        }
        let actions = List[Blob]{
            Button(
                ui,
                "Dismiss",
                () -> {
                    resumePendingSend = false
                    confirmPendingSend = true
                },
                input.Busy
            )
        }
        if input.Error.Length == 0 && input.Retryable {
            actions.Add(
                Button(
                    ui,
                    "Resubmit",
                    () -> {
                        resumePendingSend = true
                        confirmPendingSend = true
                    },
                    input.Busy
                )
            )
        }
        content.Add(ActionRow(actions.ToArray()))
        return content
    }

    private func ConfirmPendingSend(input PendingSendInput) Blob {
        let ui = input.Ui
        let resume = resumePendingSend && input.Error.Length == 0 && input.Retryable
        let close Action = () -> {
            confirmPendingSend = false
            Rebuild()
        }
        return WalletParts.Modal(
            ui,
            "pending-send",
            AppTheme.Dialog with{
                Open = true,
                Preset = ModalDialogPreset.Confirm,
                AccessibilityName = ui.Strings.Get("Pending send"),
                Width = Math.Min(input.Width - 48, 600),
                Content = Text{
                    Content: ui.Strings.Get(
                        if resume {
                            "Resubmitting an unknown send can pay twice if the node forgot its record"
                        } else {
                            "Dismissing does not cancel a payment. Sending again can pay twice"
                        }
                    ),
                    FontFamily: AppTheme.Font,
                    FontSize: AppTheme.Type14,
                    Color: AppTheme.Orange,
                    TextWrap: TextWrap.Wrap
                },
                ConfirmText = ui.Strings.Get(
                    if resume {
                        "Resubmit"
                    } else {
                        "Dismiss"
                    }
                ),
                CancelText = ui.Strings.Get("Cancel"),
                ConfirmDisabled = input.Busy,
                OnConfirm = () -> {
                    confirmPendingSend = false
                    Rebuild()
                    input.OnConfirm(resume)
                },
                OnCancel = close,
                OnClose = close
            }
        )
    }
}
