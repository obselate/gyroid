package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Data
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.LayoutParts
import Gyroid.Components.NetworkParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import Gyroid.Views.OverviewParts
import System
import System.Collections.Generic
import System.Globalization
import System.Linq
import System.Threading

data struct OverviewInput {
    var Ui Presentation
    var Session WalletSession
    var Window Window?
    var Snapshot WalletSnapshot
    var Node NodeStatus
    var Contacts SortedDictionary[string, string]
    var Privacy bool
    var Height float64
    var Width float64
    var OnNavigate Action[AppPage]
    var OnUpgrade Action
    var OnHistory Action[string]
}

data struct OverviewBalanceInput {
    var Ui Presentation
    var Total uint64?
    var Spendable uint64?
    var Pending uint64?
    var Unconfirmed uint64
    var Scanning bool
    var ScanHeight uint64
    var ChainHeight uint64
    var Privacy bool
    var Height float64
    var Width float64
    var Language string
    var ConfirmingOutputs int32
    var ConfirmingBlocks uint64
    var Hovering bool
    var OnHover Action[bool]
}

data struct OverviewNetworkInput {
    var Ui Presentation
    var Session NodeSession
    var Api NodeApi
    var Window Window?
    var Running bool
    var Syncing bool
    var Height uint64
    var ChainHeight uint64
    var Peers uint64
    var Mempool uint64
    var MempoolBytes uint64
    var LastBlockTime int64
    var BestHash string
    var Width float64
    var Language string
    var Wallet string
    var Network string
    var Endpoint string
    var ProcessId int32
    var OnNavigate Action[AppPage]
}

data struct OverviewRecentInput {
    var Ui Presentation
    var Rows[]OverviewRow
    var HasTransactions bool
    var IncomingOutputs int32
    var IncomingBlocks uint64
    var Issue string
    var Privacy bool
    var Width float64
    var Language string
    var Network string
    var Wallet string
    var OnHistory Action[string]
    var OnNavigate Action[AppPage]
    var Hovering bool
}

data struct OverviewRow {
    var Key string
    var Arrival HistoryArrival
    var Activity HistoryActivity
    var IsArrival bool
    var Privacy bool
    var Wide bool
    var Language string
    var Hovering bool
    var Expanded bool
}

data struct OverviewUpgradeInput {
    var Ui Presentation
    var Date string
    var Deadline string
    var Syncing bool
    var Height uint64
    var BlocksLeft uint64
    var Language string
    var OnUpgrade Action
}

class OverviewPage : Cell, IDisposable {
    private var current OverviewInput
    private var arrivalSource IReadOnlyList[WalletOutput]? = nil
    private var changeSource IReadOnlyList[WalletOutput]? = nil
    private var tip uint64
    private var language string = ""
    private var identity HistoryIdentity
    private var readSource HistoryReadSource
    private var confirmingOutputs int32
    private var rows[]OverviewRow = []OverviewRow{}
    private var incomingOutputs int32
    private var incomingBlocks uint64
    private var confirmingBlocks uint64
    private var issue string = ""
    private var generation int32
    private var request CancellationTokenSource? = nil
    private var disposed bool
    private var networkInput OverviewNetworkInput
    private var recentInput OverviewRecentInput
    private let configureNetwork Action[OverviewNetwork]
    private let configureRecent Action[OverviewRecent]
    private var hovering bool
    private let hover Action[bool]
    public func Accept(input OverviewInput) {
        let nextArrivals = input.Session.History.Outputs
        let nextChanges = input.Session.History.ChangeOutputs
        let chain = input.Snapshot.Balance?.ChainHeight ?? input.Node.Height
        let nextIdentity = HistoryPage.SourceIdentity(input.Session)
        let nextSource = HistoryPage.ReadSource(input.Session)
        let nextLanguage = input.Ui.Strings.Language
        let prepare = current.Session != input.Session ||
            current.Snapshot != input.Snapshot ||
            current.Contacts != input.Contacts ||
            language != nextLanguage ||
            !identity.Equals(nextIdentity) || !readSource.Equals(nextSource) ||
            arrivalSource != nextArrivals ||
            changeSource != nextChanges ||
            tip != chain
        if disposed || (!prepare && current.Equals(input)) {
            return
        }
        current = input
        arrivalSource = nextArrivals
        changeSource = nextChanges
        tip = chain
        language = nextLanguage
        identity = nextIdentity
        readSource = nextSource
        Rebuild()
        if !prepare {
            return
        }
        generation++
        request?.Cancel()
        request?.Dispose()
        request = nil
        guard let window = input.Window else {
            return
        }
        let pending = CancellationTokenSource.CreateLinkedTokenSource(window.Closed)
        request = pending
        let token = pending.Token
        let id = generation
        let outputs = input.Snapshot.History
        let previousRows = rows
        go Prepare(input, nextArrivals, nextChanges, outputs, chain, previousRows, window, id, token)
    }

    init() {
        configureNetwork = cell -> cell.Accept(networkInput)
        configureRecent = cell -> cell.Accept(recentInput)
        hover = value -> if hovering != value {
            hovering = value
            Rebuild()
        }
    }

    override func Build() Blob {
        let input = current
        let language = input.Ui.Strings.Language
        networkInput = OverviewNetworkInput{
            Ui: input.Ui,
            Session: input.Session.Node,
            Api: input.Session.Node.Api,
            Window: input.Window,
            Running: input.Node.Running,
            Syncing: input.Node.Syncing,
            Height: input.Node.Height,
            ChainHeight: input.Node.Syncing ? input.Node.ChainHeight: 0,
            Peers: input.Node.Peers,
            Mempool: input.Node.Mempool,
            MempoolBytes: input.Node.MempoolBytes,
            LastBlockTime: input.Node.LastBlockTime,
            BestHash: input.Node.BestHash,
            Width: input.Width,
            Language: language,
            Wallet: input.Session.Node.Settings.ActiveWallet,
            Network: input.Session.Node.Settings.Network,
            Endpoint: input.Session.Node.Settings.Endpoint,
            ProcessId: input.Session.Node.Settings.OwnedProcessId,
            OnNavigate: input.OnNavigate
        }
        recentInput = OverviewRecentInput{
            Ui: input.Ui,
            Rows: rows,
            HasTransactions: input
                .Snapshot
                .History
                .Length > 0 ||
                input
                .Snapshot
                .Sends
                .Length > 0 ||
                (arrivalSource?.Count ?? 0) > 0 ||
                (changeSource?.Count ?? 0) > 0 ||
                (input.Snapshot.Balance?.Unconfirmed ?? uint64(0)) > 0,
            IncomingOutputs: incomingOutputs,
            IncomingBlocks: incomingBlocks,
            Issue: issue,
            Privacy: input.Privacy,
            Width: input.Width,
            Language: language,
            Network: input.Session.Node.Settings.Network,
            Wallet: input.Session.Node.Settings.ActiveWallet,
            OnHistory: input.OnHistory,
            Hovering: hovering,
            OnNavigate: input.OnNavigate
        }
        let page = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, Gap: AppTheme.Space12}
        if input.Node.UpgradeDate.Length > 0 {
            page.Add(
                Cell.Mount[OverviewUpgradeInput, OverviewUpgrade](
                    "upgrade",
                    OverviewUpgradeInput{
                        Ui: input.Ui,
                        Date: input.Node.UpgradeDate,
                        Deadline: input.Node.UpgradeDeadline,
                        Syncing: input.Node.Syncing,
                        Height: input.Node.Syncing ? 0: input.Node.Height,
                        BlocksLeft: input.Node.Syncing ? 0: input.Node.UpgradeBlocksLeft,
                        Language: language,
                        OnUpgrade: input.OnUpgrade
                    }
                )
            )
        }
        page.Add(
            Container{
                Height: Math.Clamp(Math.Min(input.Height * 0.32, input.Width * 0.09 + 151), 260, 352),
                FlexShrink: 0,
                FlexDirection: FlexDirection.Row,
                Gap: AppTheme.Space16,
                Cell.Mount[OverviewBalanceInput, OverviewBalance](
                    "balance",
                    OverviewBalanceInput{
                        Ui: input.Ui,
                        Total: input.Snapshot.Balance?.Balance,
                        Spendable: input.Snapshot.Balance?.Spendable,
                        Pending: input.Snapshot.Balance?.Pending,
                        Unconfirmed: input.Snapshot.Balance?.Unconfirmed ?? uint64(0),
                        Scanning: input.Snapshot.Balance?.Scanning == true,
                        ScanHeight: input.Snapshot.Balance?.ScanHeight ?? uint64(0),
                        ChainHeight: input.Snapshot.Balance?.ChainHeight ?? uint64(0),
                        Privacy: input.Privacy,
                        Height: input.Height,
                        Width: input.Width,
                        Language: language,
                        Hovering: hovering,
                        OnHover: hover,
                        ConfirmingOutputs: confirmingOutputs,
                        ConfirmingBlocks: confirmingBlocks
                    }
                ),
                Cell.Mount[OverviewNetwork]("network", configureNetwork)
            }
        )
        page.Add(Cell.Mount[OverviewRecent]("recent", configureRecent))
        return page
    }

    private async func Prepare(
        input OverviewInput,
        arrivalOutputs IReadOnlyList[WalletOutput],
        changes IReadOnlyList[WalletOutput],
        outputs[]WalletOutput,
        chain uint64,
        previousRows[]OverviewRow,
        window Window,
        id int32,
        token CancellationToken
    ) {
        try {
            let history = input.Session.History
            let heights = outputs
                .Take(50)
                .Select(output -> output.BlockHeight)
                .Where(height -> height > 0)
                .Distinct()
                .ToArray()
            let sends = input.Snapshot.Sends.DistinctBy(send -> send.TxId).ToDictionary(send -> send.TxId)
            var times = previousRows
                .Where(row -> !row.IsArrival && row.Activity.OutputIndex >= 0 && row.Activity.Timestamp > 0)
                .GroupBy(row -> row.Activity.Height)
                .ToDictionary(group -> group.Key, group -> group.First().Activity.Timestamp)
            var failure = ""
            var previous = previousRows
            for phase in 0 ... 2 {
                token.ThrowIfCancellationRequested()
                if phase == 1 {
                    try {
                        times = await history.BlockTimesAsync(heights, token)
                    } catch (error Exception) when !(error is OperationCanceledException) {
                        failure = input.Ui.Strings.Explain(error.Message)
                    }
                }
                let result = history.PrepareOverview(
                    input.Snapshot,
                    arrivalOutputs,
                    changes,
                    outputs,
                    chain,
                    times,
                    token
                )
                let preparedRows = List[OverviewRow]()
                var count = 0
                var blocks = uint64(0)
                var incomingCount = 0
                var incomingWait = uint64(0)
                for item in result.Arrivals {
                    let send = item.Kind == "pool" ? input
                        .Snapshot
                        .Sends
                        .FirstOrDefault(value -> value.Status == "mempool"):
                    sends.GetValueOrDefault(item.TxId)
                    let name = Contact(input.Ui, input.Contacts, input.Session.Messages, send)
                    let content = MessageParts.Content(input.Ui, item.Source, item.InvitationName)
                    let label = if item.Kind == "change" || item.Kind == "pool" {
                        input.Ui.Strings.Get("change") + (name.Length > 0 ? " · " + name: "")
                    } else if item.Kind == "mined" {
                        input.Ui.Strings.Get("mined") + " · " + input.Ui.Strings.Get("block") + " " + Count(item.Height)
                    } else {
                        content.Length > 0 ? content: OverviewParts.Short(item.TxId)
                    }
                    if item.Kind != "pool" {
                        count++
                        blocks = Math.Max(blocks, item.Blocks)
                    }
                    if !item.Self {
                        incomingCount++
                        incomingWait = Math.Max(incomingWait, item.Blocks)
                        preparedRows.Add(
                            OverviewRow{
                                Key: item.Kind == "pool" ? "overview-pending": "overview-output-" +
                                    item.TxId +
                                    ":" +
                                    item
                                    .OutputIndex
                                    .ToString(),
                                Arrival: item with{Source = label},
                                IsArrival: true
                            }
                        )
                    }
                }
                for item in result.Activity.DistinctBy(value -> (value.TxId, value.OutputIndex)) {
                    let name = item.OutputIndex < 0 ? Contact(
                        input.Ui,
                        input.Contacts,
                        input.Session.Messages,
                        sends.GetValueOrDefault(item.TxId)
                    ): MessageParts.Content(input.Ui, item.Label, item.InvitationName)
                    let label = if item.Kind == "self" {
                        input.Ui.Strings.Get("To self") + (name.Length > 0 ? " · " + name: "")
                    } else if name.Length > 0 {
                        name
                    } else if item.Kind == "mined" {
                        input.Ui.Strings.Get("block") + " " + Count(item.Height)
                    } else {
                        OverviewParts.Short(item.TxId)
                    }
                    let status = item.Status == "not_found" ? input.Ui.Strings.Get("not found"):
                    item.Status == "mempool" ? "mempool": item.Confirmations.ToString() + "/" + item.Required.ToString()
                    preparedRows.Add(
                        OverviewRow{
                            Key: item.OutputIndex < 0 ? "overview-send-" +
                                item.TxId: "overview-output-" +
                                item.TxId +
                                ":" +
                                item
                                .OutputIndex
                                .ToString(),
                            Activity: item with{
                                Label = label,
                                Status = status,
                                Order = 0,
                                Confirmations = 0,
                                Required = 0,
                                Height = item.OutputIndex < 0 ? uint64(0): item.Height
                            }
                        }
                    )
                }
                let nextRows = preparedRows.SequenceEqual(previous) ? previous: preparedRows.ToArray()
                let issueText = failure
                previous = nextRows
                window.TryPost(
                    () -> {
                        if id != generation ||
                            (
                            Object.ReferenceEquals(rows, nextRows) &&
                                confirmingOutputs == count &&
                                confirmingBlocks == blocks &&
                                issue == issueText
                        ) {
                            return
                        }
                        rows = nextRows
                        incomingOutputs = incomingCount
                        incomingBlocks = incomingWait
                        confirmingOutputs = count
                        confirmingBlocks = blocks
                        issue = issueText
                        Rebuild()
                    }
                )
            }
        } catch (error OperationCanceledException) { } catch (error Exception) {
            let message = input.Ui.Strings.Explain(error.Message)
            window.TryPost(
                () -> if id == generation {
                    issue = message
                    Rebuild()
                }
            )
        }
    }

    public func Dispose() {
        disposed = true
        generation++
        request?.Cancel()
        request?.Dispose()
    }
}

class OverviewParts {
    shared {
        func Fixed(units uint64) string ->
        (units / 100000000).ToString(CultureInfo.InvariantCulture) + "." + (units % 100000000 / 10000).ToString(
            "D4",
            CultureInfo.InvariantCulture
        )

        func Wait(ui Presentation, blocks uint64) string {
            let minutes = blocks * 5
            return if minutes < 60 {
                String.Format(ui.Strings.Get("~{0}m"), minutes)
            } else if minutes % 60 == 0 {
                String.Format(ui.Strings.Get("~{0}h"), minutes / 60)
            } else {
                String.Format(ui.Strings.Get("~{0}h{1}m"), minutes / 60, minutes % 60)
            }
        }

        func Short(txid string) string -> if txid.Length > 8 {
            "tx " + txid.Substring(0, 4) + "…" + txid.Substring(txid.Length - 4)
        } else {
            "tx " + txid
        }

        func Contact(
            ui Presentation,
            contacts SortedDictionary[string, string],
            messages MessagingService,
            send WalletSend?
        ) string {
            guard let value = send else {
                return ""
            }
            let memo = value
                .Recipients
                .Select(
                (recipient WalletRecipient) -> MessageParts.Content(ui, recipient.Memo, recipient.InvitationName)
            )
                .FirstOrDefault((text string) -> text.Length > 0) ??
                ""
            if messages.Lookup(value.TxId) != nil {
                return memo
            }
            for (name, destination) in contacts {
                if value.Recipients.Any((recipient WalletRecipient) -> recipient.Address == destination) {
                    return name
                }
            }
            return memo
        }

        func Link(ui Presentation, label string, action Action) Blob {
            let button = Goo
                .Button{
                FlexShrink: 0,
                BorderRadius: AppTheme.Radius3,
                BackgroundColor: Color.Transparent,
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{Role: AccessibilityRole.Link, Name: ui.Strings.Get(label)},
                OnClick: action,
                Label(ui, ui.Strings.Get(label) + " ›", AppTheme.Type12, AppTheme.Lime, "")
            }
            WidgetKeyBindings.BindActivation(button)
            return button
        }
    }
}

class OverviewUpgrade : Cell[OverviewUpgradeInput] {
    private let strip ElementHandle = ElementHandle()
    private var stripWidth float64

    init() {
        strip.MetricsChanged += _ -> {
            let width = strip.BorderBox.Width
            if width != stripWidth {
                stripWidth = width
                Rebuild()
            }
        }
    }

    protected override func Build(input OverviewUpgradeInput) Blob {
        let ui = input.Ui
        let bar = WalletParts.Card(
            ui,
            Edges{Top: AppTheme.Space0, Bottom: AppTheme.Space0, Left: AppTheme.Space16, Right: AppTheme.Space10},
            AppTheme.Space14
        )
        bar.FlexShrink = 0
        bar.FlexDirection = FlexDirection.Row
        bar.AlignItems = AlignItems.Center
        bar.Height = 40
        bar.Add(Label(ui, ui.Strings.Get("Network upgrade") + " " + input.Date, AppTheme.Type12, AppTheme.Body, ""))
        bar.Add(
            Container{
                Handle: strip,
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                if stripWidth > 0 {
                    UpgradeTimeline(ui, input.Date, input.Deadline, input.Syncing, input.Height, stripWidth)
                } else {
                    Container{}
                }
            }
        )
        if !input.Syncing {
            bar.Add(
                Label(ui, Count(input.BlocksLeft) + " " + ui.Strings.Get("blocks"), AppTheme.Type14, AppTheme.Ink, "")
            )
        }
        bar.Add(
            (
                AppTheme.IconButton with{
                    Icon = MaterialIcons.Create("info", AppTheme.Icon16, AppTheme.Body),
                    AccessibilityName = ui.Strings.Get("Upgrade notice"),
                    OnClick = input.OnUpgrade
                }
            ).Build()
        )
        return bar
    }
}

class OverviewBalance : Cell[OverviewBalanceInput] {
    private let hero ElementHandle = ElementHandle()
    private var heroWidth float64
    private var peeking bool

    init() {
        hero.MetricsChanged += _ -> {
            let width = hero.BorderBox.Width
            if width != heroWidth {
                heroWidth = width
                Rebuild()
            }
        }
    }

    protected override func Build(input OverviewBalanceInput) Blob {
        let outputs = input.ConfirmingOutputs
        let last = input.ConfirmingBlocks
        let ui = input.Ui
        let masked = input.Privacy && !peeking
        let total = input.Total ?? uint64(0)
        let ready = input.Spendable ?? uint64(0)
        let unconfirmed = input.Unconfirmed
        let confirming = (input.Pending ?? uint64(0)) - unconfirmed
        let known = input.Total != nil
        let scanning = input.Scanning
        let value = if masked {
            "••••••••"
        } else if known {
            Fixed(total)
        } else {
            "-"
        }
        let color = if masked || !known || total == 0 {
            AppTheme.Dim
        } else {
            AppTheme.Lime
        }
        let inner = Math.Max(0.0, heroWidth - 40)
        let size = AppTheme.GetBalanceSize(masked || !known, input.Height, inner, value.Length)
        let card = WalletParts.Card(
            ui,
            Edges{Top: AppTheme.Space16, Bottom: AppTheme.Space16, Left: AppTheme.Space20, Right: AppTheme.Space20},
            AppTheme.Space14
        )
        card.Width = input.Width < 1200 ? 400.0: Percent(39)
        card.FlexShrink = 0
        card.Handle = hero
        card.FlexGrow = 0
        if peeking {
            card.BorderColor = AppTheme.StrongRule
        }
        let header = WalletParts.Header(
            Grow(Label(ui, ui.Strings.Get("balance"), AppTheme.Type12, AppTheme.Body, "")),
            AppTheme.Space10
        )
        if input.Privacy {
            let press = (event PointerEvent) -> if !event.IsFromInteractiveChild {
                event.Capture()
                peeking = true
            }
            header.Height = AppTheme.ControlCompact
            header.Add(
                Label(
                    ui,
                    ui.Strings.Get(peeking ? "release to hide": "hold to show"),
                    AppTheme.Type12,
                    AppTheme.Dim,
                    ""
                )
            )
            header.Add(
                Container{
                    BasedOn: AppTheme.IconButtonStyle,
                    Width: AppTheme.ControlCompact,
                    Height: AppTheme.ControlCompact,
                    BorderRadius: AppTheme.Radius6,
                    BorderColor: peeking ? AppTheme.Lime: AppTheme.Edge,
                    BackgroundColor: peeking ? AppTheme.LimeQuiet: Color.Transparent,
                    Focusable: true,
                    Focus: Theme.Read().FocusStyle,
                    Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get("Show amounts")},
                    OnKeyDown: (event KeyEvent) -> if !peeking && (event.Key == Key.Space || event.Key == Key.Enter) {
                        peeking = true
                    },
                    OnKeyUp: (event KeyEvent) -> Hide(),
                    OnBlur: peeking ? ((event FocusEvent) -> Hide()): nil,
                    OnPointerDown: press,
                    OnPointerUp: (event PointerEvent) -> Hide(),
                    OnPointerCancel: (event PointerEvent) -> Hide(),
                    MaterialIcons.Create("visibility_off", AppTheme.Icon16, peeking ? AppTheme.Lime: AppTheme.Body)
                }
            )
            card.OnPointerDown = press
            card.OnPointerUp = (event PointerEvent) -> Hide()
            card.OnPointerCancel = (event PointerEvent) -> Hide()
        }
        card.Add(header)
        let figure = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: AppTheme.Space12,
            TextParts.Value(
                ui,
                "balance",
                if masked {
                    ui.Strings.Get("Amounts hidden")
                } else if known {
                    ui.Strings.Get("balance") + " " + WalletAmount.Format(total) + " BNT"
                } else {
                    value
                },
                value,
                size,
                color,
                color == AppTheme.Lime ? AppTheme.LimeMuted: AppTheme.StrongRule,
                AccessibilityLive.Polite
            )
        }
        if known && !masked {
            figure.Add(Label(ui, "BNT", AppTheme.Type16, AppTheme.Body, ""))
        }
        card.Add(
            Container{
                FlexGrow: 1,
                MinHeight: 0,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                figure
            }
        )
        if scanning {
            card.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space6,
                    Text{
                        Content: String.Format(
                            ui.Strings.Get("Syncing {0} / {1} · balance may be inaccurate"),
                            Count(input.ScanHeight),
                            Count(input.ChainHeight)
                        ),
                        FontFamily: AppTheme.Font,
                        FontSize: AppTheme.Type12,
                        Color: AppTheme.Orange,
                        TextWrap: TextWrap.Wrap,
                        FlexGrow: 1,
                        MinWidth: 0
                    },
                    Cell.Mount[InfoTipInput, InfoTip](
                        "scan-info",
                        InfoTipInput{
                            Ui: ui,
                            Topic: "About sync",
                            Lines: []string{
                                "The wallet is catching up with the chain. The amount shown is the last known balance and updates when syncing ends."
                            },
                            Language: ui.Strings.Language,
                            Width: 300
                        }
                    )
                }
            )
        }
        let height = Math.Clamp(input.Height * 0.018, 12, 20)
        let bar = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space4,
            Height: height,
            FlexShrink: 0,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: if masked {
                    ui.Strings.Get("Amounts hidden")
                } else {
                    ui.Strings.Get("ready") + " " + WalletAmount.Format(ready) + ", " + ui.Strings.Get("confirming") +
                        " " +
                        WalletAmount.Format(confirming) + ", " + ui.Strings.Get("in mempool") +
                        " " +
                        WalletAmount.Format(unconfirmed)
                }
            }
        }
        if masked || total == 0 {
            bar.Add(
                Container{FlexGrow: 1, Height: height, BorderRadius: AppTheme.Radius2, BackgroundColor: AppTheme.Rule}
            )
        } else {
            if ready > 0 {
                bar.Add(BarSegment(float64(ready) / 100000000, AppTheme.Lime, height, 14))
            }
            if confirming > 0 {
                let segment = BarSegment(
                    float64(confirming) / 100000000,
                    AppTheme.Orange,
                    input.Hovering ? height + 6: height,
                    14
                )
                segment.OnPointerEnter = (event PointerEvent) -> input.OnHover(true)
                segment.OnPointerLeave = (event PointerEvent) -> input.OnHover(false)
                if input.Hovering {
                    segment.BoxShadows = []BoxShadow{
                        BoxShadow{Spread: 1, Color: AppTheme.Black},
                        BoxShadow{Spread: 2, Color: AppTheme.Orange}
                    }
                }
                bar.Add(segment)
            }
            if unconfirmed > 0 {
                bar.Add(BarSegment(float64(unconfirmed) / 100000000, AppTheme.Blue, height, 14))
            }
        }
        let wrap = Container{FlexShrink: 0, Position: PositionType.Relative, bar}
        if input.Hovering && !masked && confirming > 0 {
            let content = Container{
                Gap: AppTheme.Space4,
                KeyValue(ui, ui.Strings.Get("confirming"), Fixed(confirming)),
                KeyValue(ui, ui.Strings.Get("outputs"), outputs.ToString()),
                KeyValue(ui, ui.Strings.Get("all ready"), Wait(input.Ui, last))
            }
            wrap.Add(ChartParts.Tooltip(0, 0, content, right: 20, bottom: height + AppTheme.Space8, zIndex: 5))
        }
        card.Add(wrap)
        card.Add(Legend(input, masked, ready, confirming, unconfirmed, total == 0))
        return card
    }

    private func Hide() {
        peeking = false
    }

    private func Legend(
        input OverviewBalanceInput,
        masked bool,
        ready uint64,
        confirming uint64,
        unconfirmed uint64,
        empty bool
    ) Blob {
        let ui = input.Ui
        let wide = heroWidth - 40 >= 470
        let legend = Container{
            FlexDirection: wide ? FlexDirection.Row: FlexDirection.Column,
            Gap: AppTheme.Space8,
            FlexShrink: 0
        }
        let items = [](string, uint64, Color){
            ("ready", ready, AppTheme.Lime),
            ("confirming", confirming, AppTheme.Orange),
            ("in mempool", unconfirmed, AppTheme.Blue)
        }
        for (label, units, tint) in items {
            let name = TextParts.Legend(ui, ui.Strings.Get(label), tint)
            name.Height = 18
            if label == "confirming" {
                name.Add(Info(ui))
            }
            let text = masked ? "••••••••": Fixed(units)
            let color = if masked || empty {
                AppTheme.Dim
            } else if label == "ready" {
                AppTheme.Ink
            } else {
                tint
            }
            let value = TextParts.Value(
                ui,
                label,
                ui.Strings.Get(label) + " " + if masked {
                    ui.Strings.Get("Amounts hidden")
                } else {
                    WalletAmount.Format(units)
                },
                text,
                AppTheme.GetLegendFigureSize(wide, input.Height),
                color,
                AppTheme.Dim
            )
            legend.Add(
                if wide {
                    Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Gap: AppTheme.Space6, name, value}
                } else {
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        name,
                        Container{FlexGrow: 1},
                        value
                    }
                }
            )
        }
        return legend
    }

    private func Info(ui Presentation) Blob -> Cell.Mount[InfoTipInput, InfoTip](
        "confirming-info",
        InfoTipInput{
            Ui: ui,
            Topic: "About confirming",
            Lines: []string{
                "Received: 10 blocks.",
                "Mined: 60 blocks.",
                "Mempool: change from your send.",
                "1 block ≈ 5 min."
            },
            Language: ui.Strings.Language,
            Width: 300,
            Placement: PopoverPlacement.BottomStart,
            TakeFocus: false
        }
    )
}

class OverviewNetwork : Cell, IDisposable {
    private var source OverviewNetworkInput
    private var hashrate float64
    private var difficulty uint64
    private var blocks[]NetworkBlock = []NetworkBlock{}
    private let networkPlot ElementHandle = ElementHandle()
    private var plotWidth float64
    private var plotHeight float64
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var request CancellationTokenSource? = nil
    private var generation int32
    private var loadedHeight uint64? = nil
    private var loadedHash string = ""

    init() {
        networkPlot.MetricsChanged += _ -> {
            let bounds = networkPlot.BorderBox
            if bounds.Width != plotWidth || bounds.Height != plotHeight {
                plotWidth = bounds.Width
                plotHeight = bounds.Height
                Rebuild()
            }
        }
    }

    func Accept(next OverviewNetworkInput) {
        if source == next {
            Read()
            return
        }
        if source.Session != next.Session ||
            source.Api != next.Api ||
            source.Wallet != next.Wallet ||
            source.Network != next.Network ||
            source.Endpoint != next.Endpoint ||
            source.ProcessId != next.ProcessId ||
            source.Window != next
            .Window {
            generation++
            request?.Cancel()
            request?.Dispose()
            request = nil
            loadedHeight = nil
            loadedHash = ""
            let report = next.Session.Network
            hashrate = report.Hashrate
            difficulty = report.Difficulty
            blocks = report.Blocks
        }
        source = next
        Rebuild()
        Read()
    }

    private func Read() {
        if !source.Running || request != nil || (loadedHeight == source.Height && loadedHash == source.BestHash) {
            return
        }
        if blocks.Length > 0 &&
            blocks[blocks.Length - 1].Height == source.Height &&
            blocks[blocks.Length - 1]
            .Hash
            .StartsWith(source.BestHash, StringComparison.Ordinal) {
            return
        }
        guard let window = source.Window else {
            return
        }
        let current = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, window.Closed)
        request = current
        loadedHeight = source.Height
        loadedHash = source.BestHash
        let session = source.Session
        let id = generation
        let token = current.Token
        go Load(session, window, id, token)
    }

    private async func Load(session NodeSession, window Window, id int32, token CancellationToken) {
        var result NetworkReport? = nil
        try {
            result = await session.ReadNetworkSummaryAsync(token)
        } catch (error Exception) { }
        window.TryPost(
            () -> if id == generation {
                request?.Dispose()
                request = nil
                if let value = result {
                    let changed = hashrate != value.Hashrate || difficulty != value.Difficulty
                    let blocksChanged = !blocks.SequenceEqual(value.Blocks)
                    hashrate = value.Hashrate
                    difficulty = value.Difficulty
                    if blocksChanged {
                        blocks = value.Blocks
                    }
                    if changed || blocksChanged {
                        Rebuild()
                    }
                    Read()
                } else {
                    loadedHeight = nil
                }
            }
        )
    }

    public func Dispose() {
        generation++
        lifetime.Cancel()
        request?.Dispose()
        lifetime.Dispose()
    }

    override func Build() Blob {
        let input = source
        let ui = input.Ui
        let online = input.Running
        let size = input.Width < 1200 ? AppTheme.Type20: AppTheme.Type24
        let color = online ? AppTheme.Ink: AppTheme.Dim
        let card = WalletParts.Card(ui, AppTheme.Space16, AppTheme.Space10)
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.OnPointerDown = (event PointerEvent) -> if !event.IsFromInteractiveChild {
            input.OnNavigate(AppPage.Network)
        }
        let height = !online ? ui.Strings.Get("offline"): Count(input.Height)
        let sync = !online ? "": input.Syncing ? "/ " + Count(input.ChainHeight): ui.Strings.Get("synced")
        let age = Math.Max(0L, DateTimeOffset.Now.ToUnixTimeSeconds() - input.LastBlockTime)
        let last = input.LastBlockTime == 0 ? "-": String.Format(
            ui.Strings.Get(age < 3600 ? "{0}m ago": age < 86400 ? "{0}h ago": "{0} days"),
            age < 3600 ? age / 60: age < 86400 ? age / 3600: age / 86400
        )
        let first = Container{
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space10,
            TextParts.Figure(
                ui,
                "height",
                height,
                sync,
                size,
                !online ? AppTheme.Pink: input.Syncing ? AppTheme.Orange: AppTheme.Lime,
                1.85
            ),
            TextParts.Figure(ui, "peers", Count(input.Peers), "", size, color),
            TextParts.Figure(ui, "last block", last, "", size, online && age > 900 ? AppTheme.Orange: color)
        }
        card.Add(first)
        let second = Container{
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space10,
            TextParts.Figure(ui, "hashrate", Rate(hashrate), Unit(hashrate), size, color, 1.85),
            TextParts.Figure(ui, "difficulty", Compact(difficulty), "", size, color),
            TextParts.Figure(
                ui,
                "mempool",
                Count(input.Mempool),
                ui.Strings.Get("tx") + " · " + (input.MempoolBytes / 1000.0).ToString(
                    "0.0",
                    CultureInfo.InvariantCulture
                ) +
                    " KB",
                size,
                color
            )
        }
        card.Add(second)
        card.Add(NetworkParts.TimeChart(ui, blocks, networkPlot, 0, _ -> { }, true, !online))
        let count = blocks.Length - 1
        let average = count > 0 ? Duration(
            (blocks[blocks.Length - 1].Timestamp - blocks[blocks.Length - count - 1].Timestamp) / count
        ): "-"
        card.Add(
            WalletParts.Header(
                Label(ui, ui.Strings.Get("block time") + " " + average, AppTheme.Type12, color, ""),
                AppTheme.Space8,
                Link(ui, "network", () -> input.OnNavigate(AppPage.Network))
            )
        )
        return card
    }
}

class OverviewRecent : Cell {
    private var source OverviewRecentInput
    private var expanded string = ""
    private var rows[]OverviewRow = []OverviewRow{}
    private let rowKey Func[OverviewRow, string]
    private let rowBuilder Func[OverviewRow, Blob]

    init() {
        rowKey = row -> row.Key
        rowBuilder = row -> row.IsArrival ? Arrive(source, row): Activity(source, row.Activity)
    }

    func Accept(next OverviewRecentInput) {
        if source.Equals(next) {
            return
        }
        if source.Wallet != next.Wallet || source.Network != next.Network {
            expanded = ""
        }
        source = next
        PrepareRows()
        Rebuild()
    }

    private func PrepareRows() {
        let next = source
            .Rows
            .Select(
            row -> row with{
                Privacy = source.Privacy,
                Wide = source.Width >= 1200,
                Language = source.Language,
                Hovering = row.IsArrival && row.Arrival.Kind == "pool" && source.Hovering,
                Expanded = row.Key == expanded
            }
        )
            .ToArray()
        if !next.SequenceEqual(rows) {
            rows = next
        }
    }

    private func Number(ui Presentation, masked bool, text string, color Color, fraction Color) Blob {
        if masked {
            return Label(ui, "••••••••", AppTheme.Type14, fraction, "")
        }
        let point = text.IndexOf('.')
        return Text{
            Content: text,
            StyleRanges: []TextStyleRange{
                TextStyleRange(TextRange(point, text.Length - point), Style{Color: fraction})
            },
            FontSize: AppTheme.Type14,
            Color: color,
            TextWrap: TextWrap.NoWrap,
            FlexShrink: 0
        }
    }

    private func Fade(color Color, faded bool) Color -> if faded {
        Color.FromNormalized(color.R * 0.3F + 0.014F, color.G * 0.3F + 0.014F, color.B * 0.3F + 0.014F, 1F)
    } else {
        color
    }

    private func Arrive(input OverviewRecentInput, value OverviewRow) Blob {
        let item = value.Arrival
        let ui = input.Ui
        let faded = input.Hovering && item.Kind == "pool"
        let unfolded = value.Expanded
        let glyph Blob = switch item.Kind {
            case "mined": Label(ui, "◆", AppTheme.Type14, Fade(AppTheme.Lime, faded), "")
            case "in": Label(ui, "↓", AppTheme.Type14, Fade(AppTheme.Mint, faded), "")
            default: MaterialIcons.Create("replay", AppTheme.Icon14, Fade(AppTheme.Blue, faded))
        }
        let row = Goo
            .Button{
            Key: value.Key,
            BasedOn: AppTheme.ListRowStyle,
            FlexDirection: FlexDirection.Column,
            AlignItems: AlignItems.Stretch,
            JustifyContent: JustifyContent.FlexStart,
            Gap: AppTheme.Space6,
            Padding: Edges{Top: AppTheme.Space12, Bottom: AppTheme.Space12},
            FlexShrink: 0,
            BackgroundColor: Color.Transparent,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: Hidden(input.Privacy, SafeText(item.Source, 512)) + " " + Wait(input.Ui, item.Blocks),
                Expanded: item.TxId.Length > 0 ? unfolded: nil
            },
            OnClick: () -> {
                if item.TxId.Length > 0 {
                    expanded = unfolded ? "": value.Key
                    PrepareRows()
                }
            },
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space12,
                Container{Width: 16, AlignItems: AlignItems.Center, glyph},
                Container{
                    Width: 120,
                    Number(ui, input.Privacy, Fixed(item.Amount), Fade(AppTheme.Ink, faded), Fade(AppTheme.Dim, faded))
                },
                Grow(
                    Label(
                        ui,
                        Hidden(input.Privacy, SafeText(item.Source, 512)),
                        AppTheme.Type13,
                        Fade(AppTheme.Dim, faded),
                        ""
                    )
                ),
                Container{
                    Width: input.Width < 1200 ? 110.0: 160.0,
                    Gap: AppTheme.Space6,
                    AlignItems: AlignItems.FlexEnd,
                    Label(
                        ui,
                        item.Kind == "pool" ? ui.Strings.Get("mempool"): item.Confirmations.ToString() +
                            "/" +
                            item
                            .Required
                            .ToString(),
                        AppTheme.Type11,
                        Fade(item.Kind == "pool" ? AppTheme.Blue: AppTheme.Orange, faded),
                        ""
                    ),
                    Container{
                        Width: Percent(100),
                        Height: 3,
                        BackgroundColor: Fade(AppTheme.Rule, faded),
                        Container{
                            Width: Percent(100.0 * item.Confirmations / item.Required),
                            Height: 3,
                            BackgroundColor: Fade(AppTheme.Orange, faded)
                        }
                    }
                },
                Container{
                    Width: 60,
                    AlignItems: AlignItems.FlexEnd,
                    Label(ui, Wait(input.Ui, item.Blocks), AppTheme.Type11, Fade(AppTheme.Dim, faded), "")
                }
            }
        }
        WidgetKeyBindings.BindActivation(row)
        if unfolded {
            let ready = Timestamp(DateTimeOffset.Now.ToUnixTimeSeconds() + int64(item.Blocks * 300))
            row.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    FlexWrap: FlexWrap.Wrap,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space16,
                    RowGap: AppTheme.Space6,
                    Padding: Edges{Left: AppTheme.Space28, Top: AppTheme.Space4},
                    KeyValue(ui, ui.Strings.Get("block"), Count(item.Height), AppTheme.Space6, AppTheme.Dim),
                    KeyValue(ui, "tx", OverviewParts.Short(item.TxId).Substring(3), AppTheme.Space6, AppTheme.Dim),
                    KeyValue(ui, ui.Strings.Get("ready at"), ready, AppTheme.Space6, AppTheme.Dim),
                    Container{FlexGrow: 1},
                    Link(ui, "history", () -> input.OnHistory(item.TxId))
                }
            )
        }
        return row
    }

    override func Build() Blob {
        let input = source
        let ui = input.Ui
        let card = WalletParts.Card(
            ui,
            Edges{Top: AppTheme.Space12, Bottom: AppTheme.Space12, Left: AppTheme.Space16, Right: AppTheme.Space16},
            AppTheme.Space0
        )
        card.Overflow = Overflow.Hidden
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.MinWidth = 0
        let header = WalletParts.Header(Label(ui, ui.Strings.Get("recent"), AppTheme.Type12, AppTheme.Body, ""))
        header.Height = 24
        header.Margin = Edges{Bottom: AppTheme.Space4}
        if input.IncomingOutputs > 0 {
            header.Add(
                Label(
                    ui,
                    ui.Strings.Get("incoming") + " " + input.IncomingOutputs.ToString(),
                    AppTheme.Type11,
                    AppTheme.Body,
                    ""
                )
            )
            header.Add(
                Label(
                    ui,
                    ui.Strings.Get("all ready") + " " + Wait(input.Ui, input.IncomingBlocks),
                    AppTheme.Type11,
                    AppTheme.Dim,
                    ""
                )
            )
        }
        header.Add(Container{FlexGrow: 1})
        header.Add(Link(ui, "history", () -> input.OnNavigate(AppPage.Transactions)))
        card.Add(header)
        if input.Issue.Length > 0 {
            card.Add(Label(ui, input.Issue, AppTheme.Type12, AppTheme.Pink, ""))
        }
        if rows.Length == 0 {
            if !input.HasTransactions {
                card.Add(ListParts.Empty(ui, "no transactions yet"))
            }
            return card
        }
        let list = VirtualRows(rows, 48.0, rowKey, rowBuilder)
        list.FlexGrow = 1
        list.FlexBasis = 0
        list.MinHeight = 0
        card.Add(ListParts.Viewport(list))
        return card
    }

    private func Activity(input OverviewRecentInput, item HistoryActivity) Blob {
        let ui = input.Ui
        let outgoing = item.Kind == "out" || item.Kind == "self"
        let shown = input.Privacy ? ui.Strings.Get("Amounts hidden"): WalletAmount.Format(item.Amount)
        let glyph Blob = if item.Kind == "self" {
            MaterialIcons.Create("sync", AppTheme.Icon14, AppTheme.Pink)
        } else {
            Label(
                ui,
                outgoing ? "↑": item.Kind == "mined" ? "◆": "↓",
                AppTheme.Type14,
                outgoing ? AppTheme.Pink: item.Kind == "mined" ? AppTheme.Lime: AppTheme.Mint,
                ""
            )
        }
        return Container{
            BasedOn: AppTheme.ListRowStyle,
            Gap: AppTheme.Space12,
            Height: 48,
            FlexShrink: 0,
            MinWidth: 0,
            Overflow: Overflow.Hidden,
            Accessibility: Accessibility{
                Name: ui.Strings.Get(item.Kind == "self" ? "To self": outgoing ? "sent": "received") +
                    " " +
                    shown +
                    " " +
                    Hidden(input.Privacy, SafeText(item.Label, 512))
            },
            Container{Width: 16, AlignItems: AlignItems.Center, glyph},
            Container{
                Width: 120,
                Number(
                    ui,
                    input.Privacy,
                    (outgoing ? "-": "+") +
                        (item.Kind == "self" ? WalletAmount.Format(item.Amount): Fixed(item.Amount)),
                    outgoing ? AppTheme.Pink: AppTheme.Mint,
                    AppTheme.Dim
                )
            },
            Grow(Label(ui, Hidden(input.Privacy, SafeText(item.Label, 512)), AppTheme.Type13, AppTheme.Dim, "")),
            Container{
                Width: input.Width < 1200 ? 110.0: 160.0,
                AlignItems: AlignItems.FlexEnd,
                Label(
                    ui,
                    item.Status == "mempool" ? ui.Strings.Get("mempool"): item.Status,
                    AppTheme.Type11,
                    item.Status == "mempool" ? AppTheme.Blue: item.Ready ? AppTheme.Lime: AppTheme.Orange,
                    ""
                )
            },
            Container{
                Width: 132,
                AlignItems: AlignItems.FlexEnd,
                Label(ui, Timestamp(item.Timestamp), AppTheme.Type12, AppTheme.Dim, "")
            }
        }
    }

    private func Timestamp(timestamp int64) string {
        if timestamp <= 0 {
            return "-"
        }
        let local = DateTimeOffset.FromUnixTimeSeconds(timestamp).LocalDateTime
        return local.ToString(local.Date == DateTime.Today ? "HH:mm": "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)
    }
}
