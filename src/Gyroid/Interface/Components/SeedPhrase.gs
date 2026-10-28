package Gyroid.Interface

import Goo
import Goo.Widgets.Inputs
import System
import System.Collections.Generic
import System.IO

partial class WalletView {
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
