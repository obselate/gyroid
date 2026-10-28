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
    private var shownOutput WalletOutput?

    private var shownSend WalletSend?

    private var shownTransaction TransactionDetails?

    private var transactionFailed bool

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
            content.Add(ui.Figure("Amount", "+" + ui.Amount(value.Amount) + " BNT", ui.Mint, 18))
        }
        if let value = send {
            content.Add(ui.Figure("Amount", "-" + ui.Amount(value.Amount) + " BNT", ui.Pink, 18))
            content.Add(ui.Figure("Fee", ui.Amount(value.Fee) + " BNT", ui.Ink))
        }
        if state.Length > 0 {
            content.Add(
                ui.Figure(
                    "Status",
                    ui.ChainState(state, chain?.Confirmations ?? send?.Confirmations ?? uint64(0)),
                    if state == "confirmed" {
                        ui.Lime
                    } else {
                        ui.Orange
                    }
                )
            )
        } else if waiting {
            content.Add(ui.Figure("Status", "…", ui.Body))
        }
        if height > 0 {
            content.Add(ui.Figure("Height", ui.Count(height), ui.Ink))
        } else if waiting {
            content.Add(ui.Figure("Height", "…", ui.Body))
        }
        if let seconds = time {
            content.Add(ui.Figure("Time", ui.Time(seconds), ui.Ink))
        } else if waiting {
            content.Add(ui.Figure("Time", "…", ui.Body))
        }
        if let value = output {
            if value.Memo.Length > 0 {
                content.Add(ui.Figure("Memo", ui.Hidden(value.Memo), ui.Ink))
            }
        }
        content.Add(ui.Copyable("Transaction", txid, ui.Hidden(ui.Grouped(txid))))
        if proofTx == txid && proofKey.Length > 0 {
            content.Add(ui.Copyable("Proof key", proofKey, ui.Hidden(ui.Grouped(proofKey))))
        }
        for recipient in send?.Recipients ?? Array.Empty[WalletRecipient]() {
            let entry = Container{
                Gap: 6,
                ui.Label(ui.Strings.Get("Recipient"), 12, ui.Body),
                Text{
                    Content: ui.Hidden(ui.Grouped(recipient.Address)),
                    FontFamily: ui.Font,
                    FontSize: 13,
                    Color: ui.Ink,
                    TextWrap: TextWrap.Wrap
                },
                ui.Figure("Amount", ui.Amount(recipient.Amount) + " BNT", ui.Ink)
            }
            if recipient.Memo.Length > 0 {
                entry.Add(ui.Figure("Memo", ui.Hidden(recipient.Memo), ui.Ink))
            }
            content.Add(ui.Accent(ui.Pink, entry))
        }
        let title = if send != nil {
            "sent"
        } else {
            "received"
        }
        let actions = List[Blob]()
        if let value = send {
            if state == "confirmed" && proofTx != txid {
                actions.Add(ui.Button("Prove", () -> Prove(value), ui.Working()))
            }
        }
        actions.Add(ui.Button("Close", close))
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "transaction",
            ModalDialog{
                Open: true,
                CreateRoot: ui.DialogRoot,
                AccessibilityName: ui.Strings.Get(title),
                Width: Math.Min(width - 48, 600),
                Header: ui.Label(ui.Strings.Get(title), 18, ui.Ink, ""),
                Content: content,
                Footer: ui.ActionRow(actions.ToArray()),
                OnCancel: close,
                OnClose: close
            }
        )
    }
}
