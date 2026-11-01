package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Data
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Navigation
import Gsharp.Extensions.Go
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import Gyroid.Views.ToolsParts
import System
import System.Collections.Generic
import System.Globalization
import System.IO
import System.Linq
import System.Threading
import System.Threading.Tasks

class ToolsState {
    var Tab string = "sign"
    var Report OutputReport? = nil
    var SignMessage string = ""
    var SignSignature string = ""
    var VerifyAddress string = ""
    var VerifyMessage string = ""
    var VerifySignature string = ""
    var ProofTransaction string = ""
    var ProofKey string = ""
    var ProofAddress string = ""
    var ProofAmount string = ""
}

data struct ToolsInput {
    var Region ToolsRegionInput
    var State ToolsState
    var ViewOnly bool
    var Outputs uint64
    var MemoErrors uint64
    var Peers uint64
    var Section AppPage
    var AutoLock int32
    var Width float64
    var Height float64
    var OnNavigate Action[AppPage]
    var OnPrivacy Action
    var OnNodeSettings Action
}

data struct ToolsRegionInput {
    var Session WalletSession
    var Ui Presentation
    var State ToolsState
    var Busy bool
    var Privacy bool
    var Language string
    var Compact bool
    var Identity string
}

data struct ToolsPhraseInput {
    var Region ToolsRegionInput
    var Width float64
    var Height float64
    var OnClose Action
    var OnChecked Action[DateTime?]
}

data struct ToolsHealthInput {
    var Region ToolsRegionInput
    var State ToolsState
    var Outputs uint64
    var OnReport Action
}

data struct ToolsLockInput {
    var Region ToolsRegionInput
    var AutoLock int32
}

class ToolsPage : Cell {
    private let configurePrivacy Action[ToolsPrivacyRegion]
    private let configureHealth Action[ToolsHealthRegion]
    private let reportChanged Action
    private var current ToolsInput

    init() {
        reportChanged = () -> Rebuild()
        configurePrivacy = region -> region.Accept(current)
        configureHealth = region -> region.Accept(
            ToolsHealthInput{
                Region: current.Region,
                State: current.State,
                Outputs: current.Outputs,
                OnReport: reportChanged
            }
        )
    }

    func Accept(input ToolsInput) {
        if !current.Equals(input) {
            current = input
            Rebuild()
        }
    }

    override func Build() Blob {
        let input = current
        if input.Section == AppPage.Privacy {
            return Cell.Mount[ToolsPrivacyRegion]("privacy-" + input.Region.Identity, configurePrivacy)
        }
        let region = input.Region
        let ui = region.Ui
        let tab = input.ViewOnly && input.State.Tab == "sign" ? "verify": input.State.Tab
        let ids = input.ViewOnly ? []string{"verify", "proof", "health"}: []string{"sign", "verify", "proof", "health"}
        let items = [ids.Length]NavigationItem
        for index in 0 ... ids.Length {
            items[index] = NavigationItem{Id: ids[index], Label: ui.Strings.Get(ids[index])}
        }
        let card = WalletParts.PageCard(ui, input.Width, input.Height)
        if tab == "health" && (input.State.Report?.Stale.Length ?? 0) > 0 {
            card.Height = Percent(100)
        }
        card.Add(
            Tabs(
                ui,
                "tools-tabs",
                "tools",
                items,
                tab,
                id -> {
                    input.State.Tab = id
                    Rebuild()
                }
            )
        )
        card.Add(
            switch tab {
                case "sign": Cell.Mount[ToolsRegionInput, ToolsSignRegion]("sign-" + region.Identity, region)
                case "verify": Cell.Mount[ToolsRegionInput, ToolsVerifyRegion]("verify-" + region.Identity, region)
                case "proof": Cell.Mount[ToolsRegionInput, ToolsProofRegion]("proof-" + region.Identity, region)
                default: Cell.Mount[ToolsHealthRegion]("health-" + region.Identity, configureHealth)
            }
        )
        return card
    }
}

class ToolsPrivacyRegion : Cell, IDisposable {
    private var current ToolsInput
    private var loaded bool
    private var checking bool
    private var checkedAt DateTime?
    private var fileMode UnixFileMode?
    private var generation int32
    private var auditing bool
    private var auditIssue string = ""
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private let closePhrase Action
    private let checkedPhrase Action[DateTime?]

    init() {
        closePhrase = () -> {
            checking = false
            Rebuild()
        }
        checkedPhrase = date -> {
            if generation == 0 {
                checkedAt = date
                Rebuild()
            }
        }
    }

    func Accept(input ToolsInput) {
        if current.Equals(input) {
            return
        }
        current = input
        if !loaded {
            loaded = true
            if let window = input.Region.Ui.Actions.window {
                let session = input.Region.Session
                let identity = input.Region.Identity
                let run = generation
                go ReadChecks(session, window, identity, run)
            }
        }
        Rebuild()
    }

    private func ReadChecks(session WalletSession, window Window, identity string, run int32) {
        try {
            let date = session.Checks.PhraseChecked()
            var mode UnixFileMode?
            try {
                mode = session.Checks.WalletFileMode()
            } catch (failure Exception) { }
            window.TryPost(
                () -> {
                    if run == generation && identity == ReadWalletIdentity(session) {
                        checkedAt = date
                        fileMode = mode
                        Rebuild()
                    }
                }
            )
        } catch (failure Exception) { }
    }

    override func Build() Blob -> if checking {
        Cell.Mount[ToolsPhraseInput, ToolsPhraseRegion](
            "phrase-check",
            ToolsPhraseInput{
                Region: current.Region,
                Width: current.Width,
                Height: current.Height,
                OnClose: closePhrase,
                OnChecked: checkedPhrase
            }
        )
    } else {
        Privacy(current)
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        lifetime.Dispose()
    }

    private func Privacy(input ToolsInput) Blob {
        let context = input.Region
        let ui = context.Ui
        let compact = context.Compact
        let size = compact ? AppTheme.Type16: AppTheme.Type20
        let report = input.State.Report
        let stale = report?.Stale.Length ?? 0
        let shared = UnixFileMode.GroupRead |
        UnixFileMode.GroupWrite |
        UnixFileMode.GroupExecute |
        UnixFileMode.OtherRead |
        UnixFileMode.OtherWrite |
        UnixFileMode.OtherExecute
        let exposed = ((fileMode ?? UnixFileMode.None) & shared) != 0
        let unchecked = !input.ViewOnly && checkedAt == nil
        let memos = input.MemoErrors
        let warnings = []bool{
            unchecked,
            input.AutoLock == 0,
            !context.Privacy,
            false,
            input.Peers == 0,
            stale > 0,
            memos > 0,
            exposed
        }
        let phraseValue = if input.ViewOnly {
            Label(ui, ui.Strings.Get("view-only"), size, AppTheme.Dim, "")
        } else {
            Label(
                ui,
                ui.Strings.Get(unchecked ? "not checked": "checked"),
                size,
                unchecked ? AppTheme.Orange: AppTheme.Ink,
                ""
            )
        }
        let phraseFoot = if unchecked {
            Small(context, "Check", true, () -> checking = true)
        } else if let date = checkedAt {
            Note(context, Day(context, date, false))
        } else {
            Container{}
        }
        let lockValue = Cell.Mount[ToolsLockInput, ToolsLockRegion](
            "auto-lock",
            ToolsLockInput{Region: context, AutoLock: input.AutoLock}
        )
        let amountsValue = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            (
                AppTheme.Switch with{
                    Checked = context.Privacy,
                    AccessibilityName = ui.Strings.Get("hide amounts"),
                    OnClick = input.OnPrivacy
                }
            ).Build(),
            Label(
                ui,
                ui.Strings.Get(context.Privacy ? "on": "off"),
                size,
                context.Privacy ? AppTheme.Ink: AppTheme.Orange,
                ""
            )
        }
        let nodeValue = Goo
            .Button{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            BackgroundColor: Color.Transparent,
            Focus: Theme.Read().FocusStyle,
            Disabled: context.Busy,
            Accessibility: Accessibility{Role: AccessibilityRole.Link, Name: ui.Strings.Get("Node settings")},
            OnClick: input.OnNodeSettings,
            Label(ui, ui.Strings.Get("local"), size, AppTheme.Ink, "")
        }
        WidgetKeyBindings.BindActivation(nodeValue)
        let peers = input.Peers
        let outputsValue = if auditing {
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space10,
                Cell.Mount[SpinnerInput, Spinner](
                    "audit",
                    SpinnerInput{Size: 18, StrokeWidth: AppTheme.Stroke2, Color: AppTheme.Lime}
                ),
                Label(ui, ui.Strings.Get("checking"), size, AppTheme.Ink, "")
            }
        } else if stale > 0 {
            Label(ui, String.Format(ui.Strings.Get("{0} stale"), stale), size, AppTheme.Orange, "")
        } else {
            Number(context, "outputs", "outputs", Count(report?.Total ?? input.Outputs), AppTheme.Ink, size)
        }
        let outputsFoot = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            FlexGrow: 1
        }
        outputsFoot.Add(Container{FlexGrow: 1})
        if !auditing {
            outputsFoot.Add(
                if stale > 0 {
                    Small(
                        context,
                        "View",
                        true,
                        () -> {
                            input.State.Tab = "health"
                            input.OnNavigate(AppPage.Tools)
                        }
                    )
                } else {
                    Small(context, "Audit", false, () -> Audit(input))
                }
            )
        }
        let fileValue = if fileMode == nil {
            Label(ui, "—", size, AppTheme.Dim, "")
        } else {
            Label(
                ui,
                ui.Strings.Get(exposed ? "others can read": "owner only"),
                size,
                exposed ? AppTheme.Orange: AppTheme.Ink,
                ""
            )
        }
        let fileFoot = if exposed {
            Small(context, "Fix", true, () -> RestrictFile(input))
        } else {
            Container{}
        }
        let tiles = []Blob{
            Tile(
                input,
                "phrase",
                "key",
                "recovery phrase",
                phraseValue,
                phraseFoot,
                []string{
                    "Checks that your paper copy matches this wallet",
                    "Asks for 3 words. Nothing leaves this computer"
                }
            ),
            Tile(
                input,
                "lock",
                "lock",
                "auto-lock",
                lockValue,
                Container{},
                []string{"Locks the wallet after this much idle time", "Shorter is safer"}
            ),
            Tile(
                input,
                "amounts",
                context.Privacy ? "visibility_off": "visibility",
                "hide amounts",
                amountsValue,
                Container{},
                []string{"Hides amounts and addresses on screen"}
            ),
            Tile(
                input,
                "node",
                "dns",
                "node",
                nodeValue,
                Container{},
                []string{"This wallet uses a node on this computer"}
            ),
            Tile(
                input,
                "relay",
                "share",
                "send relay",
                Number(
                    context,
                    "peers",
                    "send relay",
                    Count(peers) + " " + ui.Strings.Get(peers == 1 ? "peer": "peers"),
                    peers == 0 ? AppTheme.Orange: AppTheme.Ink,
                    size
                ),
                Container{},
                []string{"Your sends travel through Dandelion before they spread", "With 0 peers, sends wait"}
            ),
            Tile(
                input,
                "outputs",
                "grid_view",
                "outputs",
                outputsValue,
                outputsFoot,
                []string{"Coins this wallet owns, spent or not", "Audit checks them against the main chain"}
            ),
            Tile(
                input,
                "memo",
                "notes",
                "memo errors",
                Number(context, "memos", "memo errors", Count(memos), memos > 0 ? AppTheme.Orange: AppTheme.Ink, size),
                if memos > 0 {
                    Small(context, "View", false, () -> input.OnNavigate(AppPage.Transactions))
                } else {
                    Container{}
                },
                []string{"Memos the node could not decrypt", "The coins are not affected"}
            ),
            Tile(
                input,
                "file",
                "description",
                "wallet file",
                fileValue,
                fileFoot,
                []string{"Only your user account should read the wallet file"}
            )
        }
        let score = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: AppTheme.Space4}
        for warning in warnings {
            score.Add(
                Container{
                    Width: 12,
                    Height: 6,
                    BorderRadius: AppTheme.Radius2,
                    BackgroundColor: warning ? AppTheme.Orange: AppTheme.Lime
                }
            )
        }
        let passed = warnings.Count((warning bool) -> !warning)
        let card = WalletParts.PageCard(context.Ui, input.Width, input.Height)
        card.Add(
            WalletParts.Header(
                Label(ui, ui.Strings.Get("privacy"), AppTheme.Type17, AppTheme.Ink, ""),
                AppTheme.Space8,
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space10,
                    Accessibility: Accessibility{Name: ui.Strings.Get("privacy") + " " + passed.ToString() + "/8"},
                    score,
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Baseline,
                        Label(ui, passed.ToString(), AppTheme.Type20, AppTheme.Lime, ""),
                        Label(ui, "/8", AppTheme.Type13, AppTheme.Dim, "")
                    }
                }
            )
        )
        let gap = compact ? AppTheme.Space8: AppTheme.Space12
        if auditIssue.Length > 0 {
            card.Add(MessageParts.Problem(ui, auditIssue))
        }
        let grid = Container{Gap: gap}
        for row in 0 ... 2 {
            let line = Container{FlexDirection: FlexDirection.Row, Gap: gap}
            for column in 0 ... 4 {
                line.Add(tiles[row * 4 + column])
            }
            grid.Add(line)
        }
        card.Add(grid)
        return card
    }

    private func Tile(
        input ToolsInput,
        key string,
        icon string,
        label string,
        value Blob,
        foot Blob,
        lines[]string
    ) Blob {
        let ui = input.Region.Ui
        let compact = input.Region.Compact
        let top = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            Height: 20
        }
        if !compact {
            top.Add(MaterialIcons.Create(icon, AppTheme.Icon16, AppTheme.Body))
        }
        top.Add(Grow(Label(ui, ui.Strings.Get(label), AppTheme.Type12, AppTheme.Body, "")))
        top.Add(Info(input.Region, "info-" + key, label, lines))
        return Container{
            BasedOn: AppTheme.TileStyle,
            BackdropBlur: AppTheme.Space0,
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Padding: compact ? AppTheme.Space12: AppTheme.Space14,
            Gap: compact ? AppTheme.Space8: AppTheme.Space10,
            BorderColor: AppTheme.Rule,
            BackgroundColor: AppTheme.Raised,
            Hover: Style{BorderColor: AppTheme.StrongRule, BackgroundColor: AppTheme.FaintRule},
            top,
            Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, MinHeight: 30, value},
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.FlexStart,
                foot
            }
        }
    }

    private func Audit(input ToolsInput) {
        if auditing {
            return
        }
        guard let window = input.Region.Ui.Actions.window else {
            return
        }
        let session = input.Region.Session
        let identity = input.Region.Identity
        let run = generation
        auditing = true
        auditIssue = ""
        let token = lifetime.Token
        let publish Action[OutputReport?, string] = (report, error) -> {
            if run == generation && identity == ReadWalletIdentity(session) {
                input.State.Report = report
                auditing = false
                auditIssue = error
                Rebuild()
            }
        }
        go AuditOutputs(session, window, token, publish)
    }

    private func RestrictFile(input ToolsInput) {
        let session = input.Region.Session
        let run = generation
        var mode UnixFileMode?
        let actions = input.Region.Ui.Actions
        actions.Run(
            ct -> {
                mode = session.Checks.RestrictWalletFile()
                return Task.CompletedTask
            },
            () -> {
                if run == generation && input.Region.Identity == ReadWalletIdentity(session) {
                    fileMode = mode
                    Rebuild()
                }
            }
        )
    }
}

class ToolsLockRegion : Cell[ToolsLockInput] {
    private var editing bool

    protected override func Build(input ToolsLockInput) Blob {
        let context = input.Region
        let ui = context.Ui
        let value = Goo
            .Button{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            BackgroundColor: Color.Transparent,
            Focus: Theme.Read().FocusStyle,
            Disabled: context.Busy,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get("auto-lock") + " " + LockText(input),
                Expanded: editing
            },
            OnClick: () -> editing = !editing,
            Arc(LockShare(input.AutoLock), context.Compact ? 20.0: 26.0),
            Label(
                ui,
                LockText(input),
                context.Compact ? AppTheme.Type16: AppTheme.Type20,
                input.AutoLock == 0 ? AppTheme.Orange: AppTheme.Ink,
                ""
            )
        }
        WidgetKeyBindings.BindActivation(value)
        let root = Container{
            Gap: AppTheme.Space8,
            OnKeyDown: (event KeyEvent) -> {
                if editing && event.Key == Key.Escape {
                    editing = false
                    event.PreventDefault()
                }
            },
            value
        }
        if editing {
            let chosen Action[string] = value -> {
                editing = false
                Rebuild()
                let minutes = Int32.Parse(value)
                if minutes != input.AutoLock {
                    ui.Actions.Run(ct -> context.Session.SaveAutoLockAsync(minutes, ct))
                }
            }
            root.Add(
                Segment(
                    ui,
                    "auto-lock",
                    []string{"5", "15"},
                    []string{"5m", "15m"},
                    input.AutoLock.ToString(),
                    context.Busy,
                    chosen,
                    key: "auto-lock-minutes"
                )
            )
            root.Add(
                Segment(
                    ui,
                    "auto-lock",
                    []string{"60", "0"},
                    []string{"1h", "never"},
                    input.AutoLock.ToString(),
                    context.Busy,
                    chosen,
                    key: "auto-lock-hours"
                )
            )
        }
        return root
    }

    private func LockShare(minutes int32) float64 -> if minutes == 0 {
        0.0
    } else {
        Math.Clamp(1 - 0.85 * Math.Log(minutes / 5.0) / Math.Log(12), 0.1, 1)
    }

    private func LockText(input ToolsLockInput) string -> if input.AutoLock == 0 {
        input.Region.Ui.Strings.Get("never")
    } else {
        input.AutoLock.ToString() + " " + input.Region.Ui.Strings.Get("min")
    }
}

class ToolsPhraseRegion : Cell[ToolsPhraseInput], IDisposable {
    private var step string = "show"
    private var password string = ""
    private var asked[]int32 = []int32{}
    private var answers[]string = []string{}
    private var words int32
    private var found int32
    private var typed string = ""
    private var suggestions List[string] = List[string]()
    private var wrong bool
    private var checkedAt DateTime?
    private var busy bool
    private var issue string = ""
    private var generation int32
    private var current ToolsPhraseInput
    private let suggestionKey Func[string, string] = (word string) -> word
    private let suggestionRow Func[string, Blob]
    private let lifetime CancellationTokenSource = CancellationTokenSource()

    init() {
        suggestionRow = word -> ControlParts.Button(
            current.Region.Ui,
            word,
            () -> Answer(current, word),
            false,
            suggestions.Count > 0 && word == suggestions[0]
        )
    }

    private func Reveal(input ToolsRegionInput) {
        guard let window = input.Ui.Actions.window else {
            return
        }
        let secret = password.ToCharArray()
        let session = input.Session
        let identity = input.Identity
        generation++
        let run = generation
        busy = true
        password = ""
        issue = ""
        Rebuild()
        let token = lifetime.Token
        go ReadPhrase(session, window, secret, identity, run, token)
    }

    private async func ReadPhrase(
        session WalletSession,
        window Window,
        secret[]char,
        identity string,
        run int32,
        token CancellationToken
    ) {
        using let linked = CancellationTokenSource.CreateLinkedTokenSource(token, window.Closed)
        var phrase[]char = []char{}
        try {
            phrase = await session.Keys.PhraseAsync(secret, linked.Token)
            let completed = TaskCompletionSource[bool](TaskCreationOptions.RunContinuationsAsynchronously)
            if window.TryPost(
                () -> {
                    try {
                        if run == generation && identity == ReadWalletIdentity(session) {
                            Ask(phrase)
                            busy = false
                            Rebuild()
                        }
                    } finally {
                        completed.TrySetResult(true)
                    }
                }
            ) {
                await completed.Task.WaitAsync(linked.Token)
            }
        } catch (failure OperationCanceledException) { } catch (failure Exception) {
            let message = failure.Message
            window.TryPost(
                () -> {
                    if run == generation && identity == ReadWalletIdentity(session) {
                        busy = false
                        issue = message
                        Rebuild()
                    }
                }
            )
        } finally {
            Array.Clear(secret)
            Array.Clear(phrase)
        }
    }

    private func Ask(phrase[]char) {
        let starts = List[int32]()
        for index in 0 ... phrase.Length {
            if phrase[index] != ' ' && (index == 0 || phrase[index - 1] == ' ') {
                starts.Add(index)
            }
        }
        words = starts.Count
        let order = Enumerable.Range(0, words).ToArray()
        Random.Shared.Shuffle(order)
        asked = order.Take(3).Order().ToArray()
        answers = asked.Select(
            (position int32) -> {
                var end = starts[position]
                while end < phrase.Length && phrase[end] != ' ' {
                    end++
                }
                return String(phrase, starts[position], end - starts[position])
            }
        )
            .ToArray()
        Array.Clear(phrase)
        found = 0
        SetTyped("")
        wrong = false
        step = "check"
    }

    private func SetTyped(value string) {
        if value == typed {
            return
        }
        typed = value
        suggestions = if value.Length == 0 {
            List[string]()
        } else {
            Bip39Wordlist
                .Words
                .Where((word string) -> word.StartsWith(value, StringComparison.Ordinal))
                .Take(5)
                .ToList()
        }
    }

    private func Answer(input ToolsPhraseInput, word string) {
        if found >= answers.Length {
            return
        }
        if word != answers[found] {
            SetTyped(word)
            wrong = true
            Rebuild()
            return
        }
        found++
        SetTyped("")
        wrong = false
        Rebuild()
        if found == answers.Length {
            step = "done"
            MarkChecked(input)
        }
    }

    private func MarkChecked(input ToolsPhraseInput) {
        let session = input.Region.Session
        let identity = input.Region.Identity
        let run = generation
        var date DateTime?
        let actions = input.Region.Ui.Actions
        actions.Run(
            async (ct) -> {
                date = await session.Checks.MarkPhraseCheckedAsync()
            },
            () -> {
                if identity == ReadWalletIdentity(session) {
                    input.OnChecked(date)
                    if run == generation {
                        checkedAt = date
                        Rebuild()
                    }
                }
            }
        )
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        lifetime.Dispose()
        password = ""
        typed = ""
        Array.Clear(answers)
    }

    protected override func Build(request ToolsPhraseInput) Blob {
        current = request
        let input = request.Region
        let ui = input.Ui
        let phraseForm = if step == "show" {
            WalletForm(ui, !input.Busy && !busy, () -> Reveal(input), []string{password}, () -> Rebuild())
        } else {
            WalletForm(
                ui,
                suggestions.Count > 0,
                () -> Answer(request, suggestions[0]),
                []string{typed},
                () -> Rebuild()
            )
        }
        let compact = input.Compact
        let card = WalletParts.PageCard(input.Ui, request.Width, request.Height)
        let stepper = Stepper{
            AccessibilityName: ui.Strings.Get("recovery phrase"),
            Labels: []string{ui.Strings.Get("show"), ui.Strings.Get("check"), ui.Strings.Get("done")},
            CurrentIndex: step == "show" ? 0: step == "check" ? 1: 2,
            Width: 300
        }.Build()
        card.Add(
            WalletParts.Header(
                Label(ui, ui.Strings.Get("recovery phrase"), AppTheme.Type17, AppTheme.Ink, ""),
                AppTheme.Space8,
                stepper
            )
        )
        let progress = Container{FlexDirection: FlexDirection.Row, Gap: AppTheme.Space4}
        for index in 0 ... 3 {
            progress.Add(
                Container{
                    Width: 18,
                    Height: 4,
                    BorderRadius: AppTheme.Radius2,
                    BackgroundColor: index < found ? AppTheme.Lime: AppTheme.Edge
                }
            )
        }
        let footer = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            FlexShrink: 0
        }
        if step != "done" {
            footer.Add(Button(ui, "Back", request.OnClose))
        }
        footer.Add(Container{FlexGrow: 1})
        if step == "show" {
            card.Add(
                phraseForm.Field(
                    "Password",
                    password,
                    value -> {
                        password = value
                    },
                    true,
                    disabled: busy
                )
            )
            if issue.Length > 0 {
                card.Add(MessageParts.Problem(ui, issue))
            }
            footer.Add(ControlParts.Button(ui, "Continue", phraseForm.Submit, !phraseForm.CanSubmit, true, busy: busy))
            card.Add(footer)
            return card
        }
        let gap = compact ? AppTheme.Space8: AppTheme.Space10
        let height = compact ? 40.0: 46.0
        let grid = SegmentGrid(words / 4, 4, index -> Slot(input, index, phraseForm), gap, gap, height, height)
        grid.FlexGrow = 0
        grid.FlexShrink = 0
        card.Add(grid)
        let pick = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            FlexWrap: FlexWrap.Wrap,
            Gap: AppTheme.Space10,
            MinHeight: 50,
            Padding: Edges{Top: AppTheme.Space14},
            BorderWidth: Edges{Top: AppTheme.Border1},
            BorderColor: AppTheme.Rule,
            FlexShrink: 0
        }
        if step == "done" {
            pick.Gap = AppTheme.Space14
            pick.Add(MaterialIcons.Create("check", AppTheme.Icon22, AppTheme.Lime))
            pick.Add(Label(ui, ui.Strings.Get("phrase checked"), AppTheme.Type18, AppTheme.Lime, ""))
            if let date = checkedAt {
                pick.Add(Note(input, Day(input, date, true)))
            }
        } else if wrong {
            let number = (asked[found] + 1).ToString()
            pick.Add(MessageParts.Problem(ui, String.Format(ui.Strings.Get("That is not word {0}."), number)))
        } else if typed.Length > 0 && suggestions.Count == 0 {
            pick.Add(MessageParts.Problem(ui, String.Format(ui.Strings.Get("No word starts with “{0}”."), typed)))
        } else {
            pick.Add(
                Label(
                    ui,
                    String.Format(ui.Strings.Get("word {0}"), (asked[found] + 1).ToString()),
                    AppTheme.Type12,
                    AppTheme.Lime,
                    ""
                )
            )
            let list = VirtualItems[string](
                suggestions,
                AppTheme.ControlRegular * 3,
                AppTheme.ControlRegular,
                suggestionKey,
                suggestionRow
            )
            list.Height = AppTheme.ControlRegular
            list.MinHeight = 0
            list.FlexGrow = 1
            pick.Add(list)
        }
        card.Add(pick)
        footer.Add(progress)
        footer.Add(
            if step == "done" {
                Button(ui, "Done", request.OnClose, false, true)
            } else {
                Button(ui, "Continue", phraseForm.Submit, !phraseForm.CanSubmit)
            }
        )
        if issue.Length > 0 {
            card.Add(MessageParts.Problem(ui, issue))
        }
        card.Add(footer)
        return card
    }

    private func Slot(input ToolsRegionInput, index int32, phraseForm WalletForm) Blob {
        let ui = input.Ui
        let compact = input.Compact
        let position = Array.IndexOf(asked, index)
        let solved = position >= 0 && (position < found || step == "done")
        let active = step == "check" && position == found
        let invalid = active && (wrong || typed.Length > 0 && suggestions.Count == 0)
        let slot = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Height: compact ? 40.0: 46.0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            Padding: Edges{
                Left: compact ? AppTheme.Space10: AppTheme.Space12,
                Right: compact ? AppTheme.Space10: AppTheme.Space12
            },
            BorderWidth: AppTheme.Border1,
            BorderRadius: AppTheme.Radius8,
            BorderColor: if invalid {
                AppTheme.Pink
            } else if active {
                AppTheme.Lime
            } else if position > found {
                AppTheme.Edge
            } else {
                AppTheme.Rule
            },
            BackgroundColor: AppTheme.Raised,
            BoxShadows: if invalid {
                []BoxShadow{BoxShadow{Spread: 3, Color: AppTheme.PinkQuiet}}
            } else if active {
                []BoxShadow{BoxShadow{Spread: 3, Color: AppTheme.LimeQuiet}}
            } else {
                []BoxShadow{}
            },
            Container{Width: 18, FlexShrink: 0, Label(ui, (index + 1).ToString(), AppTheme.Type12, AppTheme.Dim, "")}
        }
        let size = AppTheme.Type14
        if solved {
            slot.Add(Grow(Label(ui, answers[position], size, AppTheme.Lime, "")))
            slot.Add(MaterialIcons.Create("check", AppTheme.Icon16, AppTheme.Lime))
        } else if active {
            slot.Add(
                Grow(
                    Container{
                        MinWidth: 0,
                        phraseForm.Field(
                            String.Format(ui.Strings.Get("word {0}"), (index + 1).ToString()),
                            typed,
                            value -> {
                                SetTyped(value.Trim().ToLowerInvariant())
                                wrong = false
                            },
                            labelled: false,
                            invalid: invalid
                        )
                    }
                )
            )
        } else if position < 0 {
            slot.Add(Label(ui, "••••••••", size, AppTheme.Dim, ""))
        }
        return slot
    }
}

class ToolsSignRegion : Cell[ToolsRegionInput], IDisposable {
    private var busy bool
    private var issue string = ""
    private var generation int32
    private let lifetime CancellationTokenSource = CancellationTokenSource()

    protected override func Build(input ToolsRegionInput) Blob {
        let form = WalletForm(
            input.Ui,
            !busy && !input.Busy,
            () -> Sign(input),
            []string{input.State.SignMessage},
            () -> {
                generation++
                busy = false
                issue = ""
                Rebuild()
            }
        )
        let root = Container{
            Gap: AppTheme.Space16,
            form.Field(
                "Message",
                input.State.SignMessage,
                value -> {
                    input.State.SignMessage = value
                    input.State.SignSignature = ""
                }
            )
        }
        if input.State.SignSignature.Length > 0 {
            root.Add(Copyable(input.Ui, "Signature", input.State.SignSignature, Grouped(input.State.SignSignature)))
        }
        if issue.Length > 0 {
            root.Add(MessageParts.Problem(input.Ui, issue))
        }
        root.Add(
            ActionRow([]Blob{ControlParts.Button(input.Ui, "Sign", form.Submit, !form.CanSubmit, true, busy: busy)})
        )
        return root
    }

    private func Sign(input ToolsRegionInput) {
        guard let window = input.Ui.Actions.window else {
            return
        }
        busy = true
        issue = ""
        generation++
        Rebuild()
        let state = input.State
        let session = input.Session
        let message = state.SignMessage
        let identity = input.Identity
        let run = generation
        let token = lifetime.Token
        go SignMessage(state, session, window, message, identity, run, token)
    }

    private async func SignMessage(
        state ToolsState,
        session WalletSession,
        window Window,
        message string,
        identity string,
        run int32,
        token CancellationToken
    ) {
        using let linked = CancellationTokenSource.CreateLinkedTokenSource(token, window.Closed)
        var value = ""
        var error = ""
        try {
            value = await session.Proofs.SignAsync(message, linked.Token)
        } catch (failure OperationCanceledException) {
            return
        } catch (failure Exception) {
            error = failure.Message
        }
        window.TryPost(
            () -> {
                if run == generation && identity == ReadWalletIdentity(session) {
                    busy = false
                    state.SignSignature = value
                    issue = error
                    Rebuild()
                }
            }
        )
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        lifetime.Dispose()
    }
}

class ToolsVerifyRegion : Cell[ToolsRegionInput], IDisposable {
    private var verdict bool?
    private var busy bool
    private var issue string = ""
    private var generation int32
    private let lifetime CancellationTokenSource = CancellationTokenSource()

    protected override func Build(input ToolsRegionInput) Blob {
        let form = WalletForm(
            input.Ui,
            !busy && !input.Busy,
            () -> Verify(input),
            []string{input.State.VerifyAddress, input.State.VerifyMessage, input.State.VerifySignature},
            () -> {
                generation++
                busy = false
                issue = ""
                verdict = nil
                Rebuild()
            }
        )
        let root = Container{
            Gap: AppTheme.Space16,
            form.Field(
                "Address",
                input.State.VerifyAddress,
                value -> input.State.VerifyAddress = value.Trim(),
                secret: input.Privacy
            ),
            form.Field("Message", input.State.VerifyMessage, value -> input.State.VerifyMessage = value),
            form.Field("Signature", input.State.VerifySignature, value -> input.State.VerifySignature = value.Trim()),
            ActionRow(
                []Blob{
                    Verdict(input, verdict),
                    ControlParts.Button(input.Ui, "Verify", form.Submit, !form.CanSubmit, true, busy: busy)
                }
            )
        }
        if issue.Length > 0 {
            root.Add(MessageParts.Problem(input.Ui, issue))
        }
        return root
    }

    private func Verify(input ToolsRegionInput) {
        guard let window = input.Ui.Actions.window else {
            return
        }
        busy = true
        verdict = nil
        issue = ""
        generation++
        Rebuild()
        let session = input.Session
        let signer = input.State.VerifyAddress
        let message = input.State.VerifyMessage
        let signature = input.State.VerifySignature
        let identity = input.Identity
        let run = generation
        let token = lifetime.Token
        go VerifyMessage(session, window, signer, message, signature, identity, run, token)
    }

    private async func VerifyMessage(
        session WalletSession,
        window Window,
        signer string,
        message string,
        signature string,
        identity string,
        run int32,
        token CancellationToken
    ) {
        using let linked = CancellationTokenSource.CreateLinkedTokenSource(token, window.Closed)
        var value = false
        var error = ""
        try {
            value = await session.Proofs.VerifyAsync(signer, message, signature, linked.Token)
        } catch (failure OperationCanceledException) {
            return
        } catch (failure Exception) {
            error = failure.Message
        }
        window.TryPost(
            () -> {
                if run == generation && identity == ReadWalletIdentity(session) {
                    busy = false
                    verdict = error.Length == 0 ? value: nil
                    issue = error
                    Rebuild()
                }
            }
        )
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        lifetime.Dispose()
    }
}

class ToolsProofRegion : Cell[ToolsRegionInput], IDisposable {
    private var verdict bool?
    private var busy bool
    private var issue string = ""
    private var generation int32
    private let lifetime CancellationTokenSource = CancellationTokenSource()

    protected override func Build(input ToolsRegionInput) Blob {
        let form = WalletForm(
            input.Ui,
            !busy && !input.Busy,
            () -> Verify(input),
            []string{
                input.State.ProofTransaction,
                input.State.ProofKey,
                input.State.ProofAddress,
                input.State.ProofAmount
            },
            () -> {
                generation++
                busy = false
                issue = ""
                verdict = nil
                Rebuild()
            }
        )
        let root = Container{
            Gap: AppTheme.Space16,
            form.Field(
                "Transaction",
                input.State.ProofTransaction,
                value -> input.State.ProofTransaction = value.Trim(),
                secret: input.Privacy
            ),
            form.Field(
                "Proof key",
                input.State.ProofKey,
                value -> input.State.ProofKey = value.Trim(),
                secret: input.Privacy
            ),
            form.Field(
                "Address",
                input.State.ProofAddress,
                value -> input.State.ProofAddress = value.Trim(),
                secret: input.Privacy
            ),
            form.Field(
                "Amount",
                input.State.ProofAmount,
                value -> input.State.ProofAmount = value.Trim(),
                secret: input.Privacy
            ),
            ActionRow(
                []Blob{
                    Verdict(input, verdict),
                    ControlParts.Button(input.Ui, "Verify", form.Submit, !form.CanSubmit, true, busy: busy)
                }
            )
        }
        if issue.Length > 0 {
            root.Add(MessageParts.Problem(input.Ui, issue))
        }
        return root
    }

    private func Verify(input ToolsRegionInput) {
        guard let window = input.Ui.Actions.window else {
            return
        }
        busy = true
        verdict = nil
        issue = ""
        generation++
        Rebuild()
        let session = input.Session
        let transaction = input.State.ProofTransaction
        let proofKey = input.State.ProofKey
        let address = input.State.ProofAddress
        let amount = input.State.ProofAmount
        let identity = input.Identity
        let run = generation
        let token = lifetime.Token
        go VerifyProof(session, window, transaction, proofKey, address, amount, identity, run, token)
    }

    private async func VerifyProof(
        session WalletSession,
        window Window,
        transaction string,
        proofKey string,
        address string,
        amount string,
        identity string,
        run int32,
        token CancellationToken
    ) {
        using let linked = CancellationTokenSource.CreateLinkedTokenSource(token, window.Closed)
        var value = false
        var error = ""
        try {
            value = await session.Proofs.VerifyProofAsync(transaction, proofKey, address, amount, linked.Token)
        } catch (failure OperationCanceledException) {
            return
        } catch (failure Exception) {
            error = failure.Message
        }
        window.TryPost(
            () -> {
                if run == generation && identity == ReadWalletIdentity(session) {
                    busy = false
                    verdict = error.Length == 0 ? value: nil
                    issue = error
                    Rebuild()
                }
            }
        )
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        lifetime.Dispose()
    }
}

class ToolsHealthRegion : Cell, IDisposable {
    private var current ToolsHealthInput
    private var source OutputReport?
    private var rows[]DataGridRow = []DataGridRow{}
    private var columns[]DataGridColumn = []DataGridColumn{}
    private var generation int32
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var auditing bool
    private var auditIssue string = ""

    func Accept(input ToolsHealthInput) {
        if current.Equals(input) && source == input.State.Report {
            return
        }
        let old = current.Region
        let next = input.Region
        current = input
        if old.Language != next.Language {
            let ui = next.Ui
            columns = []DataGridColumn{
                DataGridColumn{Id: "height", Label: ui.Strings.Get("height"), Resizable: false},
                DataGridColumn{Id: "output", Label: ui.Strings.Get("output"), Resizable: false},
                DataGridColumn{Id: "reason", Label: ui.Strings.Get("reason"), Resizable: false},
                DataGridColumn{Id: "amount", Label: ui.Strings.Get("amount"), Resizable: false}
            }
        }
        if source != input.State.Report || old.Privacy != next.Privacy || old.Language != next.Language {
            PrepareRows()
        }
        Rebuild()
    }

    private func PrepareRows() {
        source = current.State.Report
        let ui = current.Region.Ui
        let prepared = List[DataGridRow]()
        if let report = source {
            for output in report.Stale {
                let values = Dictionary[string, string]()
                values.Add("height", Count(output.Height))
                values.Add(
                    "output",
                    output.Output.Substring(0, 4) + "…" + output.Output.Substring(output.Output.Length - 6)
                )
                values.Add("reason", ui.Strings.Get(output.Reason))
                values.Add("amount", Amount(current.Region.Privacy, output.Amount))
                prepared.Add(DataGridRow{Id: output.Output, Values: values})
            }
        }
        rows = prepared.ToArray()
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        lifetime.Dispose()
    }

    override func Build() Blob {
        let view = current
        let input = view.Region
        let card = Container{Gap: AppTheme.Space16, FlexGrow: 1, MinHeight: 0}
        let ui = input.Ui
        let compact = input.Compact
        let report = view.State.Report
        let stale = report?.Stale.Length ?? 0
        let total = report?.Total ?? view.Outputs
        let stats = Container{
            FlexDirection: FlexDirection.Row,
            Gap: compact ? AppTheme.Space8: AppTheme.Space12,
            FlexShrink: 0
        }
        stats.Add(Stat(input, "outputs", Count(total), AppTheme.Ink, false))
        stats.Add(
            Stat(
                input,
                "on main chain",
                if let value = report {
                    Count(value.Total - uint64(stale))
                } else {
                    "—"
                },
                AppTheme.Mint,
                false
            )
        )
        stats.Add(
            Stat(input, "stale", report == nil ? "—": stale.ToString(), stale > 0 ? AppTheme.Orange: AppTheme.Ink, true)
        )
        stats.Add(Stat(input, "duplicates", report == nil ? "—": Count(report.Duplicates), AppTheme.Ink, true))
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                Grow(stats),
                Info(
                    input,
                    "info-health",
                    "health",
                    []string{
                        "Check compares every output with the main chain. It changes nothing",
                        "Stale: its block or transaction left the main chain after a reorg. It was never spendable",
                        "Duplicates: outputs that share one key image. Only one of them can be spent"
                    }
                )
            }
        )
        let values = Container{
            FlexDirection: FlexDirection.Row,
            Gap: compact ? AppTheme.Space8: AppTheme.Space12,
            Padding: Edges{Left: AppTheme.Space14, Right: AppTheme.Space14},
            FlexShrink: 0
        }
        values.Add(
            Reading(
                input,
                "stale amount",
                report == nil ? "—": Amount(ui.Privacy, report.StaleAmount),
                stale > 0 ? AppTheme.Orange: AppTheme.Ink
            )
        )
        values.Add(
            Reading(input, "unspendable", report == nil ? "—": Amount(ui.Privacy, report.Unspendable), AppTheme.Ink)
        )
        values.Add(Reading(input, "synced", report == nil ? "—": Count(report.Synced), AppTheme.Ink))
        values.Add(Reading(input, "checked", report == nil ? "—": report.Checked.ToString("HH:mm"), AppTheme.Ink))
        card.Add(values)
        if report != nil && stale > 0 {
            card.Add(
                ListParts.Viewport(
                    Cell.Mount[DataGridInput, DataGrid](
                        "stale-outputs",
                        DataGridInput{
                            Rows: rows,
                            Columns: columns,
                            Selection: DataGridSelection.None,
                            FitColumnsToViewport: true,
                            Height: Percent(100),
                            AccessibilityName: ui.Strings.Get("stale")
                        }
                    )
                )
            )
        } else {
            let empty = ListParts.Empty(ui, report == nil ? "not checked": "all outputs on the main chain")
            empty.FlexGrow = 0
            card.Add(empty)
        }
        if auditIssue.Length > 0 {
            card.Add(MessageParts.Problem(ui, auditIssue))
        }
        card.Add(ActionRow([]Blob{Button(ui, "Check", () -> Audit(view), input.Busy || auditing)}))
        return card
    }

    private func Stat(input ToolsRegionInput, label string, value string, color Color, info bool) Blob {
        let ui = input.Ui
        let title = WalletParts.Header(Figure(ui, label, value, "", AppTheme.Type20, color, key: "stat-" + label))
        if info {
            title.Add(
                Info(
                    input,
                    "info-" + label,
                    label,
                    []string{
                        if label == "stale" {
                            "Its block or transaction left the main chain after a reorg. It was never spendable"
                        } else {
                            "Outputs that share one key image. Only one of them can be spent"
                        }
                    }
                )
            )
        }
        return Container{
            BasedOn: AppTheme.TileStyle,
            BackdropBlur: AppTheme.Space0,
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Gap: AppTheme.Space6,
            Padding: Edges{
                Left: AppTheme.Space14,
                Right: AppTheme.Space14,
                Top: AppTheme.Space12,
                Bottom: AppTheme.Space12
            },
            BorderColor: AppTheme.Rule,
            BackgroundColor: AppTheme.Raised,
            title,
        }
    }

    private func Reading(input ToolsRegionInput, label string, value string, color Color) Blob ->
    KeyValue(input.Ui, label, value, valueColor: color)

    private func Audit(input ToolsHealthInput) {
        if auditing {
            return
        }
        guard let window = input.Region.Ui.Actions.window else {
            return
        }
        let session = input.Region.Session
        let identity = input.Region.Identity
        let run = generation
        auditing = true
        auditIssue = ""
        let token = lifetime.Token
        let publish Action[OutputReport?, string] = (report, error) -> {
            if run == generation && identity == ReadWalletIdentity(session) {
                let resized = ((input.State.Report?.Stale.Length ?? 0) > 0) != ((report?.Stale.Length ?? 0) > 0)
                input.State.Report = report
                PrepareRows()
                auditing = false
                auditIssue = error
                Rebuild()
                if resized {
                    input.OnReport()
                }
            }
        }
        go AuditOutputs(session, window, token, publish)
    }
}

class ToolsParts {
    shared {
        async func AuditOutputs(
            session WalletSession,
            window Window,
            token CancellationToken,
            publish Action[OutputReport?, string]
        ) {
            using let linked = CancellationTokenSource.CreateLinkedTokenSource(token, window.Closed)
            var report OutputReport?
            var error = ""
            try {
                report = await session.Checks.CheckOutputsAsync(linked.Token)
            } catch (failure OperationCanceledException) {
                return
            } catch (failure Exception) {
                error = failure.Message
            }
            window.TryPost(() -> publish(report, error))
        }

        func ReadWalletIdentity(session WalletSession) string ->
        session.Settings.Network + ":" + session.Settings.ActiveWallet

        func Small(input ToolsRegionInput, label string, primary bool, action Action) Blob ->
        Button(input.Ui, label, action, input.Busy, primary)

        func Info(input ToolsRegionInput, key string, topic string, lines[]string) Blob ->
        Cell.Mount[InfoTipInput, InfoTip](
            key,
            InfoTipInput{
                Ui: input.Ui,
                Topic: input.Ui.Strings.Get(topic) + " " + input.Ui.Strings.Get("info"),
                Lines: lines,
                Language: input.Language,
                Width: 300
            }
        )

        func Arc(fraction float64, size float64) Blob ->
        Ring(fraction, fraction > 0 ? AppTheme.Lime: Color.Transparent, AppTheme.Rule, size, AppTheme.Border3)

        func Number(input ToolsRegionInput, key string, label string, value string, color Color, size float64) Blob ->
        Value(input.Ui, key, input.Ui.Strings.Get(label) + " " + value, value, size, color, color)

        func Note(input ToolsRegionInput, content string) Blob -> Label(
            input.Ui,
            content,
            AppTheme.Type12,
            AppTheme.Dim,
            ""
        )

        func Day(input ToolsRegionInput, date DateTime, year bool) string -> date.ToString(
            if input.Language == "zh-Hans" {
                year ? "yyyy年M月d日": "M月d日"
            } else {
                year ? "d MMM yyyy": "d MMM"
            },
            CultureInfo.InvariantCulture
        )

        func Verdict(input ToolsRegionInput, verdict bool?) Blob {
            let root = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                FlexGrow: 1
            }
            if let valid = verdict {
                let color = valid ? AppTheme.Lime: AppTheme.Pink
                root.Add(MaterialIcons.Create(valid ? "check_circle": "cancel", AppTheme.Icon18, color))
                root.Add(Label(input.Ui, input.Ui.Strings.Get(valid ? "Valid": "Invalid"), AppTheme.Type14, color, ""))
            }
            return root
        }
    }
}
