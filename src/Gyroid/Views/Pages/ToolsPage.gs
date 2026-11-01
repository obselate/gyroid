package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Navigation
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
import System.Threading.Tasks

class ToolsState {
    var Tab string = "sign"
    var Report OutputReport? = nil
    var Audit Task[OutputReport]? = nil
}

data struct ToolsInput {
    var Session WalletSession
    var Ui Presentation
    var State ToolsState
    var Snapshot WalletSnapshot
    var Node NodeStatus
    var Section AppPage
    var AutoLock int32
    var Privacy bool
    var Busy bool
    var Language string
    var Width float64
    var Height float64
    var OnNavigate Action[AppPage]
    var OnPrivacy Action
    var OnNodeSettings Action
}

class ToolsPage : Cell[ToolsInput], IDisposable {
    private var phraseForm WalletForm
    private var message string = ""
    private var signature string = ""
    private var signer string = ""
    private var proofTx string = ""
    private var proofKey string = ""
    private var proofAddress string = ""
    private var proofAmount string = ""
    private var verdict bool?
    private var verdictRun int32
    private var hovered string = ""
    private var editing bool
    private var loaded bool
    private var checkedAt DateTime?
    private var fileMode UnixFileMode?
    private var step string = ""
    private var password string = ""
    private var asked[]int32 = []int32{}
    private var answers[]string = []string{}
    private var words int32
    private var found int32
    private var typed string = ""
    private var wrong bool

    protected override func Build(input ToolsInput) Blob {
        if !loaded {
            loaded = true
            checkedAt = input.Session.Checks.PhraseChecked()
            fileMode = FileMode(input)
        }
        if input.Section != AppPage.Privacy && step.Length > 0 {
            EndPhrase()
        }
        return if input.Section == AppPage.Privacy {
            if step.Length > 0 {
                Phrase(input)
            } else {
                Privacy(input)
            }
        } else {
            Tools(input)
        }
    }

    private func FileMode(input ToolsInput) UnixFileMode? {
        try {
            return input.Session.Checks.WalletFileMode()
        } catch (failure Exception) {
            return nil
        }
    }

    private func Small(input ToolsInput, label string, primary bool, action Action) Blob ->
    Button(
        input.Ui,
        label,
        action,
        input.Busy,
        primary,
        appearance: (primary ? AppTheme.PrimaryButton: AppTheme.Button) with{
            Height = AppTheme.ControlCompact,
            PaddingHorizontal = AppTheme.Space10,
            FontSize = AppTheme.Type12
        }
    )

    private func Info(input ToolsInput, key string, topic string, lines[]string) Blob ->
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

    private func Arc(ui Presentation, fraction float64, size float64) Blob ->
    Ring(fraction, fraction > 0 ? AppTheme.Lime: Color.Transparent, AppTheme.Rule, size, AppTheme.Border3)

    private func Number(input ToolsInput, key string, label string, value string, color Color, size float64) Blob ->
    Value(input.Ui, key, input.Ui.Strings.Get(label) + " " + value, value, size, color, color)

    private func Minutes(input ToolsInput, minutes int32) string -> switch minutes {
        case 0: input.Ui.Strings.Get("never")
        case 60: "1h"
        default: minutes.ToString() + "m"
    }

    private func Privacy(input ToolsInput) Blob {
        let ui = input.Ui
        let compact = input.Width < 1100
        let size = compact ? AppTheme.Type16: AppTheme.Type20
        let balance = input.Snapshot.Balance
        let report = input.State.Report
        let auditing = input.State.Audit?.IsCompleted == false
        let stale = report?.Stale.Length ?? 0
        let shared = UnixFileMode.GroupRead |
        UnixFileMode.GroupWrite |
        UnixFileMode.GroupExecute |
        UnixFileMode.OtherRead |
        UnixFileMode.OtherWrite |
        UnixFileMode.OtherExecute
        let exposed = ((fileMode ?? UnixFileMode.None) & shared) != 0
        let unchecked = !input.Snapshot.ViewOnly && checkedAt == nil
        let memos = balance?.MemoErrors ?? uint64(0)
        let warnings = []bool{
            unchecked,
            input.AutoLock == 0,
            !input.Privacy,
            false,
            input.Node.Peers == 0,
            stale > 0,
            memos > 0,
            exposed
        }
        let phraseValue = if input.Snapshot.ViewOnly {
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
            Small(input, "Check", true, () -> StartPhrase())
        } else if let date = checkedAt {
            Note(input, Day(input, date, false))
        } else {
            Container{}
        }
        let lockValue = Goo
            .Button{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            BackgroundColor: Color.Transparent,
            Focus: Theme.Read().FocusStyle,
            Disabled: input.Busy,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get("auto-lock") + " " + LockText(input)
            },
            OnClick: () -> {
                editing = !editing
                Rebuild()
            },
            Arc(ui, LockShare(input.AutoLock), compact ? 20.0: 26.0),
            Label(ui, LockText(input), size, input.AutoLock == 0 ? AppTheme.Orange: AppTheme.Ink, "")
        }
        WidgetKeyBindings.BindActivation(lockValue)
        if hovered == "lock" && !editing {
            lockValue.Add(MaterialIcons.Create("expand_more", AppTheme.Icon16, AppTheme.Ink))
        }
        let amountsValue = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            (
                AppTheme.Switch with{
                    Checked = input.Privacy,
                    AccessibilityName = ui.Strings.Get("hide amounts"),
                    OnClick = input.OnPrivacy
                }
            ).Build(),
            Label(
                ui,
                ui.Strings.Get(input.Privacy ? "on": "off"),
                size,
                input.Privacy ? AppTheme.Ink: AppTheme.Orange,
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
            Disabled: input.Busy,
            Accessibility: Accessibility{Role: AccessibilityRole.Link, Name: ui.Strings.Get("Node settings")},
            OnClick: input.OnNodeSettings,
            Label(ui, ui.Strings.Get("local"), size, AppTheme.Ink, "")
        }
        WidgetKeyBindings.BindActivation(nodeValue)
        if hovered == "node" {
            nodeValue.Add(MaterialIcons.Create("north_east", AppTheme.Icon16, AppTheme.Ink))
        }
        let peers = input.Node.Peers
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
            Number(
                input,
                "outputs",
                "outputs",
                Count(report?.Total ?? balance?.Outputs ?? uint64(0)),
                AppTheme.Ink,
                size
            )
        }
        let outputsFoot = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            FlexGrow: 1
        }
        if let value = report {
            outputsFoot.Add(Note(input, ui.Strings.Get("checked") + " " + value.Checked.ToString("HH:mm")))
        }
        outputsFoot.Add(Container{FlexGrow: 1})
        if !auditing {
            outputsFoot.Add(
                if stale > 0 {
                    Small(
                        input,
                        "View",
                        true,
                        () -> {
                            input.State.Tab = "health"
                            input.OnNavigate(AppPage.Tools)
                        }
                    )
                } else {
                    Small(input, "Audit", false, () -> Audit(input))
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
            Small(input, "Fix", true, () -> RestrictFile(input))
        } else if let mode = fileMode {
            Note(input, "0" + Convert.ToString(int32(mode), 8))
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
                if editing {
                    LockChoices(input)
                } else {
                    Container{}
                },
                []string{"Locks the wallet after this much idle time", "Shorter is safer"}
            ),
            Tile(
                input,
                "amounts",
                input.Privacy ? "visibility_off": "visibility",
                "hide amounts",
                amountsValue,
                if input.Privacy {
                    Container{}
                } else {
                    Note(input, ui.Strings.Get("amounts visible"))
                },
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
                    input,
                    "peers",
                    "send relay",
                    Count(peers) + " " + ui.Strings.Get(peers == 1 ? "peer": "peers"),
                    peers == 0 ? AppTheme.Orange: AppTheme.Ink,
                    size
                ),
                Note(input, peers == 0 ? ui.Strings.Get("sends wait"): "Dandelion"),
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
                Number(input, "memos", "memo errors", Count(memos), memos > 0 ? AppTheme.Orange: AppTheme.Ink, size),
                if memos > 0 {
                    Small(input, "View", false, () -> input.OnNavigate(AppPage.Transactions))
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
        let card = WalletParts.PageCard(input.Ui, input.Width, input.Height)
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
        let height = compact ? 124.0: Math.Clamp(input.Height * 0.19, 136, 210)
        let grid = SegmentGrid(2, 4, index -> tiles[index], gap, gap, height, height)
        grid.FlexGrow = 0
        grid.FlexShrink = 0
        card.Add(grid)
        return card
    }

    private func Note(input ToolsInput, content string) Blob -> Label(
        input.Ui,
        content,
        AppTheme.Type12,
        AppTheme.Dim,
        ""
    )

    private func Tile(
        input ToolsInput,
        key string,
        icon string,
        label string,
        value Blob,
        foot Blob,
        lines[]string
    ) Blob {
        let ui = input.Ui
        let compact = input.Width < 1100
        let edit = key == "lock" && editing
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
        top.Add(Info(input, "info-" + key, label, lines))
        return Container{
            BasedOn: AppTheme.TileStyle,
            BackdropBlur: AppTheme.Space0,
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: if compact {
                124.0
            } else {
                Math.Clamp(input.Height * 0.19, 136, 210)
            },
            Padding: compact ? AppTheme.Space12: AppTheme.Space14,
            Gap: compact ? AppTheme.Space8: AppTheme.Space10,
            BorderColor: if edit {
                AppTheme.Lime
            } else if hovered == key {
                AppTheme.StrongRule
            } else {
                AppTheme.Rule
            },
            BackgroundColor: hovered == key && !edit ? AppTheme.FaintRule: AppTheme.Raised,
            BoxShadows: if edit {
                []BoxShadow{BoxShadow{Spread: 3, Color: AppTheme.LimeQuiet}}
            } else {
                []BoxShadow{}
            },
            OnPointerEnter: (event PointerEvent) -> {
                hovered = key
                Rebuild()
            },
            OnPointerLeave: (event PointerEvent) -> {
                if hovered == key {
                    hovered = ""
                    Rebuild()
                }
            },
            top,
            Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, MinHeight: 30, value},
            Container{FlexGrow: 1},
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: edit ? JustifyContent.Center: JustifyContent.FlexStart,
                MinHeight: 28,
                foot
            }
        }
    }

    private func LockShare(minutes int32) float64 -> if minutes == 0 {
        0.0
    } else {
        Math.Clamp(1 - 0.85 * Math.Log(minutes / 5.0) / Math.Log(12), 0.1, 1)
    }

    private func LockText(input ToolsInput) string -> if input.AutoLock == 0 {
        input.Ui.Strings.Get("never")
    } else {
        input.AutoLock.ToString() + " " + input.Ui.Strings.Get("min")
    }

    private func LockChoices(input ToolsInput) Blob -> Segment(
        input.Ui,
        "auto-lock",
        []string{"5", "15", "60", "0"},
        []string{Minutes(input, 5), Minutes(input, 15), Minutes(input, 60), Minutes(input, 0)},
        input.AutoLock.ToString(),
        input.Busy,
        value -> {
            editing = false
            let minutes = Int32.Parse(value)
            if minutes != input.AutoLock {
                input.Ui.Actions.Run(ct -> input.Session.SaveAutoLockAsync(minutes, ct))
            }
        }
    )

    private func Audit(input ToolsInput) {
        if input.State.Audit?.IsCompleted == false {
            return
        }
        var task Task[OutputReport]
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                task = input.Session.Checks.CheckOutputsAsync(ct)
                input.State.Audit = task
                return task
            },
            () -> {
                input.State.Report = task.Result
            }
        )
    }

    private func RestrictFile(input ToolsInput) {
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                input.Session.Checks.RestrictWalletFile()
                return Task.CompletedTask
            },
            () -> {
                fileMode = FileMode(input)
            }
        )
    }

    private func StartPhrase() {
        step = "show"
        password = ""
        Rebuild()
    }

    private func EndPhrase() {
        step = ""
        password = ""
        typed = ""
        wrong = false
        found = 0
        asked = []int32{}
        Array.Clear(answers)
        answers = []string{}
        Rebuild()
    }

    private func Reveal(input ToolsInput) {
        if password.Length == 0 || input.Busy {
            return
        }
        let secret = password.ToCharArray()
        var task Task[[]char]
        password = ""
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                task = input.Session.Keys.PhraseAsync(secret, ct)
                return task
            },
            () -> {
                if input.Session.State == WalletState.Unlocked && step == "show" {
                    Ask(task.Result)
                } else {
                    Array.Clear(task.Result)
                }
            }
        )
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
        typed = ""
        wrong = false
        step = "check"
    }

    private func Suggestions() List[string] -> if typed.Length == 0 {
        List[string]()
    } else {
        Bip39Wordlist.Words.Where((word string) -> word.StartsWith(typed, StringComparison.Ordinal)).Take(5).ToList()
    }

    private func Answer(input ToolsInput, word string) {
        if found >= answers.Length || !Bip39Wordlist.Words.Contains(word) {
            return
        }
        if word != answers[found] {
            typed = word
            wrong = true
            Rebuild()
            return
        }
        found++
        typed = ""
        wrong = false
        if found == answers.Length {
            step = "done"
            input
                .Ui
                .Actions
                .Run(
                ct -> input.Session.Checks.MarkPhraseCheckedAsync(),
                () -> {
                    checkedAt = input.Session.Checks.PhraseChecked()
                }
            )
        }
        Rebuild()
    }

    func Dispose() {
        step = ""
        password = ""
        typed = ""
        Array.Clear(answers)
    }

    private func Phrase(input ToolsInput) Blob {
        let ui = input.Ui
        phraseForm = if step == "show" {
            WalletForm(ui, !input.Busy, () -> Reveal(input), []string{password})
        } else {
            WalletForm(ui, Suggestions().Count > 0, () -> Answer(input, Suggestions()[0]), []string{typed})
        }
        let compact = input.Width < 1100
        let card = WalletParts.PageCard(input.Ui, input.Width, input.Height)
        let stepper = Stepper{
            AccessibilityName: ui.Strings.Get("recovery phrase"),
            Labels: []string{ui.Strings.Get("show"), ui.Strings.Get("check"), ui.Strings.Get("done")},
            CurrentIndex: step == "show" ? 0: step == "check" ? 1: 2,
            FontSize: AppTheme.Type12,
            Height: AppTheme.ControlCompact,
            Gap: AppTheme.Space8
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
            footer.Add(Button(ui, "Back", () -> EndPhrase()))
        }
        footer.Add(Container{FlexGrow: 1})
        if step == "show" {
            card.Add(
                phraseForm.Field(
                    "Password",
                    password,
                    value -> {
                        password = value
                        Rebuild()
                    },
                    true
                )
            )
            footer.Add(Button(ui, "Continue", phraseForm.Submit, !phraseForm.CanSubmit, true))
            card.Add(footer)
            return card
        }
        let gap = compact ? AppTheme.Space8: AppTheme.Space10
        let height = compact ? 40.0: 46.0
        let grid = SegmentGrid(words / 4, 4, index -> Slot(input, index), gap, gap, height, height)
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
        let suggestions = Suggestions()
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
            for index in 0 ... suggestions.Count {
                let word = suggestions[index]
                let button = Goo
                    .Button{
                    BasedOn: AppTheme.ButtonStyle,
                    Height: compact ? AppTheme.ControlCompact: AppTheme.ControlRegular,
                    Padding: Edges{
                        Left: compact ? AppTheme.Space12: AppTheme.Space16,
                        Right: compact ? AppTheme.Space12: AppTheme.Space16
                    },
                    BorderColor: index == 0 ? AppTheme.Lime: AppTheme.Edge,
                    Hover: Style{BackgroundColor: AppTheme.Rule},
                    Focus: Theme.Read().FocusStyle,
                    Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: word},
                    OnClick: () -> Answer(input, word),
                    Text{
                        Content: word,
                        FontSize: compact ? AppTheme.Type13: AppTheme.Type14,
                        Color: index == 0 ? AppTheme.Lime: AppTheme.Ink,
                        StyleRanges: []TextStyleRange{
                            TextStyleRange(
                                TextRange(typed.Length, word.Length - typed.Length),
                                Style{Color: AppTheme.Dim}
                            )
                        }
                    }
                }
                WidgetKeyBindings.BindActivation(button)
                pick.Add(button)
            }
        }
        card.Add(pick)
        footer.Add(progress)
        footer.Add(
            if step == "done" {
                Button(ui, "Done", () -> EndPhrase(), false, true)
            } else {
                Button(ui, "Continue", phraseForm.Submit, !phraseForm.CanSubmit)
            }
        )
        card.Add(footer)
        return card
    }

    private func Slot(input ToolsInput, index int32) Blob {
        let ui = input.Ui
        let compact = input.Width < 1100
        let position = Array.IndexOf(asked, index)
        let solved = position >= 0 && (position < found || step == "done")
        let active = step == "check" && position == found
        let invalid = active && (wrong || typed.Length > 0 && Suggestions().Count == 0)
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
                    phraseForm.Bind(
                        TextEntry{
                            Key: "word-" + index.ToString(),
                            Value: typed,
                            Controlled: true,
                            AutoFocus: true,
                            FontSize: size,
                            Color: invalid ? AppTheme.Pink: AppTheme.Ink,
                            Accessibility: Accessibility{
                                Name: String.Format(ui.Strings.Get("word {0}"), (index + 1).ToString())
                            },
                            OnChange: value -> {
                                typed = value.Trim().ToLowerInvariant()
                                wrong = false
                                Rebuild()
                            }
                        }
                    )
                )
            )
        } else if position < 0 {
            slot.Add(Label(ui, "••••••••", size, AppTheme.Dim, ""))
        }
        return slot
    }

    private func Tools(input ToolsInput) Blob {
        let ui = input.Ui
        let state = input.State
        let viewOnly = input.Snapshot.ViewOnly
        let tab = viewOnly && state.Tab == "sign" ? "verify": state.Tab
        let required = if tab == "sign" {
            []string{message}
        } else if tab == "proof" {
            []string{proofTx, proofKey, proofAddress, proofAmount}
        } else {
            []string{signer, message, signature}
        }
        let form = WalletForm(
            ui,
            !input.Busy,
            () -> {
                if tab == "sign" {
                    Sign(input)
                } else {
                    Verify(input, tab)
                }
            },
            required,
            () -> {
                ResetVerdict()
                Rebuild()
            }
        )
        let items = List[NavigationItem]()
        for id in[]string{"sign", "verify", "proof", "health"} {
            if id != "sign" || !viewOnly {
                items.Add(NavigationItem{Id: id, Label: ui.Strings.Get(id)})
            }
        }
        let tabs = Tabs(
            ui,
            "tools-tabs",
            "tools",
            items.ToArray(),
            tab,
            id -> {
                state.Tab = id
                ResetVerdict()
                Rebuild()
            }
        )
        let card = WalletParts.PageCard(input.Ui, input.Width, input.Height)
        card.Add(
            WalletParts.Header(
                tabs,
                AppTheme.Space16,
                if tab == "health" {
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
                } else {
                    Container{}
                }
            )
        )
        if tab == "health" {
            Health(input, card)
        } else if tab == "sign" {
            card.Add(
                form.Field(
                    "Message",
                    message,
                    value -> {
                        message = value
                        signature = ""
                    }
                )
            )
            if signature.Length > 0 {
                card.Add(Copyable(ui, "Signature", signature, Grouped(signature)))
            }
            card.Add(ActionRow([]Blob{Button(ui, "Sign", form.Submit, !form.CanSubmit, true)}))
        } else {
            if tab == "proof" {
                card.Add(form.Field("Transaction", proofTx, value -> proofTx = value.Trim(), hidden: input.Privacy))
                card.Add(form.Field("Proof key", proofKey, value -> proofKey = value.Trim(), hidden: input.Privacy))
                card.Add(
                    form.Field("Address", proofAddress, value -> proofAddress = value.Trim(), hidden: input.Privacy)
                )
                card.Add(form.Field("Amount", proofAmount, value -> proofAmount = value.Trim(), hidden: input.Privacy))
            } else {
                card.Add(form.Field("Address", signer, value -> signer = value.Trim(), hidden: input.Privacy))
                card.Add(form.Field("Message", message, value -> message = value))
                card.Add(form.Field("Signature", signature, value -> signature = value.Trim()))
            }
            let result = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                FlexGrow: 1
            }
            if let valid = verdict {
                let color = valid ? AppTheme.Lime: AppTheme.Pink
                result.Add(MaterialIcons.Create(valid ? "check_circle": "cancel", AppTheme.Icon18, color))
                result.Add(Label(ui, ui.Strings.Get(valid ? "Valid": "Invalid"), AppTheme.Type14, color, ""))
            }
            card.Add(ActionRow([]Blob{result, Button(ui, "Verify", form.Submit, !form.CanSubmit, true)}))
        }
        return card
    }

    private func Health(input ToolsInput, card Container) {
        let ui = input.Ui
        let compact = input.Width < 1100
        let report = input.State.Report
        let stale = report?.Stale.Length ?? 0
        let total = report?.Total ?? input.Snapshot.Balance?.Outputs ?? uint64(0)
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
        card.Add(stats)
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
        if let value = report && stale > 0 {
            let table = Container{
                FlexGrow: 1,
                MinHeight: 0,
                Overflow: Overflow.Scroll,
                ScrollbarY: Theme.Read().Scrollbar
            }
            table.Add(Row(input, []string{"height", "output", "reason", "amount"}, true, AppTheme.Dim))
            for output in value.Stale {
                table.Add(
                    Row(
                        input,
                        []string{
                            Count(output.Height),
                            output.Output.Substring(0, 4) + "…" + output.Output.Substring(output.Output.Length - 6),
                            ui.Strings.Get(output.Reason),
                            Amount(ui.Privacy, output.Amount)
                        },
                        false,
                        AppTheme.Ink
                    )
                )
            }
            card.Add(ListParts.Viewport(table))
        } else {
            card.Add(ListParts.Empty(ui, report == nil ? "not checked": "all outputs on the main chain"))
        }
        card.Add(ActionRow([]Blob{Button(ui, "Check", () -> Audit(input), input.Busy)}))
    }

    private func Stat(input ToolsInput, label string, value string, color Color, info bool) Blob {
        let ui = input.Ui
        let title = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            Height: 20,
            Grow(Label(ui, ui.Strings.Get(label), AppTheme.Type12, AppTheme.Body, ""))
        }
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
            Number(input, "stat-" + label, label, value, color, input.Width < 1100 ? 22.0: 28.0)
        }
    }

    private func Reading(input ToolsInput, label string, value string, color Color) Blob ->
    KeyValue(input.Ui, label, value, valueColor: color, size: AppTheme.Type14)

    private func Row(input ToolsInput, cells[]string, heading bool, color Color) Blob {
        let ui = input.Ui
        let row = Container{
            BasedOn: AppTheme.ListRowStyle,
            AlignItems: AlignItems.Stretch,
            Gap: AppTheme.Space8,
            Padding: Edges{
                Left: AppTheme.Space8,
                Right: AppTheme.Space8,
                Top: heading ? AppTheme.Space6: AppTheme.Space10,
                Bottom: heading ? AppTheme.Space6: AppTheme.Space10
            },
            BorderColor: heading ? AppTheme.Rule: AppTheme.FaintRule,
            FlexShrink: 0
        }
        for index in 0 ... cells.Length {
            let cell = cells[index]
            let tint = if heading {
                AppTheme.Dim
            } else if index == 1 {
                AppTheme.Dim
            } else if index == 2 {
                AppTheme.Orange
            } else {
                color
            }
            let text = Label(
                ui,
                heading ? ui.Strings.Get(cell): cell,
                heading ? AppTheme.Type12: AppTheme.Type13,
                tint,
                ""
            )
            row.Add(
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    AlignItems: index == 3 ? AlignItems.FlexEnd: AlignItems.FlexStart,
                    text
                }
            )
        }
        return row
    }

    private func Day(input ToolsInput, date DateTime, year bool) string -> date.ToString(
        if input.Language == "zh-Hans" {
            year ? "yyyy年M月d日": "M月d日"
        } else {
            year ? "d MMM yyyy": "d MMM"
        },
        CultureInfo.InvariantCulture
    )

    private func ResetVerdict() {
        verdict = nil
        verdictRun += 1
    }

    private func Sign(input ToolsInput) {
        var task Task[string]
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                task = input.Session.Proofs.SignAsync(message, ct)
                return task
            },
            () -> signature = task.Result
        )
    }

    private func Verify(input ToolsInput, tab string) {
        ResetVerdict()
        let run = verdictRun
        var task Task[bool]
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                task = if tab == "proof" {
                    input.Session.Proofs.VerifyProofAsync(proofTx, proofKey, proofAddress, proofAmount, ct)
                } else {
                    input.Session.Proofs.VerifyAsync(signer, message, signature, ct)
                }
                return task
            },
            () -> {
                if run == verdictRun {
                    verdict = task.Result
                }
            }
        )
    }
}
