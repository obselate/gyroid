package Gyroid.Views

import Goo
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import System
import System.Collections.Generic
import System.Linq

partial class App {
    private var confirmPendingSend bool
    private var resumePendingSend bool

    private func PendingSendCard() Blob {
        let card = WalletParts.PageContent(ui, ui.Strings.Get("send"), 640)
        card.Add(PendingSendBanner())
        return card
    }

    private func PendingSendBanner() Blob {
        let pending = wallet.Send.Pending
        let content = WalletParts.Card(ui, gap: AppTheme.Space10)
        content.FlexShrink = 0
        content.Add(WalletParts.Header(Label(ui, ui.Strings.Get("Pending send"), AppTheme.Type14, AppTheme.Orange)))
        let outcome = wallet.Send.Outcome
        let message = if wallet.Send.Error.Length > 0 {
            ui.Strings.Explain(wallet.Send.Error)
        } else if let value = pending {
            ui.Strings.Get(value.State)
        } else if outcome.TxId.Length > 0 {
            ui.Strings.Get("Submitted") + ": " + outcome.TxId
        } else {
            ui.Strings.Get("Send failed") + ": " + (outcome.Error ?? "")
        }
        if wallet.Send.Error.Length > 0 || pending == nil && outcome.TxId.Length == 0 {
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
                    Rebuild()
                },
                ui.Working()
            )
        }
        if wallet.Send.Error.Length == 0 && pending?.Retryable == true {
            actions.Add(
                Button(
                    ui,
                    "Resubmit",
                    () -> {
                        resumePendingSend = true
                        confirmPendingSend = true
                        Rebuild()
                    },
                    ui.Working()
                )
            )
        }
        content.Add(ActionRow(actions.ToArray()))
        return content
    }

    private func ConfirmPendingSend() Blob {
        let resume = resumePendingSend && wallet.Send.Error.Length == 0 && wallet.Send.Pending?.Retryable == true
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
                Width = Math.Min(width - 48, 600),
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
                ConfirmDisabled = ui.Working(),
                OnConfirm = () -> {
                    confirmPendingSend = false
                    if resume {
                        Run(ct -> wallet.Send.ResumeAsync(ct), () -> Refresh())
                    } else {
                        Run(ct -> wallet.Send.DismissAsync(ct))
                    }
                },
                OnCancel = close,
                OnClose = close
            }
        )
    }
}
