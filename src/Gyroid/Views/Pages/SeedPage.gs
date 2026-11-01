package Gyroid.Views

import Goo
import Goo.Widgets.Inputs
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.TextParts
import Gyroid.Services
import System
import System.IO

data struct SeedPageInput {
    var Session WalletSession
    var Ui Presentation
    var Words[]char
    var ClipboardOwner ReadOnlyMemory[uint8]
    var FromWallet bool
    var Busy bool
    var Language string
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnDone Action
    var Issue string
    var OnRetry Action
}

class SeedPage : Cell[SeedPageInput] {
    private let configureActions Action[SeedActions]

    init() {
        configureActions = cell -> {
            if Input is SeedPageInput source {
                cell.Accept(
                    SeedActionsInput{
                        Keys: source.Session.Keys,
                        Ui: source.Ui,
                        Words: source.Words,
                        ClipboardOwner: source.ClipboardOwner,
                        FromWallet: source.FromWallet,
                        Busy: source.Busy,
                        Language: source.Language,
                        ChooseFile: source.ChooseFile,
                        OnDone: source.OnDone
                    }
                )
            }
        }
    }

    protected override func Build(input SeedPageInput) Blob {
        let ui = input.Ui
        let card = WalletParts.PageCard(ui, maxWidth: 760, fill: true)
        card.Add(Label(ui, ui.Strings.Get("recovery phrase"), AppTheme.Type17, AppTheme.Ink, ""))
        if input.Words.Length == 0 {
            if input.Issue.Length > 0 {
                card.Add(MessageParts.Problem(ui, input.Issue))
                card.Add(Button(ui, "Retry", input.OnRetry, input.Busy, true))
            }
            return card
        }
        card.Add(Cell.Mount[SeedActions]("seed-actions", configureActions))
        return card
    }
}

data struct SeedActionsInput {
    var Keys WalletKeys
    var Ui Presentation
    var Words[]char
    var ClipboardOwner ReadOnlyMemory[uint8]
    var FromWallet bool
    var Busy bool
    var Language string
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnDone Action
}

class SeedActions : Cell, IDisposable {
    private var input SeedActionsInput
    private var visible bool
    private var saved bool
    private var hold int32
    private var copiedOwner ReadOnlyMemory[uint8]
    private var generation int32

    func Accept(next SeedActionsInput) {
        if input.Equals(next) {
            return
        }
        if !Object.ReferenceEquals(input.Words, next.Words) {
            generation++
            visible = false
            saved = false
            hold = Random.Shared.Next()
            copiedOwner = ReadOnlyMemory[uint8].Empty
        }
        input = next
        Rebuild()
    }

    override func Build() Blob {
        let ui = input.Ui
        let content = Container{Gap: AppTheme.Space12}
        content.Add(
            Cell.Mount[SeedPhraseInput, SeedPhrase](
                "seed-phrase",
                SeedPhraseInput{Ui: ui, Words: input.Words, Visible: visible, Hold: hold, Language: input.Language}
            )
        )
        let actions = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            FlexShrink: 0
        }
        actions.Add(
            Button(
                ui,
                visible ? "Hide": "Reveal",
                () -> {
                    visible = !visible
                    if !visible {
                        hold = Random.Shared.Next()
                    }
                }
            )
        )
        let copied = !copiedOwner.IsEmpty && copiedOwner.Equals(input.ClipboardOwner)
        actions.Add(
            Button(
                ui,
                copied ? "Copied": "Copy",
                () -> {
                    let previous = ui.Actions.ClipboardOwner
                    ui.Actions.Copy(input.Words, 30000)
                    if !previous.Equals(ui.Actions.ClipboardOwner) {
                        copiedOwner = ui.Actions.ClipboardOwner
                    }
                }
            )
        )
        actions.Add(Button(ui, "Export", () -> Export(input), input.Busy))
        var completion = actions
        if !input.FromWallet {
            content.Add(actions)
            completion = Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                FlexShrink: 0
            }
            completion.Add(
                (
                    AppTheme.Checkbox with{
                        Label = ui.Strings.Get("I saved these words"),
                        State = saved ? AccessibilityChecked.True: AccessibilityChecked.False,
                        OnChange = state -> {
                            saved = state == AccessibilityChecked.True
                        }
                    }
                ).Build()
            )
        }
        completion.Add(Container{FlexGrow: 1})
        completion.Add(
            Button(
                ui,
                input.FromWallet ? "Done": "Continue",
                input.OnDone,
                input.Busy || !input.FromWallet && !saved,
                true
            )
        )
        content.Add(completion)
        return content
    }

    private func Export(input SeedActionsInput) {
        let current = generation
        input.ChooseFile.Invoke(
            FileDialogKind.SaveFile,
            "Export",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "seed.txt"),
            (path string) -> {
                if current == generation {
                    input.Ui.Actions.Run(ct -> input.Keys.ExportSeedAsync(path, input.Words, ct))
                }
            }
        )
    }

    func Dispose() {
        generation++
        visible = false
        saved = false
        input = default
        copiedOwner = ReadOnlyMemory[uint8].Empty
    }
}

data struct SeedPhraseInput {
    var Ui Presentation
    var Words[]char
    var Visible bool
    var Hold int32
    var Language string
}

class SeedPhrase : Cell[SeedPhraseInput] {
    protected override func Build(input SeedPhraseInput) Blob {
        let grid = Container{Gap: AppTheme.Space6, FlexShrink: 0}
        var line = Container{}
        var start = 0
        var index = 1
        var position = 0
        while position <= input.Words.Length {
            if position == input.Words.Length || input.Words[position] == ' ' {
                if position > start {
                    if index % 4 == 1 {
                        line = Container{FlexDirection: FlexDirection.Row, Gap: AppTheme.Space6}
                        grid.Add(line)
                    }
                    line.Add(Word(input, index, start, position - start))
                    index++
                }
                start = position + 1
            }
            position++
        }
        if input.Visible {
            grid.Add(
                Label(input.Ui, input.Ui.Strings.Get("Keep these words secret"), AppTheme.Type12, AppTheme.Body, "")
            )
        }
        return grid
    }

    private func Word(input SeedPhraseInput, index int32, start int32, length int32) Blob {
        let ui = input.Ui
        var word = ""
        if input.Visible {
            var low = 0
            var high = Bip39Wordlist.Words.Length - 1
            while low <= high {
                let middle = low + (high - low) / 2
                let candidate = Bip39Wordlist.Words[middle]
                let order = ReadOnlySpan[char](input.Words, start, length).CompareTo(
                    System.MemoryExtensions.AsSpan(candidate),
                    StringComparison.Ordinal
                )
                if order == 0 {
                    word = candidate
                    break
                }
                if order < 0 {
                    high = middle - 1
                } else {
                    low = middle + 1
                }
            }
        }
        return Container{
            BasedOn: AppTheme.FieldStyle,
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Height: 36,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            Padding: Edges{Left: AppTheme.Space10, Right: AppTheme.Space10},
            BorderColor: AppTheme.Rule,
            BackgroundColor: AppTheme.Surface,
            Accessibility: Accessibility{
                Name: if input.Visible {
                    word
                } else {
                    index.ToString() + " " + ui.Strings.Get("hidden")
                }
            },
            Label(ui, index.ToString(), AppTheme.Type12, AppTheme.Dim, ""),
            if input.Visible {
                Label(ui, word, AppTheme.Type14, AppTheme.Lime, "")
            } else {
                Frame(ui, "xxxxxxxx", 0, input.Hold ^ index, Random(input.Hold ^ index), AppTheme.Type14, AppTheme.Body)
            }
        }
    }
}
