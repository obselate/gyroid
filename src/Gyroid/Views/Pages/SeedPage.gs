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
    var FromWallet bool
    var Busy bool
    var Language string
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnDone Action
    var Issue string
    var OnRetry Action
}

class SeedPage : Cell[SeedPageInput], IDisposable {
    private var shown[]?char

    private var visible bool

    private var saved bool

    private var hold int32

    protected override func Build(input SeedPageInput) Blob {
        let ui = input.Ui
        let card = WalletParts.Card(ui, gap: AppTheme.Space14, radius: AppTheme.Radius14)
        card.Width = Percent(100)
        card.MaxWidth = 760
        card.MaxHeight = Percent(100)
        card.Add(Label(ui, ui.Strings.Get("recovery phrase"), AppTheme.Type17, AppTheme.Ink, ""))
        if input.Words.Length == 0 {
            if input.Issue.Length > 0 {
                card.Add(Label(ui, ui.Strings.Explain(input.Issue), AppTheme.Type13, AppTheme.Pink, ""))
                card.Add(Button(ui, "Retry", input.OnRetry, input.Busy, true))
            }
            return card
        }
        let words = input.Words
        if !Object.ReferenceEquals(words, shown) {
            shown = words
            visible = false
            saved = false
            hold = Random.Shared.Next()
        }
        let grid = Container{Gap: AppTheme.Space6, FlexShrink: 0}
        var line = Container{}
        var start = 0
        var index = 1
        var position = 0
        while position <= words.Length {
            if position == words.Length || words[position] == ' ' {
                if position > start {
                    if index % 4 == 1 {
                        line = Container{FlexDirection: FlexDirection.Row, Gap: AppTheme.Space6}
                        grid.Add(line)
                    }
                    line.Add(Word(ui, index, words, start, position - start))
                    index++
                }
                start = position + 1
            }
            position++
        }
        card.Add(grid)
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
                    Rebuild()
                }
            )
        )
        actions.Add(Button(ui, "Copy", () -> ui.Actions.Copy(words, 30000)))
        actions.Add(Button(ui, "Export", () -> Export(input), input.Busy))
        actions.Add(Container{FlexGrow: 1})
        if !input.FromWallet {
            actions.Add(
                (
                    AppTheme.Checkbox with{
                        Label = ui.Strings.Get("I saved these words"),
                        State = saved ? AccessibilityChecked.True: AccessibilityChecked.False,
                        OnChange = state -> {
                            saved = state == AccessibilityChecked.True
                            Rebuild()
                        }
                    }
                ).Build()
            )
        }
        actions.Add(
            Button(
                ui,
                input.FromWallet ? "Done": "Continue",
                input.OnDone,
                input.Busy || !input.FromWallet && !saved,
                true
            )
        )
        card.Add(actions)
        return card
    }

    private func Word(ui Presentation, index int32, words[]char, start int32, length int32) Blob {
        var word = ""
        if visible {
            var low = 0
            var high = Bip39Wordlist.Words.Length - 1
            while low <= high {
                let middle = low + (high - low) / 2
                let candidate = Bip39Wordlist.Words[middle]
                let order = ReadOnlySpan[char](words, start, length).CompareTo(
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
                Name: if visible {
                    word
                } else {
                    index.ToString() + " " + ui.Strings.Get("hidden")
                }
            },
            Label(ui, index.ToString(), AppTheme.Type12, AppTheme.Dim, ""),
            if visible {
                Label(ui, word, AppTheme.Type14, AppTheme.Lime, "")
            } else {
                Frame(ui, String('x', length), 0, hold ^ index, Random(hold ^ index), AppTheme.Type14, AppTheme.Body)
            }
        }
    }

    private func Export(input SeedPageInput) {
        input.ChooseFile.Invoke(
            FileDialogKind.SaveFile,
            "Export",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "seed.txt"),
            (path string) -> {
                if let words = shown {
                    input.Ui.Actions.Run(ct -> input.Session.Keys.ExportSeedAsync(path, words, ct))
                }
            }
        )
    }

    func Dispose() {
        shown = nil
    }
}
