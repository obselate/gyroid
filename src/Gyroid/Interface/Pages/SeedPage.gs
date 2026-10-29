package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Inputs
import Gyroid.Wallet
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
        let card = ui.Glass()
        card.Width = Percent(100)
        card.MaxWidth = 760
        card.MaxHeight = Percent(100)
        card.BorderRadius = 14
        card.Gap = 14
        card.Add(ui.Label(ui.Strings.Get("recovery phrase"), 17, ui.Ink, ""))
        if input.Words.Length == 0 {
            if input.Issue.Length > 0 {
                card.Add(ui.Label(ui.Strings.Explain(input.Issue), 13, ui.Pink, ""))
                card.Add(ui.Button("Retry", input.OnRetry, input.Busy, true))
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
        let grid = Container{Gap: 6, FlexShrink: 0}
        var line = Container{}
        var start = 0
        var index = 1
        var position = 0
        while position <= words.Length {
            if position == words.Length || words[position] == ' ' {
                if position > start {
                    if index % 4 == 1 {
                        line = Container{FlexDirection: FlexDirection.Row, Gap: 6}
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
        let actions = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, FlexShrink: 0}
        actions.Add(
            ui.Button(
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
        actions.Add(ui.Button("Copy", () -> ui.Copy(words, 30000)))
        actions.Add(ui.Button("Export", () -> Export(input), input.Busy))
        actions.Add(Container{FlexGrow: 1})
        if !input.FromWallet {
            actions.Add(
                Checkbox{
                    Label: ui.Strings.Get("I saved these words"),
                    State: saved ? AccessibilityChecked.True: AccessibilityChecked.False,
                    OnChange: state -> {
                        saved = state == AccessibilityChecked.True
                        Rebuild()
                    }
                }.Build()
            )
        }
        actions.Add(
            ui.Button(
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
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Height: 36,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Padding: Edges{Left: 10, Right: 10},
            BorderWidth: 1,
            BorderRadius: 8,
            BorderColor: ui.Rule,
            BackgroundColor: ui.Surface,
            Accessibility: Accessibility{
                Name: if visible {
                    word
                } else {
                    index.ToString() + " " + ui.Strings.Get("hidden")
                }
            },
            ui.Label(index.ToString(), 12, ui.Dim, ""),
            if visible {
                ui.Label(word, 14, ui.Lime, "")
            } else {
                ui.Frame(String('x', length), 0, hold ^ index, Random(hold ^ index), 14, ui.Body)
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
                    input.Ui.Run(ct -> input.Session.Keys.ExportSeedAsync(path, words, ct))
                }
            }
        )
    }

    func Dispose() {
        shown = nil
    }
}
