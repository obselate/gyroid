package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.History
import Gyroid.Interface.ControlParts
import Gyroid.Interface.LayoutParts
import Gyroid.Interface.TextParts
import Gyroid.Tools
import Gyroid.Wallet
import Gyroid.Wallet.WalletText
import System
import System.Linq
import System.Threading.Tasks

data struct ObserverLensInput {
    var Session WalletSession
    var Ui Presentation
    var Send WalletSend
    var Recipient string
    var Privacy bool
    var Language string
    var Width float64
    var OnProve Action
    var OnClose Action
}

class ObserverLens : Cell[ObserverLensInput] {
    private var view ObserverView?
    private var loading string = ""
    private let hidden Color = Color.Parse("#1fae84")
    private let decoy Color = Color.Parse("#3a3a3a")
    private let member Color = Color.Parse("#00bf80")
    private let line Color = Color.Parse("#141414")

    protected override func Build(input ObserverLensInput) Blob {
        let ui = input.Ui
        let send = input.Send
        if loading != send.TxId {
            loading = send.TxId
            view = nil
            var task Task[ObserverView]
            ui.Actions.Run(
                ct -> {
                    task = input.Session.Checks.ObserveAsync(send.TxId, ct)
                    return task
                },
                () -> {
                    if loading == send.TxId {
                        view = task.Result
                        Rebuild()
                    }
                }
            )
        }
        let compact = input.Width < 1100
        let side = compact ? 72.0: 96.0
        let size = view?.RingSize ?? 16
        let content = Container{
            Gap: 0,
            MinHeight: 0,
            FlexShrink: 1,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Theme.Read().Scrollbar
        }
        content.Add(
            Columns(
                input,
                side,
                Container{},
                Heading(ui, "person", "you", ui.Lime),
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Heading(ui, "public", "chain", ui.Mint),
                    Container{FlexGrow: 1},
                    Public(ui, ui.Strings.Get("public"), 12)
                }
            )
        )
        let yours = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 14}
        let chain = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 14}
        let rings = view?.Rings ?? []int32{}
        for index in 0 ... Math.Min(rings.Length, 2) {
            yours.Add(Ring(size, rings[index], false, compact))
            chain.Add(Ring(size, -1, true, compact))
        }
        if rings.Length > 2 {
            yours.Add(Label(ui, "+" + (rings.Length - 2).ToString(), 13, ui.Dim, ""))
            chain.Add(Label(ui, "+" + (rings.Length - 2).ToString(), 13, ui.Dim, ""))
        }
        yours.Add(Label(ui, ui.Strings.Get("yours"), 13, ui.Lime, ""))
        chain.Add(Label(ui, String.Format(ui.Strings.Get("1 of {0}"), size), 13, ui.Mint, ""))
        let ringRow = Columns(input, side, Label(ui, ui.Strings.Get("inputs"), 12.5, ui.Dim, ""), yours, chain)
        ringRow.Padding = Edges{Top: 6, Bottom: 10}
        ringRow.BorderWidth = Edges{Bottom: 1}
        ringRow.BorderColor = ui.Rule
        content.Add(ringRow)
        let fee = Amount(ui.Privacy, send.Fee) + " BNT"
        let height = if let value = view {
            value.Height
        } else {
            0
        }
        content.Add(
            Item(
                input,
                side,
                "amount",
                Label(ui, "−" + Amount(ui.Privacy, send.Amount) + " BNT", 14, ui.Ink, ""),
                Hidden(ui, "lock", Short(view?.Commitment ?? ""))
            )
        )
        content.Add(
            Item(
                input,
                side,
                "to",
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: 8,
                    MinWidth: 0,
                    Label(ui, WalletText.Hidden(ui.Privacy, input.Recipient), 14, ui.Ink, ""),
                    Label(ui, ui.Strings.Get("+ change"), 14, ui.Dim, "")
                },
                Hidden(
                    ui,
                    "key",
                    String.Join(" · ", (view?.OutputKeys ?? []string{}).Select((key string) -> Short(key)))
                )
            )
        )
        let memo = send
            .Recipients
            .Select((recipient WalletRecipient) -> recipient.Memo)
            .FirstOrDefault((text string) -> text.Length > 0) ??
            ""
        content.Add(
            Item(
                input,
                side,
                "memo",
                Label(ui, memo.Length > 0 ? WalletText.Hidden(ui.Privacy, memo): "—", 14, ui.Ink, ""),
                Hidden(
                    ui,
                    "lock",
                    if let value = view {
                        value.MemoBytes.ToString() + " B"
                    } else {
                        ""
                    }
                )
            )
        )
        content.Add(Item(input, side, "fee", Label(ui, fee, 14, ui.Ink, ""), Public(ui, fee, 14)))
        content.Add(
            Item(
                input,
                side,
                "block",
                Label(ui, height > 0 ? Count(height): "—", 14, ui.Ink, ""),
                height > 0 ? Public(ui, Count(height), 14): Container{}
            )
        )
        let confirmed = send.Status == "confirmed"
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "lens",
            ModalDialog{
                Open: true,
                CreateRoot: (dialog, backdrop, panel) -> DialogRoot(ui),
                AccessibilityName: ui.Strings.Get("sent"),
                Width: Math.Min(input.Width - 40, 780),
                Header: Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 12,
                    Label(ui, ui.Strings.Get("sent"), 17, ui.Ink, ""),
                    Status(
                        ui,
                        ChainState(ui, send.Status, send.Confirmations),
                        confirmed ? ui.Mint: ui.Orange,
                        confirmed ? "check": "schedule"
                    ),
                    Container{FlexGrow: 1},
                    Cell.Mount[InfoTipInput, InfoTip](
                        "lens-info",
                        InfoTipInput{
                            Ui: ui,
                            Topic: "inputs",
                            Lines: []string{
                                String.Format(
                                    ui.Strings.Get(
                                        "{0} members: your real input and {1} decoys from the chain. Nobody can tell which one is real"
                                    ),
                                    size,
                                    size - 1
                                )
                            },
                            Language: input.Language,
                            Width: 300
                        }
                    )
                },
                Content: content,
                Footer: ActionRow(
                    []Blob{
                        Button(ui, "Prove", input.OnProve, ui.Working() || !confirmed),
                        Button(ui, "Close", input.OnClose)
                    }
                ),
                OnCancel: input.OnClose,
                OnClose: input.OnClose
            }
        )
    }

    private func Short(value string) string -> if value.Length > 8 {
        value.Substring(0, 4) + "…" + value.Substring(value.Length - 4)
    } else {
        value
    }

    private func Heading(ui Presentation, icon string, label string, color Color) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 8,
        MaterialIcons.Create(icon, 16, color),
        Label(ui, ui.Strings.Get(label), 13, color, "")
    }

    private func Hidden(ui Presentation, icon string, value string) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 6,
        MinWidth: 0,
        MaterialIcons.Create(icon, 14, hidden),
        Label(ui, value, 14, hidden, "")
    }

    private func Public(ui Presentation, value string, size float64) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 6,
        MinWidth: 0,
        Container{Width: 6, Height: 6, BorderRadius: 3, BackgroundColor: ui.Orange},
        Label(ui, value, size, ui.Orange, "")
    }

    private func Columns(input ObserverLensInput, side float64, label Blob, you Blob, chain Blob) Container {
        let ui = input.Ui
        let padding = input.Width < 1100 ? 10.0: 14.0
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Stretch,
            FlexShrink: 0,
            Container{Width: side, FlexShrink: 0, JustifyContent: JustifyContent.Center, label},
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                JustifyContent: JustifyContent.Center,
                Padding: Edges{Left: padding, Right: padding},
                you
            },
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                JustifyContent: JustifyContent.Center,
                Padding: Edges{Left: padding, Right: padding},
                BorderWidth: Edges{Left: 1},
                BorderColor: ui.Rule,
                chain
            }
        }
    }

    private func Item(input ObserverLensInput, side float64, label string, you Blob, chain Blob) Blob {
        let row = Columns(input, side, Label(input.Ui, input.Ui.Strings.Get(label), 12.5, input.Ui.Dim, ""), you, chain)
        row.MinHeight = input.Width < 1100 ? 36.0: 42.0
        row.BorderWidth = Edges{Bottom: 1}
        row.BorderColor = line
        return row
    }

    private func Ring(size int32, real int32, chain bool, compact bool) Blob {
        let box = compact ? 58.0: 72.0
        let radius = box * 28 / 72
        let ring = Container{Width: box, Height: box, FlexShrink: 0}
        for index in 0 ... size {
            let angle = index / float64(size) * Math.PI * 2 - Math.PI / 2
            let dot = !chain && index == real ? 4.5: 3.2
            ring.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: box / 2 + radius * Math.Cos(angle) - dot,
                    Top: box / 2 + radius * Math.Sin(angle) - dot,
                    Width: dot * 2,
                    Height: dot * 2,
                    BorderRadius: dot,
                    BackgroundColor: if chain {
                        member
                    } else if index == real {
                        Color.Parse("#aaff00")
                    } else {
                        decoy
                    }
                }
            )
        }
        return ring
    }
}
