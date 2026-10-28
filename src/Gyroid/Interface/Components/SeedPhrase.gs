package Gyroid.Interface

import Goo
import Goo.Widgets.Inputs
import System
import System.Collections.Generic
import System.IO

partial class App {
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
                            BorderColor: ui.Rule,
                            BorderStartColor: if seedVisible {
                                ui.Lime
                            } else {
                                ui.Edge
                            },
                            BackgroundColor: ui.Surface,
                            Accessibility: Accessibility{
                                Name: if seedVisible {
                                    number + " " + String(words, start, length)
                                } else {
                                    number + " " + ui.Strings.Get("hidden")
                                }
                            },
                            ui.Label(number, 12, ui.Body),
                            if seedVisible {
                                ui.Frame(
                                    String(words, start, length),
                                    ui.Progress("seed"),
                                    holdSeed ^ index,
                                    Random.Shared,
                                    14,
                                    ui.Lime
                                )
                            } else {
                                ui.Frame(
                                    String('x', length),
                                    0,
                                    holdSeed ^ index,
                                    Random(holdSeed ^ index),
                                    14,
                                    ui.Body
                                )
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
            ui.Button(
                if seedVisible {
                    "Hide"
                } else {
                    "Reveal"
                },
                () -> {
                    seedVisible = !seedVisible
                    if seedVisible {
                        ui.Decode("seed")
                    } else {
                        holdSeed = Random.Shared.Next()
                    }
                    Rebuild()
                }
            ),
            ui.Button("Copy", () -> ui.Copy(String(words), 30000)),
            ui.Button("Export", () -> ExportSeed(), ui.Working())
        }
        if seedFromWallet {
            actions.Add(ui.Button("Done", () -> FinishSeed(), ui.Working(), true))
        }
        return Container{Gap: 16, FlexShrink: 0, grid, ui.ActionRow(actions.ToArray())}
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
