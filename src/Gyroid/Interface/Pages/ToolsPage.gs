package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Gyroid.Node
import Gyroid.Tools
import Gyroid.Wallet
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
    var Section string
    var AutoLock int32
    var Privacy bool
    var Busy bool
    var Language string
    var Decode float64
    var Width float64
    var Height float64
    var OnNavigate Action[string]
    var OnPrivacy Action
    var OnNodeSettings Action
}

class ToolsPage : Cell[ToolsInput], IDisposable {
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
    private let error Color = Color.Parse("#ff3d6e")
    private let tile Color = Color.Parse("#0a0a0a")
    private let control Color = Color.Parse("#0b0b0b")
    private let selected Color = Color.Parse("#121906")
    private let ring Color = Color.Parse("#141f00")

    protected override func Build(input ToolsInput) Blob {
        if !loaded {
            loaded = true
            checkedAt = input.Session.Checks.PhraseChecked()
            fileMode = FileMode(input)
        }
        if input.Section != "Privacy" && step.Length > 0 {
            EndPhrase()
        }
        return if input.Section == "Privacy" {
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

    private func Card(input ToolsInput) Container {
        let card = input.Ui.Glass()
        card.Width = 900
        card.MaxWidth = Percent(100)
        card.MaxHeight = Percent(100)
        card.BorderRadius = 14
        card.Padding = input.Width < 1100 ? 16.0: Math.Clamp(input.Height * 0.025, 20.0, 32.0)
        card.Gap = Math.Clamp(14 + Math.Max(0, input.Height - 640) * 0.025, 14.0, 24.0)
        return card
    }

    private func Header(input ToolsInput, title string, trailing Blob) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 16,
        FlexShrink: 0,
        input.Ui.Label(input.Ui.Strings.Get(title), 17, input.Ui.Ink, ""),
        Container{FlexGrow: 1},
        trailing
    }

    private func Small(input ToolsInput, label string, primary bool, action Action) Blob {
        let ui = input.Ui
        let color = primary ? ui.Lime: ui.Ink
        let button = Goo
            .Button{
            Height: 28,
            Padding: Edges{Left: 10, Right: 10},
            FlexShrink: 0,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            BorderWidth: 1,
            BorderRadius: 7,
            BorderColor: primary ? ui.Lime: ui.Edge,
            BackgroundColor: control,
            Hover: Style{BackgroundColor: primary ? selected: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Disabled: input.Busy,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get(label)},
            OnClick: action,
            ui.Label(ui.Strings.Get(label), 12, color, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

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

    private func Arc(fraction float64, size float64) Blob {
        let track = PathBuilder(0, 0, size, size)
        let arc = PathBuilder(0, 0, size, size)
        let middle = size / 2
        let radius = middle - 2
        for index in 0 ... 33 {
            let turn = index / 32.0 * Math.PI * 2
            let sweep = turn * fraction - Math.PI / 2
            if index == 0 {
                track.MoveTo(middle + radius, middle)
                arc.MoveTo(middle + radius * Math.Cos(sweep), middle + radius * Math.Sin(sweep))
            } else {
                track.LineTo(middle + radius * Math.Cos(turn), middle + radius * Math.Sin(turn))
                arc.LineTo(middle + radius * Math.Cos(sweep), middle + radius * Math.Sin(sweep))
            }
        }
        return Container{
            Width: size,
            Height: size,
            FlexShrink: 0,
            Shape{
                Position: PositionType.Absolute,
                Width: size,
                Height: size,
                Path: track.Build(),
                Fit: ShapeFit.Fill,
                BorderWidth: 3,
                BorderColor: Color.Parse("#1d1d1d")
            },
            Shape{
                Position: PositionType.Absolute,
                Width: size,
                Height: size,
                Path: arc.Build(),
                Fit: ShapeFit.Fill,
                BorderWidth: 3,
                BorderColor: fraction > 0 ? Color.Parse("#aaff00"): Color.Transparent
            }
        }
    }

    private func Number(input ToolsInput, key string, label string, value string, color Color, size float64) Blob ->
    Cell.Mount[DecodeValueInput, DecodeValue](
        key,
        DecodeValueInput{
            Value: value,
            Ui: input.Ui,
            Name: input.Ui.Strings.Get(label) + " " + value,
            Size: size,
            Color: color,
            FractionColor: color
        }
    )

    private func Minutes(input ToolsInput, minutes int32) string -> switch minutes {
        case 0: input.Ui.Strings.Get("never")
        case 60: "1h"
        default: minutes.ToString() + "m"
    }

    private func Privacy(input ToolsInput) Blob {
        let ui = input.Ui
        let compact = input.Width < 1100
        let size = compact ? 16.0: 20.0
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
            ui.Label(ui.Strings.Get("view-only"), size, ui.Dim, "")
        } else {
            ui.Label(ui.Strings.Get(unchecked ? "not checked": "checked"), size, unchecked ? ui.Orange: ui.Ink, "")
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
            Gap: 10,
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
            Arc(LockShare(input.AutoLock), compact ? 20.0: 26.0),
            ui.Label(LockText(input), size, input.AutoLock == 0 ? ui.Orange: ui.Ink, "")
        }
        WidgetKeyBindings.BindActivation(lockValue)
        if hovered == "lock" && !editing {
            lockValue.Add(MaterialIcons.Create("expand_more", 16, ui.Ink))
        }
        let amountsValue = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            ToggleSwitch{
                Checked: input.Privacy,
                Width: 36,
                Height: 20,
                ThumbSize: 14,
                AccessibilityName: ui.Strings.Get("hide amounts"),
                OnClick: input.OnPrivacy
            }.Build(),
            ui.Label(ui.Strings.Get(input.Privacy ? "on": "off"), size, input.Privacy ? ui.Ink: ui.Orange, "")
        }
        let nodeValue = Goo
            .Button{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            BackgroundColor: Color.Transparent,
            Focus: Theme.Read().FocusStyle,
            Disabled: input.Busy,
            Accessibility: Accessibility{Role: AccessibilityRole.Link, Name: ui.Strings.Get("Node settings")},
            OnClick: input.OnNodeSettings,
            ui.Label(ui.Strings.Get("local"), size, ui.Ink, "")
        }
        WidgetKeyBindings.BindActivation(nodeValue)
        if hovered == "node" {
            nodeValue.Add(MaterialIcons.Create("north_east", 16, ui.Ink))
        }
        let peers = input.Node.Peers
        let outputsValue = if auditing {
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 10,
                Cell.Mount[SpinnerInput, Spinner]("audit", SpinnerInput{Size: 18, StrokeWidth: 2, Color: ui.Lime}),
                ui.Label(ui.Strings.Get("checking"), size, ui.Ink, "")
            }
        } else if stale > 0 {
            ui.Label(String.Format(ui.Strings.Get("{0} stale"), stale), size, ui.Orange, "")
        } else {
            Number(input, "outputs", "outputs", ui.Count(report?.Total ?? balance?.Outputs ?? uint64(0)), ui.Ink, size)
        }
        let outputsFoot = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
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
                            input.OnNavigate("Tools")
                        }
                    )
                } else {
                    Small(input, "Audit", false, () -> Audit(input))
                }
            )
        }
        let fileValue = if fileMode == nil {
            ui.Label("—", size, ui.Dim, "")
        } else {
            ui.Label(ui.Strings.Get(exposed ? "others can read": "owner only"), size, exposed ? ui.Orange: ui.Ink, "")
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
                    ui.Count(peers) + " " + ui.Strings.Get(peers == 1 ? "peer": "peers"),
                    peers == 0 ? ui.Orange: ui.Ink,
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
                Number(input, "memos", "memo errors", ui.Count(memos), memos > 0 ? ui.Orange: ui.Ink, size),
                if memos > 0 {
                    Small(input, "View", false, () -> input.OnNavigate("Transactions"))
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
        let score = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 3}
        for warning in warnings {
            score.Add(Container{Width: 12, Height: 6, BorderRadius: 2, BackgroundColor: warning ? ui.Orange: ui.Lime})
        }
        let passed = warnings.Count((warning bool) -> !warning)
        let card = Card(input)
        card.Add(
            Header(
                input,
                "privacy",
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 10,
                    Accessibility: Accessibility{Name: ui.Strings.Get("privacy") + " " + passed.ToString() + "/8"},
                    score,
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Baseline,
                        ui.Label(passed.ToString(), 20, ui.Lime, ""),
                        ui.Label("/8", 13, ui.Dim, "")
                    }
                }
            )
        )
        let gap = compact ? 8.0: 12.0
        let grid = Container{Gap: gap, FlexShrink: 0}
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

    private func Note(input ToolsInput, content string) Blob -> input.Ui.Label(content, 12, input.Ui.Dim, "")

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
        let top = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, Height: 20}
        if !compact {
            top.Add(MaterialIcons.Create(icon, 16, ui.Body))
        }
        top.Add(ui.Grow(ui.Label(ui.Strings.Get(label), 12, ui.Body, "")))
        top.Add(Info(input, "info-" + key, label, lines))
        return Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: if compact {
                124.0
            } else {
                Math.Clamp(input.Height * 0.19, 136, 210)
            },
            Padding: compact ? 11.0: 14.0,
            Gap: compact ? 8.0: 10.0,
            BorderWidth: 1,
            BorderRadius: 10,
            BorderColor: if edit {
                ui.Lime
            } else if hovered == key {
                Color.Parse("#3a3a3a")
            } else {
                ui.Rule
            },
            BackgroundColor: hovered == key && !edit ? Color.Parse("#121212"): tile,
            BoxShadows: if edit {
                []BoxShadow{BoxShadow{Spread: 3, Color: ring}}
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

    private func LockChoices(input ToolsInput) Blob {
        let ui = input.Ui
        let compact = input.Width < 1100
        let row = Container{
            FlexDirection: FlexDirection.Row,
            Padding: 3,
            BorderRadius: 10,
            BackgroundColor: ui.Black,
            BorderWidth: 1,
            BorderColor: ui.Rule,
            Accessibility: Accessibility{Name: ui.Strings.Get("auto-lock")}
        }
        for minutes in[]int32{5, 15, 60, 0} {
            let chosen = minutes == input.AutoLock
            let button = Goo
                .Button{
                Padding: Edges{Left: compact ? 6.0: 10.0, Right: compact ? 6.0: 10.0, Top: 4, Bottom: 4},
                BorderRadius: 7,
                BackgroundColor: chosen ? Color.Parse("#1a1a1a"): Color.Transparent,
                Hover: Style{BackgroundColor: ui.Rule},
                Focus: Theme.Read().FocusStyle,
                Disabled: input.Busy,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.Radio,
                    Name: Minutes(input, minutes),
                    Checked: chosen ? AccessibilityChecked.True: AccessibilityChecked.False
                },
                OnClick: () -> {
                    editing = false
                    if !chosen {
                        ui.Run(input.Session.SaveAutoLockAsync(minutes))
                    }
                },
                ui.Label(Minutes(input, minutes), compact ? 13.0: 14.0, chosen ? ui.Ink: ui.Body, "")
            }
            WidgetKeyBindings.BindActivation(button)
            row.Add(button)
        }
        return row
    }

    private func Audit(input ToolsInput) {
        if input.State.Audit?.IsCompleted == false {
            return
        }
        let task = input.Session.Checks.CheckOutputsAsync()
        input.State.Audit = task
        input.Ui.Run(
            task,
            () -> {
                input.State.Report = task.Result
            }
        )
    }

    private func RestrictFile(input ToolsInput) {
        input.Ui.Run(
            Task.Run(() -> input.Session.Checks.RestrictWalletFile()),
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
        let task = input.Session.Keys.PhraseAsync(password.ToCharArray())
        password = ""
        input.Ui.Run(
            task,
            () -> {
                if input.Session.State == "Unlocked" && step == "show" {
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
            input.Ui.Run(
                input.Session.Checks.MarkPhraseCheckedAsync(),
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
        let compact = input.Width < 1100
        let card = Card(input)
        let stepper = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8}
        let labels = []string{"show", "check", "done"}
        for index in 0 ... 3 {
            let label = labels[index]
            let state = if index == 0 {
                step == "show" ? 2: 1
            } else if index == 1 {
                step == "show" ? 0: step == "check" ? 2: 1
            } else {
                step == "done" ? 1: 0
            }
            if index > 0 {
                stepper.Add(Container{Width: 26, Height: 1, BackgroundColor: state > 0 ? ui.Lime: ui.Edge})
            }
            let color = state > 0 ? ui.Lime: ui.Dim
            let mark Blob = if state == 1 {
                MaterialIcons.Create("check", 12, ui.Lime)
            } else {
                ui.Label((index + 1).ToString(), 11, color, "")
            }
            stepper.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 6,
                    Container{
                        Width: 22,
                        Height: 22,
                        BorderRadius: 11,
                        BorderWidth: state == 1 ? 0.0: 1.0,
                        BorderColor: state == 2 ? ui.Lime: ui.Edge,
                        BackgroundColor: state == 1 ? Color.Parse("#182400"): Color.Transparent,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.Center,
                        mark
                    },
                    ui.Label(ui.Strings.Get(label), 12, color, "")
                }
            )
        }
        card.Add(Header(input, "recovery phrase", stepper))
        let progress = Container{FlexDirection: FlexDirection.Row, Gap: 4}
        for index in 0 ... 3 {
            progress.Add(
                Container{Width: 18, Height: 4, BorderRadius: 2, BackgroundColor: index < found ? ui.Lime: ui.Edge}
            )
        }
        let footer = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 10, FlexShrink: 0}
        if step != "done" {
            footer.Add(ui.Button("Back", () -> EndPhrase()))
        }
        footer.Add(Container{FlexGrow: 1})
        if step == "show" {
            card.Add(
                ui.Field(
                    "Password",
                    password,
                    value -> {
                        password = value
                        Rebuild()
                    },
                    () -> Reveal(input),
                    true
                )
            )
            footer.Add(ui.Button("Continue", () -> Reveal(input), input.Busy || password.Length == 0, true))
            card.Add(footer)
            return card
        }
        let grid = Container{Gap: compact ? 8.0: 10.0, FlexShrink: 0}
        var line = Container{}
        for index in 0 ... words {
            if index % 4 == 0 {
                line = Container{FlexDirection: FlexDirection.Row, Gap: compact ? 8.0: 10.0}
                grid.Add(line)
            }
            line.Add(Slot(input, index))
        }
        card.Add(grid)
        let pick = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            FlexWrap: FlexWrap.Wrap,
            Gap: 10,
            MinHeight: 50,
            Padding: Edges{Top: 14},
            BorderWidth: Edges{Top: 1},
            BorderColor: ui.Rule,
            FlexShrink: 0
        }
        let suggestions = Suggestions()
        if step == "done" {
            pick.Gap = 14
            pick.Add(MaterialIcons.Create("check", 22, ui.Lime))
            pick.Add(ui.Label(ui.Strings.Get("phrase checked"), 18, ui.Lime, ""))
            if let date = checkedAt {
                pick.Add(Note(input, Day(input, date, true)))
            }
        } else if wrong {
            let number = (asked[found] + 1).ToString()
            pick.Add(MaterialIcons.Create("close", 16, error))
            pick.Add(ui.Label(String.Format(ui.Strings.Get("That is not word {0}."), number), 14, error, ""))
            pick.Add(ui.Label(ui.Strings.Get("Check your paper."), 14, ui.Dim, ""))
        } else if typed.Length > 0 && suggestions.Count == 0 {
            pick.Add(MaterialIcons.Create("warning", 16, error))
            pick.Add(ui.Label(String.Format(ui.Strings.Get("No word starts with “{0}”."), typed), 14, error, ""))
        } else {
            pick.Add(
                ui.Label(String.Format(ui.Strings.Get("word {0}"), (asked[found] + 1).ToString()), 12, ui.Lime, "")
            )
            for index in 0 ... suggestions.Count {
                let word = suggestions[index]
                let button = Goo
                    .Button{
                    Height: compact ? 30.0: 34.0,
                    Padding: Edges{Left: compact ? 12.0: 16.0, Right: compact ? 12.0: 16.0},
                    AlignItems: AlignItems.Center,
                    BorderWidth: 1,
                    BorderRadius: 7,
                    BorderColor: index == 0 ? ui.Lime: ui.Edge,
                    BackgroundColor: control,
                    Hover: Style{BackgroundColor: ui.Rule},
                    Focus: Theme.Read().FocusStyle,
                    Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: word},
                    OnClick: () -> Answer(input, word),
                    Text{
                        Content: word,
                        FontSize: compact ? 13.0: 14.0,
                        Color: index == 0 ? ui.Lime: ui.Ink,
                        StyleRanges: []TextStyleRange{
                            TextStyleRange(TextRange(typed.Length, word.Length - typed.Length), Style{Color: ui.Dim})
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
                ui.Button("Done", () -> EndPhrase(), false, true)
            } else {
                ui.Button(
                    "Continue",
                    () -> Answer(input, suggestions.Count > 0 ? suggestions[0]: typed),
                    typed.Length == 0 || suggestions.Count == 0
                )
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
            Gap: 10,
            Padding: Edges{Left: compact ? 10.0: 12.0, Right: compact ? 10.0: 12.0},
            BorderWidth: 1,
            BorderRadius: 8,
            BorderColor: if invalid {
                error
            } else if active {
                ui.Lime
            } else if position > found {
                ui.Edge
            } else {
                ui.Rule
            },
            BackgroundColor: tile,
            BoxShadows: if invalid {
                []BoxShadow{BoxShadow{Spread: 3, Color: Color.Parse("#24090f")}}
            } else if active {
                []BoxShadow{BoxShadow{Spread: 3, Color: ring}}
            } else {
                []BoxShadow{}
            },
            Container{Width: 18, FlexShrink: 0, ui.Label((index + 1).ToString(), 12, ui.Dim, "")}
        }
        let size = compact ? 14.0: 15.0
        if solved {
            slot.Add(ui.Grow(ui.Label(answers[position], size, ui.Lime, "")))
            slot.Add(MaterialIcons.Create("check", 16, ui.Lime))
        } else if active {
            slot.Add(
                ui.Grow(
                    TextEntry{
                        Key: "word-" + index.ToString(),
                        Value: typed,
                        Controlled: true,
                        AutoFocus: true,
                        FontSize: size,
                        Color: invalid ? error: ui.Ink,
                        Accessibility: Accessibility{
                            Name: String.Format(ui.Strings.Get("word {0}"), (index + 1).ToString())
                        },
                        OnChange: value -> {
                            typed = value.Trim().ToLowerInvariant()
                            wrong = false
                            Rebuild()
                        },
                        OnSubmit: value -> {
                            let suggestions = Suggestions()
                            Answer(input, suggestions.Count > 0 ? suggestions[0]: typed)
                        }
                    }
                )
            )
        } else if position < 0 {
            slot.Add(ui.Label("••••••••", size, Color.Parse("#6a6a6a"), ""))
        }
        return slot
    }

    private func Tools(input ToolsInput) Blob {
        let ui = input.Ui
        let state = input.State
        let viewOnly = input.Snapshot.ViewOnly
        let tab = viewOnly && state.Tab == "sign" ? "verify": state.Tab
        let tabs = Container{
            FlexDirection: FlexDirection.Row,
            Gap: 4,
            Accessibility: Accessibility{Role: AccessibilityRole.TabList, Name: ui.Strings.Get("tools")}
        }
        for id in[]string{"sign", "verify", "proof", "health"} {
            if id == "sign" && viewOnly {
                continue
            }
            let button = Goo
                .Button{
                Padding: Edges{Left: 12, Right: 12, Top: 6, Bottom: 6},
                BorderRadius: 8,
                BackgroundColor: tab == id ? selected: Color.Transparent,
                Hover: Style{BackgroundColor: tab == id ? selected: ui.Rule},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{
                    Role: AccessibilityRole.Tab,
                    Name: ui.Strings.Get(id),
                    Selected: tab == id
                },
                OnClick: () -> {
                    state.Tab = id
                    ResetVerdict()
                    Rebuild()
                },
                ui.Label(ui.Strings.Get(id), 13, tab == id ? ui.Lime: ui.Body, "")
            }
            WidgetKeyBindings.BindActivation(button)
            tabs.Add(button)
        }
        let card = Card(input)
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 16,
                FlexShrink: 0,
                ui.Label(ui.Strings.Get("tools"), 17, ui.Ink),
                tabs,
                Container{FlexGrow: 1},
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
            }
        )
        if tab == "health" {
            Health(input, card)
        } else if tab == "sign" {
            card.Add(
                ui.Field(
                    "Message",
                    message,
                    value -> {
                        message = value
                        signature = ""
                        Rebuild()
                    },
                    () -> Sign(input)
                )
            )
            if signature.Length > 0 {
                card.Add(ui.Copyable("Signature", signature, ui.Grouped(signature)))
            }
            card.Add(
                ui.ActionRow([]Blob{ui.Button("Sign", () -> Sign(input), input.Busy || message.Length == 0, true)})
            )
        } else {
            let verify Action = () -> Verify(input, tab)
            if tab == "proof" {
                card.Add(Field(input, "Transaction", proofTx, value -> proofTx = value.Trim(), verify))
                card.Add(Field(input, "Proof key", proofKey, value -> proofKey = value.Trim(), verify))
                card.Add(Field(input, "Address", proofAddress, value -> proofAddress = value.Trim(), verify))
                card.Add(Field(input, "Amount", proofAmount, value -> proofAmount = value.Trim(), verify))
            } else {
                card.Add(Field(input, "Address", signer, value -> signer = value.Trim(), verify))
                card.Add(Field(input, "Message", message, value -> message = value, verify))
                card.Add(Field(input, "Signature", signature, value -> signature = value.Trim(), verify))
            }
            let blank = if tab == "proof" {
                proofTx.Length == 0 || proofKey.Length == 0 || proofAddress.Length == 0 || proofAmount.Length == 0
            } else {
                signer.Length == 0 || message.Length == 0 || signature.Length == 0
            }
            let result = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, FlexGrow: 1}
            if let valid = verdict {
                let color = valid ? ui.Lime: ui.Pink
                result.Add(MaterialIcons.Create(valid ? "check_circle": "cancel", 18, color))
                result.Add(ui.Label(ui.Strings.Get(valid ? "Valid": "Invalid"), 14, color, ""))
            }
            card.Add(ui.ActionRow([]Blob{result, ui.Button("Verify", verify, input.Busy || blank, true)}))
        }
        return card
    }

    private func Health(input ToolsInput, card Container) {
        let ui = input.Ui
        let compact = input.Width < 1100
        let report = input.State.Report
        let stale = report?.Stale.Length ?? 0
        let total = report?.Total ?? input.Snapshot.Balance?.Outputs ?? uint64(0)
        let stats = Container{FlexDirection: FlexDirection.Row, Gap: compact ? 8.0: 12.0, FlexShrink: 0}
        stats.Add(Stat(input, "outputs", ui.Count(total), ui.Ink, false))
        stats.Add(
            Stat(
                input,
                "on main chain",
                if let value = report {
                    ui.Count(value.Total - uint64(stale))
                } else {
                    "—"
                },
                ui.Mint,
                false
            )
        )
        stats.Add(Stat(input, "stale", report == nil ? "—": stale.ToString(), stale > 0 ? ui.Orange: ui.Ink, true))
        stats.Add(Stat(input, "duplicates", report == nil ? "—": ui.Count(report.Duplicates), ui.Ink, true))
        card.Add(stats)
        let values = Container{
            FlexDirection: FlexDirection.Row,
            Gap: compact ? 8.0: 12.0,
            Padding: Edges{Left: 14, Right: 14},
            FlexShrink: 0
        }
        values.Add(
            Reading(
                input,
                "stale amount",
                report == nil ? "—": ui.Amount(report.StaleAmount),
                stale > 0 ? ui.Orange: ui.Ink
            )
        )
        values.Add(Reading(input, "unspendable", report == nil ? "—": ui.Amount(report.Unspendable), ui.Ink))
        values.Add(Reading(input, "synced", report == nil ? "—": ui.Count(report.Synced), ui.Ink))
        values.Add(Reading(input, "checked", report == nil ? "—": report.Checked.ToString("HH:mm"), ui.Ink))
        card.Add(values)
        if let value = report && stale > 0 {
            let table = Container{
                FlexShrink: 1,
                MinHeight: 0,
                Overflow: Overflow.Scroll,
                ScrollbarY: Theme.Read().Scrollbar
            }
            table.Add(Row(input, []string{"height", "output", "reason", "amount"}, true, ui.Dim))
            for output in value.Stale {
                table.Add(
                    Row(
                        input,
                        []string{
                            ui.Count(output.Height),
                            output.Output.Substring(0, 4) + "…" + output.Output.Substring(output.Output.Length - 6),
                            ui.Strings.Get(output.Reason),
                            ui.Amount(output.Amount)
                        },
                        false,
                        ui.Ink
                    )
                )
            }
            card.Add(table)
        } else {
            let empty = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                Gap: 10,
                Height: 112,
                FlexShrink: 0,
                BorderWidth: Edges{Top: 1},
                BorderColor: ui.Rule
            }
            if report == nil {
                empty.Add(ui.Label(ui.Strings.Get("not checked"), 13, ui.Dim, ""))
            } else {
                empty.Add(MaterialIcons.Create("check", 18, ui.Mint))
                empty.Add(ui.Label(ui.Strings.Get("all outputs on the main chain"), 13, ui.Mint, ""))
            }
            card.Add(empty)
        }
        card.Add(ui.ActionRow([]Blob{ui.Button("Check", () -> Audit(input), input.Busy)}))
    }

    private func Stat(input ToolsInput, label string, value string, color Color, info bool) Blob {
        let ui = input.Ui
        let title = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            Height: 20,
            ui.Grow(ui.Label(ui.Strings.Get(label), 12, ui.Body, ""))
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
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Gap: 6,
            Padding: Edges{Left: 14, Right: 14, Top: 12, Bottom: 12},
            BorderWidth: 1,
            BorderRadius: 10,
            BorderColor: ui.Rule,
            BackgroundColor: tile,
            title,
            Number(input, "stat-" + label, label, value, color, input.Width < 1100 ? 22.0: 28.0)
        }
    }

    private func Reading(input ToolsInput, label string, value string, color Color) Blob -> Container{
        FlexGrow: 1,
        FlexBasis: 0,
        MinWidth: 0,
        Gap: 4,
        Accessibility: Accessibility{Name: input.Ui.Strings.Get(label) + " " + value},
        input.Ui.Label(input.Ui.Strings.Get(label), 12, input.Ui.Dim, ""),
        input.Ui.Label(value, 15, color, "")
    }

    private func Row(input ToolsInput, cells[]string, heading bool, color Color) Blob {
        let ui = input.Ui
        let row = Container{
            FlexDirection: FlexDirection.Row,
            Gap: 8,
            Padding: Edges{Left: 8, Right: 8, Top: heading ? 6.0: 9.0, Bottom: heading ? 6.0: 9.0},
            BorderWidth: Edges{Bottom: 1},
            BorderColor: heading ? ui.Rule: Color.Parse("#141414"),
            FlexShrink: 0
        }
        for index in 0 ... cells.Length {
            let cell = cells[index]
            let tint = if heading {
                ui.Dim
            } else if index == 1 {
                ui.Dim
            } else if index == 2 {
                ui.Orange
            } else {
                color
            }
            let text = ui.Label(heading ? ui.Strings.Get(cell): cell, heading ? 12.0: 13.0, tint, "")
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

    private func Field(input ToolsInput, label string, value string, changed Action[string], submit Action) Blob ->
    input.Ui.Field(
        label,
        value,
        text -> {
            changed(text)
            ResetVerdict()
            Rebuild()
        },
        submit,
        hidden: input.Privacy && input.State.Tab == "proof"
    )

    private func Sign(input ToolsInput) {
        if input.Busy || message.Length == 0 {
            return
        }
        let task = input.Session.Proofs.SignAsync(message)
        input.Ui.Run(task, () -> signature = task.Result)
    }

    private func Verify(input ToolsInput, tab string) {
        if input.Busy {
            return
        }
        ResetVerdict()
        let run = verdictRun
        let task = if tab == "proof" {
            input.Session.Proofs.VerifyProofAsync(proofTx, proofKey, proofAddress, proofAmount)
        } else {
            input.Session.Proofs.VerifyAsync(signer, message, signature)
        }
        input.Ui.Run(
            task,
            () -> {
                if run == verdictRun {
                    verdict = task.Result
                }
            }
        )
    }
}
