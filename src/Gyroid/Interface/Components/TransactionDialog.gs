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
}
