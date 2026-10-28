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
    private var confirmPendingSend bool

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
}
