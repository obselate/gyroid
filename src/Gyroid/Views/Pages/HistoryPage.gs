package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Data
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import System
import System.Collections.Generic
import System.Globalization
import System.IO
import System.Linq
import System.Threading

data struct HistoryInput {
    var Session WalletSession
    var Ui Presentation
    var Snapshot WalletSnapshot
    var Window Window?
    var Tip uint64
    var Privacy bool
    var Language string
    var Width float64
    var OnReceive Action
    var OnMessage Action[string]
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var SelectionTx string = ""
    var SelectionRevision int32
}

data struct HistoryIdentity {
    var Network string
    var Wallet string
}

data struct HistoryReadSource {
    var Api NodeApi
    var Endpoint string
    var Start int64
    var Running bool
}

data struct HistoryRibbonInput {
    var Window Window?
    var Ui Presentation
    var Rows[]HistoryRow
    var Times Dictionary[uint64, int64]
    var Revision int32
    var Tip uint64
    var Low uint64
    var Span uint64
    var From uint64
    var To uint64
    var Privacy bool
    var Language string
    var Width float64
    var OnSelect Action[uint64, uint64]
    var RequestTimes Action[IEnumerable[uint64]]
}

data struct HistoryListInput {
    var Ui Presentation
    var Session WalletSession
    var Window Window?
    var Address string
    var Identity HistoryIdentity
    var Source HistoryReadSource
    var Rows[]HistoryRow
    var Privacy bool
    var Language string
    var Width float64
    var Period string
    var OnMessage Action[string]
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnMark Action[uint64]
    var RequestTimes Action[IEnumerable[uint64]]
    var LoadMore Action
    var SelectionKey string
    var SelectionTx string
    var SelectionRevision int32
}

data struct HistoryExportInput {
    var Window Window?
    var Ui Presentation
    var Session WalletSession
    var Network string
    var Wallet string
    var Tip uint64
    var Cutoff uint64
    var Period string
    var From uint64
    var To uint64
    var Count int32
    var Times Dictionary[uint64, int64]
    var Language string
    var Collect Func[[]HistoryRow]
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
}

class HistoryPage : Cell, IDisposable {
    private var current HistoryInput
    private var disposed bool
    private var identity HistoryIdentity
    private var source HistoryReadSource
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var periodRequest CancellationTokenSource?
    private var timesRequest CancellationTokenSource?
    private var paginationRequest CancellationTokenSource?
    private var periodGeneration int32
    private var timesGeneration int32
    private var paginationGeneration int32
    private var period string = "30d"
    private var from uint64
    private var to uint64
    private var low uint64
    private var span uint64 = 1
    private var shown[]HistoryRow = []HistoryRow{}
    private var allRows[]HistoryRow = []HistoryRow{}
    private var cutoff uint64
    private var received uint64
    private var sent uint64
    private var fees uint64
    private var mined uint64
    private var preparationGeneration int32
    private var preparedExport[]HistoryRow = []HistoryRow{}
    private var preparedExportCount int32
    private var selectedKey string = ""
    private var preparationRequest CancellationTokenSource?
    private var sourcePrepared bool
    private var fetching bool
    private var loading bool
    private var resolving bool
    private var resolvedPeriod string = ""
    private var resolvedTip uint64
    private var periodStart uint64
    private var timesRevision int32
    private var times Dictionary[uint64, int64] = Dictionary[uint64, int64]()
    private let requested HashSet[uint64] = HashSet[uint64]()
    private var failedTimes WalletSnapshot?
    private var failedPeriod WalletSnapshot?
    private var failedPeriodTip uint64
    private var paginationIssue string = ""
    private var ribbonInput HistoryRibbonInput
    private var listInput HistoryListInput
    private var exportInput HistoryExportInput
    private var ribbon HistoryRibbon?
    private let configureRibbon Action[HistoryRibbon]
    private let configureList Action[HistoryTransactions]
    private let configureExport Action[HistoryExport]
    private let selectRange Action[uint64, uint64]
    private let markRow Action[uint64]
    private let requestTimes Action[IEnumerable[uint64]]
    private let loadMore Action
    private let collectExport Func[[]HistoryRow]

    init() {
        configureRibbon = cell -> {
            ribbon = cell
            cell.Accept(ribbonInput)
        }
        configureList = cell -> cell.Accept(listInput)
        configureExport = cell -> cell.Accept(exportInput)
        selectRange = (start, end) -> {
            if from == start && to == end {
                return
            }
            from = start
            to = end
            PrepareRange()
            Rebuild()
        }
        markRow = height -> ribbon?.Mark(height)
        requestTimes = heights -> RequestTimes(heights)
        loadMore = () -> LoadMore()
        collectExport = () -> preparedExport
    }

    shared {
        public func SourceIdentity(session WalletSession) HistoryIdentity -> HistoryIdentity{
            Network: session.settings.Network,
            Wallet: session.settings.ActiveWallet
        }

        public func ReadSource(session WalletSession) HistoryReadSource -> HistoryReadSource{
            Api: session.Node.Api,
            Endpoint: session.settings.Endpoint,
            Start: session.Node.Api.verifiedStart,
            Running: session.Node.Status.Running
        }
    }

    public func Accept(input HistoryInput) {
        let next = SourceIdentity(input.Session)
        let nextSource = ReadSource(input.Session)
        if disposed || (current.Equals(input) && next.Equals(identity) && nextSource.Equals(source)) {
            return
        }
        let resumePagination = loading && !nextSource.Equals(source)
        let pendingTimes = nextSource.Equals(source) ? Array.Empty[uint64](): requested.Except(times.Keys).ToArray()
        if !nextSource.Equals(source) {
            CancelRequests()
            requested.IntersectWith(times.Keys)
            failedTimes = nil
            failedPeriod = nil
            source = nextSource
        }
        if !next.Equals(identity) {
            CancelRequests()
            identity = next
            times = Dictionary[uint64, int64]()
            requested.Clear()
            failedTimes = nil
            failedPeriod = nil
            paginationIssue = ""
            resolvedPeriod = ""
            selectedKey = ""
            timesRevision++
            from = 0
            to = 0
        }
        if input.SelectionRevision != current.SelectionRevision && input.SelectionTx.Length > 0 {
            selectedKey = ""
            period = "all"
            from = 0
            to = 0
        }
        current = input
        PrepareRows()
        ResolveRange()
        RequestTimes(pendingTimes.Concat(input.Snapshot.History.Take(50).Select(output -> output.BlockHeight)))
        ContinueLoading()
        if resumePagination {
            LoadMore()
        }
        Rebuild()
    }

    private func Active(id HistoryIdentity) bool -> SourceIdentity(current.Session).Equals(id) && ReadSource(
        current.Session
    ).Equals(source)

    private func CancelRequests() {
        periodGeneration++
        timesGeneration++
        paginationGeneration++
        preparationGeneration++
        sourcePrepared = false
        preparationRequest?.Cancel()
        preparationRequest?.Dispose()
        preparationRequest = nil
        periodRequest?.Cancel()
        periodRequest?.Dispose()
        periodRequest = nil
        timesRequest?.Cancel()
        timesRequest?.Dispose()
        timesRequest = nil
        paginationRequest?.Cancel()
        paginationRequest?.Dispose()
        paginationRequest = nil
        resolving = false
        fetching = false
        loading = false
    }

    public func Dispose() {
        disposed = true
        CancelRequests()
        lifetime.Cancel()
        lifetime.Dispose()
    }

    private func ResolveRange() {
        guard let window = current.Window else {
            return
        }
        if period == "all" ||
            (resolvedPeriod == period && resolvedTip == current.Tip) ||
            resolving ||
            (failedPeriod == current.Snapshot && failedPeriodTip == current.Tip) {
            return
        }
        periodRequest?.Dispose()
        let request = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, window.Closed)
        periodRequest = request
        periodGeneration++
        resolving = true
        let input = current
        let selected = period
        let generation = periodGeneration
        let id = identity
        let token = request.Token
        go ResolvePeriod(window, input, selected, generation, id, token)
    }

    private func ContinueLoading() {
        if current.Snapshot.HistoryMore && period != "all" && resolvedPeriod == period {
            let rows = current.Snapshot.History
            if rows.Length > 0 && rows[rows.Length - 1].BlockHeight >= periodStart {
                LoadMore()
            }
        }
    }

    private func PrepareRows(reuse bool = false) {
        guard let window = current.Window else {
            return
        }
        if !reuse {
            sourcePrepared = false
        }
        preparationGeneration++
        let generation = preparationGeneration
        let history = current.Session.History
        let id = identity
        let active = preparationRequest ?? CancellationTokenSource.CreateLinkedTokenSource(
            lifetime.Token,
            window.Closed
        )
        preparationRequest = active
        let token = active.Token
        let request = HistoryPreparation{
            Snapshot: current.Snapshot,
            Outputs: current.SelectionTx.Length > 0 ? current.Session.History.Outputs: current.Snapshot.History,
            Previous: allRows,
            PreviousShown: shown,
            PreviousExport: preparedExport,
            ExportOutputs: current.Session.History.Outputs,
            Tip: current.Tip,
            Times: times,
            Privacy: current.Privacy,
            Language: current.Language,
            SelectionTx: current.SelectionTx,
            Width: current.Width,
            Complete: current.SelectionTx.Length > 0,
            ReuseRows: reuse,
        }
        cutoff = period == "all" ? 0UL: resolvedPeriod == period ? periodStart: current.Tip + 1
        let selectedCutoff = cutoff
        let selectedFrom = from
        let selectedTo = to
        go PrepareCollection(window, history, request, selectedCutoff, selectedFrom, selectedTo, generation, id, token)
    }

    private func PrepareRange() -> PrepareRows(sourcePrepared)

    private func PrepareCollection(
        window Window,
        history HistoryService,
        request HistoryPreparation,
        cutoff uint64,
        from uint64,
        to uint64,
        generation int32,
        id HistoryIdentity,
        ct CancellationToken
    ) {
        try {
            let result = history.Prepare(request, cutoff, from, to, ct)
            window.TryPost(
                () -> {
                    if disposed || generation != preparationGeneration || !Active(id) {
                        return
                    }
                    sourcePrepared = true
                    if Object.ReferenceEquals(allRows, result.Rows) && Object.ReferenceEquals(shown, result.Shown) &&
                        Object.ReferenceEquals(preparedExport, result.Export) &&
                        low == result.Low &&
                        span == result.Span &&
                        preparedExportCount == result.ExportCount &&
                        selectedKey == result.SelectionKey {
                        return
                    }
                    allRows = result.Rows
                    shown = result.Shown
                    preparedExport = result.Export
                    low = result.Low
                    preparedExportCount = result.ExportCount
                    selectedKey = result.SelectionKey
                    span = result.Span
                    received = result.Summary.Received
                    sent = result.Summary.Sent
                    fees = result.Summary.Fees
                    mined = result.Summary.Mined
                    Rebuild()
                }
            )
        } catch (error Exception) {
            let issue = error.Message
            window.TryPost(
                () -> {
                    if !disposed && generation == preparationGeneration && Active(id) {
                        paginationIssue = issue
                        Rebuild()
                    }
                }
            )
        }
    }

    override func Build() Blob {
        let input = current
        let ui = input.Ui
        let compact = input.Width < 1000
        let all = allRows
        let tip = input.Tip
        let panel = WalletParts.Card(
            ui,
            Edges{Top: AppTheme.Space12, Bottom: AppTheme.Space12, Left: AppTheme.Space20, Right: AppTheme.Space20},
            compact ? AppTheme.Space8: AppTheme.Space10
        )
        panel.FlexGrow = 1
        panel.AlignSelf = AlignSelf.Stretch
        let bar = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            Height: 30,
            FlexShrink: 0,
            Segments(
                "period",
                "range",
                []string{"1d", "7d", "30d", "all"},
                period,
                id -> {
                    failedPeriod = nil
                    period = id
                    to = 0
                    ResolveRange()
                    ContinueLoading()
                    PrepareRange()
                    Rebuild()
                }
            )
        }
        if to > 0 {
            bar.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space8,
                    Height: AppTheme.ControlCompact,
                    Padding: Edges{Left: AppTheme.Space10, Right: AppTheme.Space4},
                    BorderWidth: AppTheme.Border1,
                    BorderColor: AppTheme.Edge,
                    BorderRadius: AppTheme.Radius4,
                    Label(ui, Count(from) + " – " + Count(to), AppTheme.Type12, AppTheme.Ink, ""),
                    ControlParts.Icon(
                        ui,
                        MaterialIcons.Create("close", AppTheme.Icon12, AppTheme.Dim),
                        ui.Strings.Get("clear range"),
                        () -> {
                            to = 0
                            PrepareRange()
                            Rebuild()
                        },
                        size: AppTheme.ControlCompact,
                        style: AppTheme.DisclosureStyle
                    )
                }
            )
        }
        bar.Add(
            Info(
                "range",
                "Drag across blocks to pick a range. Bars above the line are received or mined. Bars below are sent.",
                input
            )
        )
        bar.Add(Container{FlexGrow: 1})
        exportInput = HistoryExportInput{
            Window: input.Window,
            Ui: ui,
            Session: input.Session,
            Network: identity.Network,
            Wallet: identity.Wallet,
            Cutoff: cutoff,
            Tip: tip,
            Period: period,
            From: from,
            To: to,
            Count: preparedExportCount,
            Times: times,
            Language: input.Language,
            Collect: collectExport,
            ChooseFile: input.ChooseFile
        }
        bar.Add(Cell.Mount[HistoryExport]("history-export", configureExport))
        panel.Add(bar)
        ribbonInput = HistoryRibbonInput{
            Window: input.Window,
            Ui: ui,
            Rows: allRows,
            Times: times,
            Revision: timesRevision,
            Tip: tip,
            Low: low,
            Span: span,
            From: from,
            To: to,
            Privacy: input.Privacy,
            Language: input.Language,
            Width: input.Width,
            OnSelect: selectRange,
            RequestTimes: requestTimes
        }
        panel.Add(Cell.Mount[HistoryRibbon]("history-ribbon", configureRibbon))
        if paginationIssue.Length > 0 {
            panel.Add(MessageParts.Problem(ui, paginationIssue))
        }
        if all.Length == 0 && !input.Snapshot.HistoryMore {
            panel.Add(
                ListParts.Empty(
                    ui,
                    ui.Strings.Get("No transactions yet"),
                    Button(ui, "receive", input.OnReceive, false, true)
                )
            )
            return panel
        }
        panel.Add(Summary(input))
        listInput = HistoryListInput{
            Ui: ui,
            Session: input.Session,
            Window: input.Window,
            Address: input.Snapshot.Address,
            Identity: identity,
            Source: source,
            Rows: shown,
            Privacy: input.Privacy,
            Language: input.Language,
            SelectionTx: input.SelectionTx,
            SelectionKey: selectedKey,
            SelectionRevision: input.SelectionRevision,
            Width: input.Width,
            Period: period,
            OnMessage: input.OnMessage,
            ChooseFile: input.ChooseFile,
            OnMark: markRow,
            RequestTimes: requestTimes,
            LoadMore: loadMore
        }
        panel.Add(Cell.Mount[HistoryTransactions]("history-list", configureList))
        return panel
    }

    private func Summary(input HistoryInput) Blob {
        let ui = input.Ui
        let gain = received + mined
        let loss = sent + fees
        let net = (gain >= loss ? "+": "−") + Amount(ui.Privacy, gain >= loss ? gain - loss: loss - gain)
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: input.Width < 1000 ? AppTheme.Space14: AppTheme.Space22,
            FlexShrink: 0,
            Padding: Edges{Top: AppTheme.Space2, Left: AppTheme.Space2, Right: AppTheme.Space2},
            Figure(
                ui,
                "in",
                received > 0 ? "+" + Amount(ui.Privacy, received): "0",
                AppTheme.Mint,
                AppTheme.Type14,
                compact: true
            ),
            Figure(
                ui,
                "out",
                sent > 0 ? "−" + Amount(ui.Privacy, sent): "0",
                AppTheme.Pink,
                AppTheme.Type14,
                compact: true
            ),
            Figure(ui, "fees", fees > 0 ? Amount(ui.Privacy, fees): "0", AppTheme.Body, AppTheme.Type14, compact: true),
            Figure(
                ui,
                "mined",
                mined > 0 ? "+" + Amount(ui.Privacy, mined): "0",
                AppTheme.Lime,
                AppTheme.Type14,
                compact: true
            ),
            Figure(ui, "net", net, AppTheme.Ink, input.Width < 1000 ? AppTheme.Type16: AppTheme.Type18, compact: true)
        }
    }

    private func Segments(key string, label string, ids[]string, selected string, chosen Action[string]) Blob ->
    ControlParts.Segment(current.Ui, label, ids, ids, selected, false, chosen, key: key)

    private func Info(topic string, text string, input HistoryInput) Blob -> Cell.Mount[InfoTipInput, InfoTip](
        "info-" + topic,
        InfoTipInput{Ui: input.Ui, Topic: topic, Lines: []string{text}, Language: input.Language, Width: 280}
    )

    private func RequestTimes(heights IEnumerable[uint64]) {
        if disposed || fetching {
            return
        }
        if failedTimes != nil && failedTimes != current.Snapshot {
            requested.IntersectWith(times.Keys)
            failedTimes = nil
        }
        let missing = heights.Where(height -> height > 0 && !requested.Contains(height)).Distinct().Take(16).ToArray()
        guard let window = current.Window else {
            return
        }
        if missing.Length == 0 {
            return
        }
        for height in missing {
            requested.Add(height)
        }
        timesRequest?.Dispose()
        let request = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, window.Closed)
        timesRequest = request
        timesGeneration++
        fetching = true
        let history = current.Session.History
        let snapshot = current.Snapshot
        let generation = timesGeneration
        let id = identity
        let token = request.Token
        let known = times
        go FetchTimes(window, history, snapshot, known, missing, generation, id, token)
    }

    private async func FetchTimes(
        window Window,
        history HistoryService,
        snapshot WalletSnapshot,
        known Dictionary[uint64, int64],
        heights[]uint64,
        generation int32,
        id HistoryIdentity,
        ct CancellationToken
    ) {
        var fetched = Dictionary[uint64, int64]()
        var failed = false
        try {
            fetched = await history.BlockTimesAsync(heights, ct)
        } catch (error OperationCanceledException) { } catch (error Exception) {
            failed = true
        }
        let merged = Dictionary[uint64, int64](known)
        for entry in fetched {
            merged[entry.Key] = entry.Value
        }
        window.TryPost(
            () -> {
                if !Active(id) || generation != timesGeneration {
                    return
                }
                fetching = false
                times = merged
                if failed {
                    failedTimes = snapshot
                }
                if fetched.Count > 0 {
                    timesRevision++
                    PrepareRows()
                    Rebuild()
                }
            }
        )
    }

    private func LoadMore() {
        guard let window = current.Window else {
            return
        }
        if disposed || loading || !current.Snapshot.HistoryMore {
            return
        }
        paginationRequest?.Dispose()
        let request = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, window.Closed)
        paginationRequest = request
        paginationGeneration++
        loading = true
        paginationIssue = ""
        let history = current.Session.History
        let generation = paginationGeneration
        let id = identity
        let token = request.Token
        go LoadMoreAsync(window, history, generation, id, token)
    }

    private async func LoadMoreAsync(
        window Window,
        history HistoryService,
        generation int32,
        id HistoryIdentity,
        ct CancellationToken
    ) {
        var issue string = ""
        try {
            await history.LoadMoreAsync(ct)
        } catch (error OperationCanceledException) { } catch (error Exception) {
            issue = error.Message
        }
        window.TryPost(
            () -> {
                if !Active(id) || generation != paginationGeneration {
                    return
                }
                loading = false
                paginationIssue = issue
                if issue.Length == 0 {
                    ContinueLoading()
                }
                Rebuild()
            }
        )
    }

    private async func ResolvePeriod(
        window Window,
        input HistoryInput,
        selected string,
        generation int32,
        id HistoryIdentity,
        ct CancellationToken
    ) {
        var start uint64
        var failed = false
        try {
            start = await input.Session.History.PeriodStartAsync(selected, input.Tip, ct)
        } catch (error OperationCanceledException) { } catch (error Exception) {
            failed = true
        }
        window.TryPost(
            () -> {
                if !Active(id) || generation != periodGeneration {
                    return
                }
                resolving = false
                if selected != period {
                    ResolveRange()
                    return
                }
                if failed {
                    failedPeriod = input.Snapshot
                    failedPeriodTip = input.Tip
                } else {
                    resolvedPeriod = selected
                    resolvedTip = input.Tip
                    periodStart = start
                    PrepareRange()
                    ContinueLoading()
                    Rebuild()
                }
                ResolveRange()
            }
        )
    }
}

class HistoryRibbon : Cell, IDisposable {
    private var current HistoryRibbonInput
    private var days float64
    private let marks List[uint64] = List[uint64]()
    private var hoverCell HistoryRibbonHover?
    private var plotHeight float64
    private let configureHover Action[HistoryRibbonHover]
    private var plotWidth float64
    private let plot ElementHandle = ElementHandle()
    private var generation int32
    private var request CancellationTokenSource?
    private var data HistoryRibbonData = HistoryRibbonData{
        Bins: [40]HistoryRibbonBin,
        Received: [40]float64,
        Mined: [40]float64,
        Sent: [40]float64,
        Top: 1
    }

    init() {
        configureHover = cell -> {
            hoverCell = cell
            cell.Accept(current, plotWidth, plotHeight, data.Bins)
        }
        plot.MetricsChanged += metrics -> {
            if metrics.BorderBox.Width != plotWidth {
                plotWidth = metrics.BorderBox.Width
                PrepareBins()
                Rebuild()
            }
        }
    }

    public func Accept(input HistoryRibbonInput) {
        if current.Equals(input) {
            return
        }
        let changed = !Object.ReferenceEquals(current.Rows, input.Rows) ||
            current.Low != input.Low ||
            current.Span != input.Span ||
            current.Tip != input.Tip
        current = input
        days = float64(input.Span) / 288
        let mark = days <= 1 ? 48UL: days <= 7 ? 288UL: 288UL * uint64(Math.Ceiling(days / 6))
        marks.Clear()
        var at = input.Tip - Math.Min(input.Tip, mark)
        while at > input.Low + mark * 3 / 10 {
            marks.Add(at)
            at -= Math.Min(at, mark)
        }
        input.RequestTimes(marks)
        if changed {
            PrepareBins()
        }
        Rebuild()
    }

    private func PrepareBins() {
        guard let window = current.Window else {
            return
        }
        generation++
        let run = generation
        let rows = current.Rows
        let low = current.Low
        let span = current.Span
        let tip = current.Tip
        let active = request ?? CancellationTokenSource.CreateLinkedTokenSource(window.Closed)
        request = active
        let token = active.Token
        let columns = int32(Math.Max(40.0, Math.Min(float64(span), Math.Floor(plotWidth / 3))))
        go PrepareBinsAsync(window, rows, low, span, tip, columns, run, token)
    }

    private func PrepareBinsAsync(
        window Window,
        rows[]HistoryRow,
        low uint64,
        span uint64,
        tip uint64,
        columns int32,
        run int32,
        ct CancellationToken
    ) {
        try {
            let result = HistoryService.PrepareRibbon(rows, low, span, tip, columns, ct)
            window.TryPost(
                () -> {
                    if run == generation {
                        data = result
                        Rebuild()
                    }
                }
            )
        } catch (error OperationCanceledException) { } catch (error Exception) {
            Console.Error.WriteLine(error.Message)
        }
    }

    public func Dispose() {
        generation++
        request?.Cancel()
        request?.Dispose()
    }

    public func Mark(height uint64) -> hoverCell?.Mark(height)

    override func Build() Blob {
        let input = current
        let compact = input.Width < 1000
        let from = input.From
        let to = input.To
        let times = input.Times
        let ui = input.Ui
        let tip = input.Tip
        let width = plotWidth
        let height = compact ? 60.0: input.Width >= 1700 ? 110.0: 84.0
        plotHeight = height
        let columns = data.Bins.Length
        let received = data.Received
        let mined = data.Mined
        let sent = data.Sent
        let top = data.Top
        let scale Func[float64, float64] = value -> input.Privacy ? 1.0: Math.Sqrt(value / top)
        let up = PathBuilder(0, 0, Math.Max(1.0, width), height)
        let coin = PathBuilder(0, 0, Math.Max(1.0, width), height)
        let down = PathBuilder(0, 0, Math.Max(1.0, width), height)
        let step = width / columns
        for column in 0 ... columns {
            let x = (column + 0.15) * step
            let w = 0.7 * step
            let total = received[column] + mined[column]
            if total > 0 {
                let bar = scale(total) * 0.44 * height
                let split = bar * received[column] / total
                Rectangle(up, x, 0.56 * height - bar, w, split)
                Rectangle(coin, x, 0.56 * height - bar + split, w, bar - split)
            }
            if sent[column] > 0 {
                Rectangle(down, x, 0.58 * height, w, Math.Max(0.03, scale(sent[column]) * 0.4) * height)
            }
        }
        let area = Container{
            Handle: plot,
            Height: height,
            FlexShrink: 0,
            Container{
                Position: PositionType.Absolute,
                Left: 0,
                Right: 0,
                Top: 0.57 * height,
                Height: 1,
                BackgroundColor: AppTheme.Edge
            },
            Shape{
                Position: PositionType.Absolute,
                Width: width,
                Height: height,
                Path: up.Build(),
                Fit: ShapeFit.Fill,
                BackgroundColor: AppTheme.Mint
            },
            Shape{
                Position: PositionType.Absolute,
                Width: width,
                Height: height,
                Path: coin.Build(),
                Fit: ShapeFit.Fill,
                BackgroundColor: AppTheme.Lime
            },
            Shape{
                Position: PositionType.Absolute,
                Width: width,
                Height: height,
                Path: down.Build(),
                Fit: ShapeFit.Fill,
                BackgroundColor: AppTheme.Pink
            }
        }
        if to > 0 {
            let left = Offset(from - 1)
            let right = Offset(to)
            area.Add(Shade(0, left))
            area.Add(Shade(right, width))
            area.Add(Handle(left, height))
            area.Add(Handle(right, height))
        }
        area.Add(Cell.Mount[HistoryRibbonHover]("history-ribbon-hover", configureHover))
        let axis = Container{
            Height: 18,
            FlexShrink: 0,
            BorderWidth: Edges{Top: AppTheme.Border1},
            BorderColor: AppTheme.Edge
        }
        for value in marks {
            let seconds = times.GetValueOrDefault(value)
            if seconds > 0 {
                let time = DateTimeOffset.FromUnixTimeSeconds(seconds).ToLocalTime()
                axis.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Left: Offset(value) - 40,
                        Width: 80,
                        Top: 3,
                        AlignItems: AlignItems.Center,
                        Label(
                            ui,
                            time.ToString(days <= 1 ? "HH:mm": "MM-dd", CultureInfo.InvariantCulture),
                            AppTheme.Type11,
                            AppTheme.Dim,
                            ""
                        )
                    }
                )
            }
        }
        axis.Add(
            Container{
                Position: PositionType.Absolute,
                Right: 0,
                Top: 3,
                Label(ui, Count(tip), AppTheme.Type11, AppTheme.Body, "")
            }
        )
        return Container{
            FlexShrink: 0,
            Padding: Edges{Top: AppTheme.Space8, Left: AppTheme.Space12, Right: AppTheme.Space12},
            BorderWidth: AppTheme.Border1,
            BorderColor: AppTheme.Rule,
            BorderRadius: AppTheme.Radius4,
            BackgroundColor: AppTheme.Raised,
            area,
            axis
        }
    }

    private func Rectangle(path PathBuilder, x float64, y float64, w float64, h float64) {
        path.MoveTo(x, y).LineTo(x + w, y).LineTo(x + w, y + h).LineTo(x, y + h).Close()
    }

    private func Offset(height uint64) float64 -> plotWidth * Math.Clamp(
        (float64(height) - float64(current.Low)) / current.Span,
        0.0,
        1.0
    )

    private func Shade(left float64, right float64) Blob -> Container{
        Position: PositionType.Absolute,
        Left: left,
        Width: Math.Max(0.0, right - left),
        Top: 0,
        Bottom: 0,
        BackgroundColor: AppTheme.Black.WithAlpha(0.88),
        HitTestSelf: false
    }

    private func Handle(x float64, height float64) Blob -> Container{
        Position: PositionType.Absolute,
        Left: x - 4,
        Width: 8,
        Top: 0,
        Bottom: 0,
        AlignItems: AlignItems.Center,
        HitTestSelf: false,
        Container{Width: 2, Height: height, BackgroundColor: AppTheme.Lime},
        Container{
            Position: PositionType.Absolute,
            Top: height / 2 - 11,
            Width: 8,
            Height: 22,
            BorderRadius: AppTheme.Radius2,
            BackgroundColor: AppTheme.Lime
        }
    }
}

class HistoryRibbonHover : Cell {
    private var current HistoryRibbonInput
    private var plotWidth float64
    private var plotHeight float64
    private var dragging bool
    private var anchor uint64
    private var hover int32 = -1
    private var marked uint64
    private var bins[]HistoryRibbonBin = [40]HistoryRibbonBin

    public func Accept(input HistoryRibbonInput, width float64, height float64, prepared[]HistoryRibbonBin) {
        if current.Equals(input) && plotWidth == width && plotHeight == height && Object.ReferenceEquals(
            bins,
            prepared
        ) {
            return
        }
        current = input
        plotWidth = width
        plotHeight = height
        bins = prepared
        hover = -1
        Rebuild()
    }

    public func Mark(height uint64) {
        if marked != height {
            marked = height
            Rebuild()
        }
    }

    override func Build() Blob {
        let input = current
        let low = input.Low
        let span = input.Span
        let tip = input.Tip
        let from = input.From
        let to = input.To
        let width = plotWidth
        let columns = bins.Length
        let size = float64(span) / columns
        let step = width / columns
        let area = Container{
            Position: PositionType.Absolute,
            Left: 0,
            Top: 0,
            Width: width,
            Height: plotHeight,
            Focusable: true,
            Accessibility: Accessibility{Name: input.Ui.Strings.Get("block range")},
            Focus: Theme.Read().FocusStyle,
            OnPointerDown: (event PointerEvent) -> {
                event.Capture()
                dragging = true
                anchor = HeightAt(event.Position.X)
                Select(anchor, anchor)
            },
            OnPointerMove: (event PointerEvent) -> {
                let at = HeightAt(event.Position.X)
                if dragging {
                    Select(Math.Min(anchor, at), Math.Max(anchor, at))
                } else {
                    hover = Math.Min(columns - 1, int32(Math.Max(0.0, event.Position.X) / step))
                }
            },
            OnPointerUp: (event PointerEvent) -> {
                dragging = false
                if to - from < 2 {
                    let column = Math.Min(columns - 1, int32(Math.Max(0.0, event.Position.X) / step))
                    Select(low + 1 + uint64(column * size), Math.Min(tip, low + uint64((column + 1) * size)))
                }
            },
            OnPointerLeave: (event PointerEvent) -> {
                hover = -1
            },
            OnKeyDown: (event KeyEvent) -> {
                let block = uint64(Math.Max(1.0, size))
                if event.Key == Key.Escape && to > 0 {
                    current.OnSelect(0, 0)
                } else if event.Key == Key.Left || event.Key == Key.Right {
                    let start = to > 0 ? from: tip - block + 1
                    let end = to > 0 ? to: tip
                    let shift = event.Key == Key.Left ? -int64(block): int64(block)
                    let next = uint64(Math.Clamp(int64(start) + shift, int64(low + 1), int64(tip)))
                    if event.Modifiers.Shift {
                        Select(Math.Min(next, end), end)
                    } else {
                        Select(next, Math.Min(tip, next + block - 1))
                    }
                    event.PreventDefault()
                }
            }
        }
        let cursor = if hover >= 0 && !dragging {
            (hover + 0.5) * step
        } else if marked > low {
            width * Math.Clamp((float64(marked) - low) / span, 0.0, 1.0)
        } else {
            -1.0
        }
        if cursor >= 0 {
            area.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: cursor,
                    Width: 1,
                    Top: 0,
                    Bottom: 0,
                    BackgroundColor: AppTheme.Thumb,
                    HitTestSelf: false
                }
            )
        }
        if hover >= 0 && !dragging {
            area.Add(Tip(input, hover, size, step, width))
        }
        return area
    }

    private func HeightAt(x float64) uint64 -> Math.Max(
        current.Low + 1,
        current.Low + uint64(Math.Round(Math.Clamp(x / Math.Max(1.0, plotWidth), 0.0, 1.0) * current.Span))
    )

    private func Select(start uint64, end uint64) {
        hover = -1
        current.OnSelect(start, end)
    }

    private func Tip(input HistoryRibbonInput, column int32, size float64, step float64, width float64) Blob {
        let ui = input.Ui
        let start = current.Low + 1 + uint64(column * size)
        let end = Math.Max(start, current.Low + uint64((column + 1) * size))
        let bin = bins[column]
        let tip = Container{
            Gap: AppTheme.Space4,
            Label(ui, start == end ? Count(start): Count(start) + " – " + Count(end), AppTheme.Type12, AppTheme.Ink, "")
        }
        if bin.Time > 0 {
            tip.Add(Label(ui, Moment(bin.Time), AppTheme.Type12, AppTheme.Dim, ""))
        }
        for category in[]HistoryRowKind{HistoryRowKind.Received, HistoryRowKind.Mined, HistoryRowKind.Sent} {
            let count = category == HistoryRowKind.Received ? bin.ReceivedCount:
            category == HistoryRowKind.Mined ? bin.MinedCount: bin.SentCount
            if count > 0 {
                let total = category == HistoryRowKind.Received ? bin.Received:
                category == HistoryRowKind.Mined ? bin.Mined: bin.Sent
                tip.Add(
                    Label(
                        ui,
                        (category == HistoryRowKind.Sent ? "−": "+") + Amount(ui.Privacy, total),
                        AppTheme.Type12,
                        Tint(category),
                        ""
                    )
                )
            }
        }
        let x = (column + 0.5) * step
        return ChartParts.Tooltip(x + 12, 4, tip, right: x > width / 2 ? width - x + 12: nil, zIndex: 3)
    }

    private func Tint(category HistoryRowKind) Color -> switch category {
        case HistoryRowKind.Received: AppTheme.Mint
        case HistoryRowKind.Mined: AppTheme.Lime
        case HistoryRowKind.Pending: AppTheme.Orange
        case HistoryRowKind.Sent: AppTheme.Pink
    }

    private func Moment(seconds int64) string -> DateTimeOffset
        .FromUnixTimeSeconds(seconds)
        .ToLocalTime()
        .ToString("MM-dd HH:mm", CultureInfo.InvariantCulture)
}

class HistoryTransactions : Cell, IDisposable {
    private var current HistoryListInput
    private var expanded string = ""
    private var tab string = "details"
    private var revision int32
    private var proofFor string = ""
    private var proofKey string = ""
    private var proofValid bool
    private var proofRecipient int32
    private var proofIssue string = ""
    private var observed string = ""
    private var observerRow HistoryRow
    private var observeRequest CancellationTokenSource?
    private var observeGeneration int32
    private var view ObserverView?
    private var viewLoading bool
    private var selectedRevision int32 = -1
    private var selectionTimer WindowTimer?
    private var viewIssue string = ""
    private let closeObserver Action
    private let proveObserved Action
    private var shown[]HistoryRow = []HistoryRow{}
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var proofRequest CancellationTokenSource?
    private var proofGeneration int32
    private let list ElementHandle = ElementHandle()
    private var firstVisible int32
    private let rowKey Func[HistoryRow, string]
    private let rowBuilder Func[HistoryRow, Blob]
    private var detailRow HistoryRow
    private let recipientKey Func[HistoryRecipient, string]
    private let recipientBuilder Func[HistoryRecipient, Blob]

    init() {
        closeObserver = () -> {
            observeGeneration++
            observeRequest?.Cancel()
            observed = ""
            Rebuild()
        }
        proveObserved = () -> {
            observeGeneration++
            observeRequest?.Cancel()
            observed = ""
            tab = "proof"
            revision++
            if proofFor != observerRow.TxId {
                Prove(observerRow)
            }
            RefreshRows()
        }
        rowKey = row -> row.Key
        rowBuilder = row -> Row(row)
        recipientKey = entry -> entry.Index.ToString()
        recipientBuilder = entry -> Recipient(entry)
        list.MetricsChanged += metrics -> {
            firstVisible = int32(metrics.ScrollOffset.Y / 38)
            current.RequestTimes(shown.Skip(Math.Max(0, firstVisible - 10)).Take(50).Select(row -> row.Height))
            if current.Period == "all" && metrics.ScrollRange.Y - metrics.ScrollOffset.Y < 440 {
                current.LoadMore()
            }
        }
    }

    public func Accept(input HistoryListInput) {
        if current.Equals(input) {
            return
        }
        let sourceChanged = !current.Source.Equals(input.Source)
        let restartProof = sourceChanged && proofFor.Length > 0 && proofKey.Length == 0 && proofIssue.Length == 0
        let restartObserver = sourceChanged && viewLoading
        if sourceChanged || !current.Identity.Equals(input.Identity) {
            proofGeneration++
            proofRequest?.Cancel()
            observeGeneration++
            observeRequest?.Cancel()
        }
        if !current.Identity.Equals(input.Identity) {
            selectedRevision = -1
            selectionTimer?.Dispose()
            expanded = ""
            observed = ""
            proofFor = ""
            proofKey = ""
        }
        let selected = input.SelectionTx.Length > 0 && input.SelectionRevision != selectedRevision ?
        input.SelectionKey: ""
        if selected.Length > 0 {
            proofGeneration++
            proofRequest?.Cancel()
            proofFor = ""
            proofKey = ""
            proofRecipient = 0
            expanded = selected
            selectedRevision = input.SelectionRevision
            tab = "details"
        }
        current = input
        if restartProof {
            let row = Array.FindIndex(input.Rows, (row HistoryRow) -> row.TxId == proofFor)
            if row >= 0 {
                Prove(input.Rows[row])
            }
        }
        if restartObserver && observed.Length > 0 {
            Observe(observed)
        }
        input.RequestTimes(input.Rows.Skip(Math.Max(0, firstVisible - 10)).Take(50).Select(row -> row.Height))
        RefreshRows()
        if selected.Length > 0 {
            selectionTimer?.Dispose()
            let key = selected
            let revision = selectedRevision
            selectionTimer = input.Window?.SetTimeout(
                () -> {
                    selectionTimer = nil
                    if revision == selectedRevision {
                        list.ScrollToItem(key)
                    }
                },
                1
            )
        }
    }

    private func RefreshRows() {
        let rows = current
            .Rows
            .Select(row -> row with{Open = row.Key == expanded, Revision = row.Key == expanded ? revision: 0})
            .ToArray()
        if !shown.SequenceEqual(rows) {
            shown = rows
        }
        detailRow = shown.FirstOrDefault(row -> row.Key == expanded)
        Rebuild()
    }

    public func Dispose() {
        selectionTimer?.Dispose()
        proofGeneration++
        observeGeneration++
        lifetime.Cancel()
        proofRequest?.Dispose()
        observeRequest?.Dispose()
        lifetime.Dispose()
    }

    private func Active(id HistoryIdentity) bool -> HistoryPage.SourceIdentity(current.Session).Equals(id) &&
        HistoryPage
        .ReadSource(current.Session).Equals(current.Source)

    override func Build() Blob {
        let input = current
        let ui = input.Ui
        let panel = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0}
        let rows = VirtualRows(shown, 38, rowKey, rowBuilder, false)
        rows.Handle = list
        rows.FlexGrow = 1
        rows.FlexBasis = 0
        rows.MinHeight = 0
        rows.BorderWidth = Edges{Top: AppTheme.Border1}
        rows.BorderColor = AppTheme.Rule
        panel.Add(ListParts.Viewport(rows))
        let lensRow = Array.FindIndex(
            shown,
            (row HistoryRow) -> row.Kind == HistoryRowKind.Sent && row.TxId == observed
        )
        if lensRow >= 0 {
            let row = shown[lensRow]
            let portal = Portal()
            observerRow = row
            let lens = ObserverLensInput{
                Ui: ui,
                View: view,
                Loading: viewLoading,
                Error: viewIssue,
                Amount: row.SentAmount,
                Fee: row.Fee,
                State: row.State,
                Confirmations: row.Maturity.Confirmations,
                Memo: row.Recipients.Select(entry -> entry.Memo).FirstOrDefault(value -> value.Length > 0) ?? "",
                Recipient: WalletText.Short(row.Recipients.FirstOrDefault().Address ?? "") +
                    (row.Recipients.Length > 1 ? " +" + (row.Recipients.Length - 1).ToString(): ""),
                Privacy: input.Privacy,
                Language: input.Language,
                Width: input.Width,
                OnProve: proveObserved,
                OnClose: closeObserver
            }
            portal.Add(Cell.Mount[ObserverLensInput, ObserverLens]("history-observer", lens))
            panel.Add(portal)
        }
        return panel
    }

    private func Row(row HistoryRow) Blob {
        let ui = current.Ui
        let compact = row.Width < 1000
        let pending = row.Height == 0
        let mature = !pending && row.Maturity.Ready
        let lit = pending ? 0: int32(row.Maturity.Count * 10 / row.Maturity.Required)
        let segments = Container{
            FlexDirection: FlexDirection.Row,
            FlexShrink: 1,
            Gap: compact ? AppTheme.Space2: AppTheme.Space4
        }
        for index in 0 ... 10 {
            segments.Add(
                Container{
                    Width: compact ? 9.0: 12.0,
                    Height: compact ? 5.0: 6.0,
                    FlexShrink: 1,
                    BorderRadius: AppTheme.Radius1,
                    BackgroundColor: index >= lit ? AppTheme.Rule: mature ? AppTheme.LimeMuted: AppTheme.Orange
                }
            )
        }
        let depth = if pending {
            ui.Strings.Get(row.State == "not_found" ? "not found": "pending")
        } else if mature {
            row.Maturity.Depth >= 10000 ? (row.Maturity.Depth / 1000).ToString() + "k": Count(row.Maturity.Depth)
        } else {
            row.Maturity.Count.ToString() + "/" + row.Maturity.Required.ToString()
        }
        let recipient = row.Recipients.FirstOrDefault()
        let note = row
            .Memo
            .Length > 0 ? row.Memo: row
            .Recipients
            .Length > 1 ? Short(recipient.Address ?? ""): Short(row.TxId)
        let preview = Hidden(ui.Privacy, SafeText(note, 512))
        let sign = row.Kind == HistoryRowKind.Received || row.Kind == HistoryRowKind.Mined ? "+": "−"
        let notes = Container{
            Padding: Edges{Left: AppTheme.Space6},
            FlexDirection: FlexDirection.Row,
            MinWidth: 0,
            Overflow: Overflow.Hidden,
            Gap: AppTheme.Space6,
            Grow(
                Label(
                    ui,
                    (row.Self ? ui.Strings.Get("To self") + " · ": "") + preview,
                    AppTheme.Type12,
                    row.Memo.Length > 0 ? AppTheme.Ink: AppTheme.Dim,
                    ""
                )
            )
        }
        if row.Recipients.Length > 1 {
            notes.Add(Label(ui, "+" + (row.Recipients.Length - 1).ToString(), AppTheme.Type12, AppTheme.Dim, ""))
        }
        let line = Goo
            .Button{
            BasedOn: AppTheme.ListRowStyle,
            Height: row.Width >= 1700 ? 42.0: 38.0,
            Gap: AppTheme.Space12,
            Padding: Edges{Left: AppTheme.Space10, Right: AppTheme.Space10},
            BorderColor: row.Open ? Color.Transparent: AppTheme.Rule,
            BackgroundColor: row.Open ? AppTheme.Raised: Color.Transparent,
            Hover: Style{BackgroundColor: AppTheme.Raised},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get(
                    row.Self ? "To self": switch row.Kind {
                        case HistoryRowKind.Received: "received"
                        case HistoryRowKind.Mined: "mined"
                        case HistoryRowKind.Sent: "sent"
                        case HistoryRowKind.Pending: "pending"
                    }
                ) +
                    " " +
                    sign +
                    Amount(ui.Privacy, row.Amount) +
                    " " +
                    preview +
                    " " +
                    depth,
                Expanded: row.Open
            },
            OnClick: () -> {
                proofGeneration++
                proofRequest?.Cancel()
                expanded = row.Open ? "": row.Key
                tab = "details"
                proofRecipient = 0
                proofFor = ""
                revision++
                RefreshRows()
            },
            OnPointerEnter: (event PointerEvent) -> {
                current.OnMark(row.Height)
            },
            OnPointerLeave: (event PointerEvent) -> {
                current.OnMark(0)
            },
            MaterialIcons.Create(
                row.Self ? "sync": switch row.Kind {
                    case HistoryRowKind.Received: "south_west"
                    case HistoryRowKind.Mined: "diamond"
                    case HistoryRowKind.Pending: "schedule"
                    case HistoryRowKind.Sent: "north_east"
                },
                AppTheme.Icon16,
                Tint(row.Kind)
            ),
            Container{
                Width: compact ? 112.0: 128.0,
                FlexShrink: 0,
                AlignItems: AlignItems.FlexEnd,
                Label(
                    ui,
                    sign + Amount(ui.Privacy, row.Amount),
                    AppTheme.Type14,
                    row.Kind == HistoryRowKind.Pending ? AppTheme.Pink: Tint(row.Kind),
                    ""
                )
            },
            Grow(notes),
            Container{
                Width: compact ? 170.0: 212.0,
                FlexShrink: 0,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                segments,
                Container{FlexShrink: 0, Label(ui, depth, AppTheme.Type12, mature ? AppTheme.Body: AppTheme.Orange, "")}
            }
        }
        WidgetKeyBindings.BindActivation(line)
        if row.Width >= 1100 {
            line.Children.Add(
                Container{
                    Width: 64,
                    FlexShrink: 0,
                    AlignItems: AlignItems.FlexEnd,
                    Label(ui, pending ? "": Count(row.Height), AppTheme.Type12, AppTheme.Body, "")
                }
            )
        }
        line.Children.Add(
            Container{
                Width: compact ? 84.0: 88.0,
                FlexShrink: 0,
                AlignItems: AlignItems.FlexEnd,
                Label(ui, row.Time > 0 ? Moment(row.Time): "", AppTheme.Type12, AppTheme.Body, "")
            }
        )
        line.Children.Add(
            MaterialIcons.Create(
                row.Open ? "expand_more": "chevron_right",
                AppTheme.Icon14,
                row.Open ? AppTheme.Ink: AppTheme.Dim
            )
        )
        let root = Container{Key: row.Key, FlexShrink: 0, line}
        if row.Open {
            root.Add(Details(row))
        }
        return root
    }

    private func Details(row HistoryRow) Blob {
        let ui = current.Ui
        let recipients = row.ProofRecipients
        let recipient = recipients.ElementAtOrDefault(proofRecipient)
        let panel = Container{
            Gap: AppTheme.Space12,
            Padding: Edges{
                Top: AppTheme.Space4,
                Bottom: AppTheme.Space14,
                Left: row.Width < 1000 ? AppTheme.Space16: AppTheme.ControlRegular,
                Right: AppTheme.Space16
            },
            BackgroundColor: AppTheme.Raised,
            BorderWidth: Edges{Bottom: AppTheme.Border1},
            BorderColor: AppTheme.Rule
        }
        if row.Kind == HistoryRowKind.Sent {
            let tabs = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space10,
                Segments(
                    "tabs",
                    "Transaction",
                    recipients.Length > 0 ? []string{"details", "proof"}: []string{"details"},
                    tab,
                    id -> {
                        tab = id
                        revision++
                        if id == "proof" && proofFor != row.TxId {
                            Prove(row)
                        }
                        RefreshRows()
                    }
                ),
                Container{FlexGrow: 1},
                ControlParts.Icon(
                    ui,
                    MaterialIcons.Create("visibility", AppTheme.Icon16, AppTheme.Body),
                    ui.Strings.Get("observer view"),
                    () -> Observe(row.TxId)
                )
            }
            if tab == "proof" {
                tabs.Add(
                    Info(
                        "proof",
                        "A proof shows that this address got this amount from you. Anyone can check it in Tools. Your keys stay private.",
                        current
                    )
                )
            }
            panel.Add(tabs)
            if tab == "proof" && recipients.Length > 0 {
                if proofIssue.Length > 0 {
                    panel.Add(MessageParts.Problem(ui, proofIssue))
                }
                if recipients.Length > 1 {
                    panel.Add(
                        Cell.Mount[ToggleGroupInput, ToggleGroup](
                            "proof-recipient",
                            ToggleGroupInput{
                                Items: recipients.Select(
                                    (entry HistoryRecipient, index int32) -> ToggleOption{
                                        Id: index.ToString(),
                                        Label: ui.Strings.Get("Recipient") + " " + (index + 1).ToString()
                                    }
                                )
                                    .ToArray(),
                                SelectedIds: []string{proofRecipient.ToString()},
                                AccessibilityName: ui.Strings.Get("recipient"),
                                OnChange: ids -> {
                                    if ids.Length > 0 {
                                        proofRecipient = Int32.Parse(ids[0], CultureInfo.InvariantCulture)
                                        Prove(row)
                                        revision++
                                        RefreshRows()
                                    }
                                }
                            }
                        )
                    )
                }
                panel.Add(
                    Block(
                        "proof key",
                        proofFor == row.TxId ? proofKey: "",
                        Grouped(proofFor == row.TxId ? proofKey: ""),
                        AppTheme.Ink
                    )
                )
                panel.Add(Block("transaction", row.TxId, Grouped(row.TxId), AppTheme.Body))
                panel.Add(
                    Block("recipient", recipient.Address ?? "", Spaced(recipient.Address ?? "", 10), AppTheme.Body)
                )
                let ready = proofFor == row.TxId && proofKey.Length > 0
                let actions = Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space10,
                    if ready {
                        Status(
                            ui,
                            ui.Strings.Get(proofValid ? "valid": "invalid"),
                            proofValid ? AppTheme.Lime: AppTheme.Pink,
                            proofValid ? "check": "close"
                        )
                    } else {
                        Container{}
                    },
                    Figure(
                        ui,
                        "amount",
                        Amount(ui.Privacy, recipient.Amount) + " BNT",
                        AppTheme.Ink,
                        AppTheme.Type14,
                        compact: true
                    ),
                    Container{FlexGrow: 1},
                    Button(ui, "save", () -> SaveProof(row), !ready),
                    Button(ui, "copy proof", () -> ui.Actions.Copy(ProofText(row), 120000), !ready, true)
                }
                panel.Add(actions)
                return panel
            }
        }
        let values = Container{
            FlexDirection: FlexDirection.Row,
            FlexWrap: FlexWrap.Wrap,
            RowGap: AppTheme.Space8,
            ColumnGap: AppTheme.Space24
        }
        values.Add(
            Figure(
                ui,
                "height",
                row.Height > 0 ? Count(row.Height): ui.Strings.Get("pending"),
                row.Height > 0 ? AppTheme.Ink: AppTheme.Orange,
                AppTheme.Type13,
                compact: true
            )
        )
        if row.Time > 0 {
            values.Add(Figure(ui, "time", Time(row.Time), AppTheme.Ink, AppTheme.Type13, compact: true))
        }
        if row.Kind == HistoryRowKind.Sent || row.Kind == HistoryRowKind.Pending {
            values.Add(Figure(ui, "fee", Amount(ui.Privacy, row.Fee), AppTheme.Ink, AppTheme.Type13, compact: true))
            if row.Recipients.Length == 1 {
                let address = row.Recipients[0].Address
                values.Add(
                    Figure(
                        ui,
                        "recipient",
                        Hidden(
                            ui.Privacy,
                            address.Length > 14 ? address.Substring(0, 8) + "…" + address.Substring(
                                address.Length - 6
                            ): address
                        ),
                        AppTheme.Ink,
                        AppTheme.Type13,
                        compact: true
                    )
                )
            }
        }
        if row.Kind == HistoryRowKind.Mined && !row.Maturity.Ready {
            values.Add(
                Figure(ui, "spendable at", Count(row.Height + 60), AppTheme.Orange, AppTheme.Type13, compact: true)
            )
        }
        if row.Kind == HistoryRowKind.Received {
            values.Add(
                Figure(
                    ui,
                    "output",
                    row.Indices.Length > 0 ? String.Join(", ", row.Indices.Select(index -> "#" + index.ToString())):
                    "#" + row.Index.ToString(),
                    AppTheme.Ink,
                    AppTheme.Type13,
                    compact: true
                )
            )
        }
        panel.Add(values)
        if row.Memo.Length > 0 && row.Recipients.Length <= 1 && !row.Self {
            panel.Add(MemoSection(row, row.Memo))
        }
        if row.Self || row.Recipients.Length > 1 {
            let recipients = VirtualRows(row.Recipients, 76, recipientKey, recipientBuilder, false)
            recipients.Height = Math.Min(228.0, row.Recipients.Length * 76.0)
            recipients.MinHeight = 0
            panel.Add(ListParts.Viewport(recipients, grow: false))
        }
        panel.Add(Block("transaction", row.TxId, Grouped(row.TxId), AppTheme.Body))
        return panel
    }

    private func Recipient(entry HistoryRecipient) Blob {
        let row = detailRow
        let ui = current.Ui
        let details = Container{
            Gap: AppTheme.Space4,
            if row.Self {
                Figure(ui, "output", "#" + entry.Index.ToString(), AppTheme.Ink, AppTheme.Type13, compact: true)
            } else {
                Block("recipient", entry.Address, Spaced(entry.Address, 10), AppTheme.Body)
            },
            Figure(
                ui,
                "amount",
                Amount(ui.Privacy, entry.Amount) + " BNT",
                AppTheme.Ink,
                AppTheme.Type13,
                compact: true
            )
        }
        if entry.Memo.Length > 0 {
            details.Add(MemoSection(row, entry.Memo))
        }
        return details
    }

    private func MemoSection(row HistoryRow, memo string) Blob {
        let ui = current.Ui
        let section = Container{
            Gap: AppTheme.Space4,
            MinWidth: 0,
            Overflow: Overflow.Hidden,
            Label(ui, ui.Strings.Get("memo"), AppTheme.Type12, AppTheme.Dim, "")
        }
        if current.Session.Messages.Lookup(row.TxId) != nil {
            let preview = Hidden(ui.Privacy, MessagesPage.Preview(SafeText(memo, 512)))
            let label = Label(ui, preview, AppTheme.Type13, AppTheme.Ink, "")
            let button = Goo
                .Button{
                BasedOn: AppTheme.ButtonStyle,
                MinWidth: 0,
                Padding: AppTheme.Space8,
                BorderRadius: AppTheme.Radius6,
                BackgroundColor: AppTheme.Rule,
                Hover: Style{BackgroundColor: AppTheme.Edge},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: preview},
                OnClick: () -> current.OnMessage(row.TxId),
                label
            }
            WidgetKeyBindings.BindActivation(button)
            section.Add(button)
        } else {
            section.Add(
                Container{
                    MinWidth: 0,
                    MaxHeight: 100,
                    OverflowY: Overflow.Scroll,
                    ScrollbarY: Theme.Read().Scrollbar,
                    Text{
                        Content: Hidden(ui.Privacy, SafeText(memo, 512)),
                        FontFamily: AppTheme.Font,
                        FontSize: AppTheme.Type13,
                        Color: AppTheme.Ink,
                        TextWrap: TextWrap.Wrap,
                        MinWidth: 0
                    }
                }
            )
        }
        return section
    }

    private func Block(label string, value string, text string, color Color) Blob ->
    Copyable(current.Ui, label, value, Hidden(current.Ui.Privacy, text), valueColor: color, disabled: value.Length == 0)

    private func Spaced(value string, size int32) string {
        let parts = List[string]()
        var start = 0
        while start < value.Length {
            parts.Add(value.Substring(start, Math.Min(size, value.Length - start)))
            start += size
        }
        return String.Join(" ", parts)
    }

    private func Segments(key string, label string, ids[]string, selected string, chosen Action[string]) Blob ->
    ControlParts.Segment(current.Ui, label, ids, ids, selected, false, chosen, key: key)

    private func Info(topic string, text string, input HistoryListInput) Blob -> Cell.Mount[InfoTipInput, InfoTip](
        "info-" + topic,
        InfoTipInput{Ui: input.Ui, Topic: topic, Lines: []string{text}, Language: input.Language, Width: 280}
    )

    private func Tint(category HistoryRowKind) Color -> switch category {
        case HistoryRowKind.Received: AppTheme.Mint
        case HistoryRowKind.Mined: AppTheme.Lime
        case HistoryRowKind.Pending: AppTheme.Orange
        case HistoryRowKind.Sent: AppTheme.Pink
    }

    private func Moment(seconds int64) string -> DateTimeOffset
        .FromUnixTimeSeconds(seconds)
        .ToLocalTime()
        .ToString("MM-dd HH:mm", CultureInfo.InvariantCulture)

    private func Short(value string) string -> value.Length > 16 ? value.Substring(0, 8) + "…" + value.Substring(
        value.Length - 8
    ): value

    private func Prove(row HistoryRow) {
        let recipients = row.ProofRecipients
        if proofRecipient >= recipients.Length {
            return
        }
        guard let window = current.Window else {
            return
        }
        proofRequest?.Cancel()
        proofRequest?.Dispose()
        let request = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, window.Closed)
        proofRequest = request
        proofGeneration++
        let generation = proofGeneration
        let id = current.Identity
        let proofs = current.Session.Proofs
        let recipient = recipients[proofRecipient]
        let amount = WalletAmount.Format(recipient.Amount)
        proofFor = row.TxId
        proofKey = ""
        proofIssue = ""
        proofValid = false
        let transaction = row.TxId
        let address = recipient.Address
        let token = request.Token
        go LoadProof(window, proofs, transaction, address, amount, generation, id, token)
    }

    private async func LoadProof(
        window Window,
        proofs MessageProofs,
        transaction string,
        recipient string,
        amount string,
        generation int32,
        id HistoryIdentity,
        ct CancellationToken
    ) {
        try {
            let key = await proofs.ProveAsync(transaction, ct)
            let valid = await proofs.VerifyProofAsync(transaction, key, recipient, amount, ct)
            window.TryPost(
                () -> {
                    if !Active(id) || generation != proofGeneration {
                        return
                    }
                    proofKey = key
                    proofValid = valid
                    revision++
                    RefreshRows()
                }
            )
        } catch (error OperationCanceledException) { } catch (error Exception) {
            let issue = error.Message
            window.TryPost(
                () -> {
                    if !Active(id) || generation != proofGeneration {
                        return
                    }
                    proofIssue = issue
                    revision++
                    RefreshRows()
                }
            )
        }
    }

    private func ProofText(row HistoryRow) string {
        let strings = current.Ui.Strings
        let recipient = row.ProofRecipients.ElementAtOrDefault(proofRecipient)
        return strings.Get("transaction") + " " + row.TxId + "\n" + strings.Get("proof key") +
            " " +
            proofKey +
            "\n" +
            strings.Get("recipient") + " " + (recipient.Address ?? "") + "\n" + strings.Get("amount") +
            " " +
            WalletAmount.Format(recipient.Amount) + "\n"
    }

    private func SaveProof(row HistoryRow) {
        let input = current
        let text = ProofText(row)
        input.ChooseFile.Invoke(
            FileDialogKind.SaveFile,
            "save",
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "proof-" + row.TxId.Substring(0, 8) + ".txt"
            ),
            path -> input.Ui.Actions.Run(ct -> input.Session.History.WriteTextAsync(path, text, ct))
        )
    }

    private func Observe(transaction string) {
        observed = transaction
        observeGeneration++
        observeRequest?.Cancel()
        observeRequest?.Dispose()
        view = nil
        viewIssue = ""
        viewLoading = false
        if let window = current.Window {
            let request = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, window.Closed)
            observeRequest = request
            viewLoading = true
            let selected = observeGeneration
            let checks = current.Session.Checks
            let id = current.Identity
            let token = request.Token
            go LoadObserver(window, checks, transaction, id, selected, token)
        }
        Rebuild()
    }

    private async func LoadObserver(
        window Window,
        checks PrivacyChecks,
        transaction string,
        id HistoryIdentity,
        selected int32,
        ct CancellationToken
    ) {
        try {
            let result = await checks.ObserveAsync(transaction, ct)
            window.TryPost(
                () -> {
                    if selected != observeGeneration || !Active(id) {
                        return
                    }
                    viewLoading = false
                    view = result
                    Rebuild()
                }
            )
        } catch (error OperationCanceledException) { } catch (error Exception) {
            let issue = error.Message
            window.TryPost(
                () -> {
                    if selected != observeGeneration || !Active(id) {
                        return
                    }
                    viewLoading = false
                    viewIssue = issue
                    Rebuild()
                }
            )
        }
    }
}

class HistoryExport : Cell, IDisposable {
    private var current HistoryExportInput
    private var exporting bool
    private var exportRows int32
    private var format string = "csv"
    private var memos bool = true
    private let exportAnchor ElementHandle = ElementHandle()
    private var generation int32
    private var disposed bool
    private var issue string = ""

    public func Accept(input HistoryExportInput) {
        if current.Equals(input) {
            return
        }
        if current.Network != input.Network || current.Wallet != input.Wallet {
            exporting = false
            generation++
            issue = ""
        }
        current = input
        if exporting {
            exportRows = input.Count
        }
        Rebuild()
    }

    public func Dispose() {
        disposed = true
        generation++
    }

    override func Build() Blob {
        let input = current
        let period = input.Period
        let from = input.From
        let to = input.To
        let ui = input.Ui
        let button = ControlParts.Button(
            ui,
            "export",
            () -> {
                exporting = !exporting
                if exporting {
                    exportRows = input.Count
                }
                Rebuild()
            },
            input.Count == 0,
            appearance: AppTheme.CompactButton with{
                Leading = MaterialIcons.Create("download", AppTheme.Icon16, AppTheme.Ink),
                BorderColor = exporting ? AppTheme.StrongEdge: AppTheme.Edge,
                BackgroundColor = exporting ? AppTheme.FaintRule: AppTheme.Raised
            },
            hasPopup: true,
            expanded: exporting
        )
        let shownRange = to > 0 ? Count(from) + " – " + Count(to): ui.Strings.Get(period)
        let content = Container{
            Gap: AppTheme.Space12,
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                Label(ui, shownRange, AppTheme.Type12, AppTheme.Dim, ""),
                Container{FlexGrow: 1},
                Info(
                    "export",
                    "The file is not encrypted. It holds amounts, heights, times and transaction IDs.",
                    input
                )
            },
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Label(ui, ui.Strings.Get("format"), AppTheme.Type12, AppTheme.Dim, ""),
                Segments(
                    "format",
                    "format",
                    []string{"csv", "json"},
                    format,
                    id -> {
                        format = id
                        Rebuild()
                    }
                )
            },
            (
                AppTheme.Checkbox with{
                    State = memos ? AccessibilityChecked.True: AccessibilityChecked.False,
                    Label = ui.Strings.Get("memos"),
                    LabelFontSize = AppTheme.Type12,
                    OnChange = state -> {
                        memos = state == AccessibilityChecked.True
                        Rebuild()
                    }
                }
            ).Build(),
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.SpaceBetween,
                Figure(ui, "rows", exportRows.ToString(), AppTheme.Ink, AppTheme.Type14, compact: true),
                Button(ui, "save", () -> SaveExport(input), exportRows == 0, true)
            }
        }
        if issue.Length > 0 {
            content.Add(MessageParts.Problem(ui, ui.Strings.Explain(issue)))
        }
        return Container{
            Handle: exportAnchor,
            FlexShrink: 0,
            button,
            Cell.Mount[PopoverInput, Popover](
                "export",
                PopoverInput{
                    Open: exporting,
                    Anchor: exportAnchor,
                    Placement: PopoverPlacement.BottomEnd,
                    Gap: AppTheme.Space8,
                    Width: 300,
                    Padding: AppTheme.Space14,
                    BackgroundColor: AppTheme.Raised,
                    BorderColor: AppTheme.Edge,
                    Content: content,
                    Role: AccessibilityRole.Dialog,
                    AccessibilityName: ui.Strings.Get("export"),
                    OnDismiss: reason -> {
                        exporting = false
                        Rebuild()
                    }
                }
            )
        }
    }

    private func Segments(key string, label string, ids[]string, selected string, chosen Action[string]) Blob ->
    ControlParts.Segment(current.Ui, label, ids, ids, selected, false, chosen, key: key)

    private func Info(topic string, text string, input HistoryExportInput) Blob -> Cell.Mount[InfoTipInput, InfoTip](
        "info-" + topic,
        InfoTipInput{Ui: input.Ui, Topic: topic, Lines: []string{text}, Language: input.Language, Width: 280}
    )

    private func SaveExport(input HistoryExportInput) {
        exporting = false
        generation++
        let run = generation
        issue = ""
        Rebuild()
        let rows = input.Collect()
        let known = input.Times
        let withMemos = memos
        let suffix = format
        input.ChooseFile.Invoke(
            FileDialogKind.SaveFile,
            "save",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "history." + suffix),
            path -> input.Ui.Actions.Run(ct -> Export(input, path, rows, known, withMemos, suffix, run, ct))
        )
    }

    private async func Export(
        input HistoryExportInput,
        path string,
        rows[]HistoryRow,
        known Dictionary[uint64, int64],
        withMemos bool,
        suffix string,
        run int32,
        ct CancellationToken
    ) {
        var failure string = ""
        try {
            await input
                .Session
                .History
                .WriteExport(path, rows, input.Tip, known, withMemos, suffix, input.Period, input.From, input.To, ct)
        } catch (error Exception) {
            failure = error.Message
        }
        let result = failure
        input.Window?.TryPost(
            () -> {
                if !disposed && run == generation {
                    issue = result
                    exporting = result.Length > 0
                    Rebuild()
                }
            }
        )
    }
}
