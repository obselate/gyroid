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
    private var historyTab string = "received"

    private var historySource WalletSnapshot?

    private var outputs[]WalletOutput

    private var sends[]WalletSend

    private let receivedRow Func[WalletOutput, Blob]

    private let sentRow Func[WalletSend, Blob]

    private let historyHandle ElementHandle = ElementHandle()

    private var loadingHistory bool

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
}
