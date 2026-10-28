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
    var Words[]?char
    var FromWallet bool
    var Busy bool
    var Language string
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnDone Action
}

class SeedPage : Cell[SeedPageInput], IDisposable {
    private var shown[]?char

    private var visible bool

    private var saved bool

    private var hold int32

    private var password string = ""

    protected override func Build(input SeedPageInput) Blob {
        let ui = input.Ui
        let card = ui.Glass()
        card.Width = Percent(100)
        card.MaxWidth = 760
        card.MaxHeight = Percent(100)
        card.BorderRadius = 14
        card.Gap = 14
        card.Add(ui.Label(ui.Strings.Get("recovery phrase"), 17, ui.Ink, ""))
        guard let words = input.Words else {
            shown = nil
            card.MaxWidth = 560
            card.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.FlexStart,
                    Gap: 10,
                    FlexShrink: 0,
                    ui.Grow(
                        Container{
                            MinWidth: 0,
                            ui.Entry(
                                TextField{
                                    AccessibilityName: ui.Strings.Get("Password"),
                                    Placeholder: ui.Strings.Get("Password"),
                                    Value: password,
                                    Controlled: true,
                                    Password: true,
                                    RevealButton: true,
                                    Disabled: input.Busy,
                                    OnChange: value -> {
                                        password = value
                                        Rebuild()
                                    },
                                    OnSubmit: _ -> Reveal(input)
                                }
                            )
                        }
                    ),
                    ui.Button("Show", () -> Reveal(input), input.Busy || password.Length == 0, true)
                }
            )
            return card
        }
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
                    line.Add(Word(ui, index, String(words, start, position - start)))
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
        actions.Add(ui.Button("Copy", () -> ui.Copy(String(words), 30000)))
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

    private func Word(ui Presentation, index int32, word string) Blob -> Container{
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
            Name: index.ToString() + " " + if visible {
                word
            } else {
                ui.Strings.Get("hidden")
            }
        },
        ui.Label(index.ToString(), 12, ui.Dim, ""),
        if visible {
            ui.Label(word, 14, ui.Lime, "")
        } else {
            ui.Frame(String('x', word.Length), 0, hold ^ index, Random(hold ^ index), 14, ui.Body)
        }
    }

    private func Reveal(input SeedPageInput) {
        if input.Busy || password.Length == 0 {
            return
        }
        let secret = password.ToCharArray()
        password = ""
        input.Ui.Run(input.Session.Keys.RevealSeedAsync(secret), nil, secret)
    }

    private func Export(input SeedPageInput) {
        input.ChooseFile.Invoke(
            FileDialogKind.SaveFile,
            "Export",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "seed.txt"),
            (path string) -> {
                if let words = shown {
                    input.Ui.Run(input.Session.Keys.ExportSeedAsync(path, words))
                }
            }
        )
    }

    func Dispose() {
        shown = nil
    }
}
