package Gyroid.View

import Goo
import Goo.Widgets.Inputs
import System
import System.Collections.Generic
import System.IO

partial class WalletView {
    private var seed[]?char
    private var seedVisible bool
    private var seedSaved bool
    private var holdSeed int32

    private func TakeSeed() bool {
        guard let words = wallet.Keys.TakePendingSeed() else {
            return false
        }
        ClearSeed()
        seed = words
        return true
    }

    private func ClearSeed() {
        if let words = seed {
            Array.Clear(words)
        }
        seed = nil
        seedVisible = false
        seedSaved = false
        holdSeed = Random.Shared.Next()
    }

    private func FinishSeed() {
        ClearSeed()
        wallet.Keys.ContinueFromSeed()
    }

    private func SeedPage() Blob {
        guard let words = seed else {
            let prompt = PageContent(strings.Get("recovery phrase"))
            prompt.Add(
                Field(
                    "Password",
                    revealPassword,
                    value -> {
                        revealPassword = value
                        Rebuild()
                    },
                    () -> RevealSeed(),
                    true
                )
            )
            prompt.Add(
                ActionRow([]Blob{Button("Show", () -> RevealSeed(), Working() || revealPassword.Length == 0, true)})
            )
            return prompt
        }
        let panel = PageContent(strings.Get("recovery phrase"), 760)
        panel.Add(Phrase(words, Math.Min(width - 56, 760) - 42))
        panel.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 16,
                FlexShrink: 0,
                Grow(
                    Checkbox{
                        Label: strings.Get("I saved these words"),
                        State: if seedSaved {
                            AccessibilityChecked.True
                        } else {
                            AccessibilityChecked.False
                        },
                        OnChange: state -> {
                            seedSaved = state == AccessibilityChecked.True
                            Rebuild()
                        }
                    }.Build()
                ),
                Button("Continue", () -> FinishSeed(), !seedSaved || Working(), true)
            }
        )
        return panel
    }

    private func Phrase(words[]char, inner float64) Blob {
        let columns = if inner < 560 {
            3
        } else {
            4
        }
        let cellWidth = Math.Floor((inner - (columns - 1) * 6) / columns)
        let grid = Container{FlexDirection: FlexDirection.Row, FlexWrap: FlexWrap.Wrap, Gap: 6, FlexShrink: 0}
        var start = 0
        var index = 1
        var position = 0
        while position <= words.Length {
            if position == words.Length || words[position] == ' ' {
                if position > start {
                    let number = index.ToString()
                    let length = position - start
                    grid.Add(
                        Container{
                            Width: cellWidth,
                            Height: 36,
                            FlexDirection: FlexDirection.Row,
                            AlignItems: AlignItems.Center,
                            Gap: 10,
                            Padding: Edges{Left: 10, Right: 10},
                            BorderWidth: Edges{Left: 3, Top: 1, Right: 1, Bottom: 1},
                            BorderRadius: 4,
                            BorderColor: rule,
                            BorderStartColor: if seedVisible {
                                lime
                            } else {
                                edge
                            },
                            BackgroundColor: surface,
                            Accessibility: Accessibility{
                                Name: if seedVisible {
                                    number + " " + String(words, start, length)
                                } else {
                                    number + " " + strings.Get("hidden")
                                }
                            },
                            Label(number, 12, body),
                            if seedVisible {
                                Frame(
                                    String(words, start, length),
                                    Progress("seed"),
                                    holdSeed ^ index,
                                    Random.Shared,
                                    14,
                                    lime
                                )
                            } else {
                                Frame(String('x', length), 0, holdSeed ^ index, Random(holdSeed ^ index), 14, body)
                            }
                        }
                    )
                    index++
                }
                start = position + 1
            }
            position++
        }
        let actions = List[Blob]{
            Button(
                if seedVisible {
                    "Hide"
                } else {
                    "Reveal"
                },
                () -> {
                    seedVisible = !seedVisible
                    if seedVisible {
                        Decode("seed")
                    } else {
                        holdSeed = Random.Shared.Next()
                    }
                    Rebuild()
                }
            ),
            Button("Copy", () -> Copy(String(words), 30000)),
            Button("Export", () -> ExportSeed(), Working())
        }
        if seedFromWallet {
            actions.Add(Button("Done", () -> FinishSeed(), Working(), true))
        }
        return Container{Gap: 16, FlexShrink: 0, grid, ActionRow(actions.ToArray())}
    }

    private func ExportSeed() {
        let suggested = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "seed.txt")
        ChooseFile(
            FileDialogKind.SaveFile,
            "Export",
            suggested,
            path -> {
                if let words = seed {
                    Run(wallet.Keys.ExportSeedAsync(path, words))
                }
            }
        )
    }
}
