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
        let content = WalletParts.Card(ui, gap: 10)
        content.FlexShrink = 0
        content.Add(Label(ui, ui.Strings.Get("Pending send"), 14, ui.Orange))
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
        content.Add(Text{Content: message, FontFamily: ui.Font, FontSize: 13, Color: ui.Ink, TextWrap: TextWrap.Wrap})
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
            ModalDialog{
                Open: true,
                Preset: ModalDialogPreset.Confirm,
                AccessibilityName: ui.Strings.Get("Pending send"),
                Width: Math.Min(width - 48, 600),
                Content: Text{
                    Content: ui.Strings.Get(
                        if resume {
                            "Resubmitting an unknown send can pay twice if the node forgot its record"
                        } else {
                            "Dismissing does not cancel a payment. Sending again can pay twice"
                        }
                    ),
                    FontFamily: ui.Font,
                    FontSize: 14,
                    Color: ui.Orange,
                    TextWrap: TextWrap.Wrap
                },
                ConfirmText: ui.Strings.Get(
                    if resume {
                        "Resubmit"
                    } else {
                        "Dismiss"
                    }
                ),
                CancelText: ui.Strings.Get("Cancel"),
                ConfirmDisabled: ui.Working(),
                OnConfirm: () -> {
                    confirmPendingSend = false
                    if resume {
                        Run(ct -> wallet.Send.ResumeAsync(ct), () -> Refresh())
                    } else {
                        Run(ct -> wallet.Send.DismissAsync(ct))
                    }
                },
                OnCancel: close,
                OnClose: close
            }
        )
    }
}
