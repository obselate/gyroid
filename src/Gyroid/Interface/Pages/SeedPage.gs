package Gyroid.Interface

import Goo
import Goo.Widgets.Inputs
import System
import System.Collections.Generic
import System.IO

partial class App {
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
        ui.ReleaseClipboard()
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
            let prompt = ui.PageContent(ui.Strings.Get("recovery phrase"))
            prompt.Add(
                ui.Field(
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
                ui.ActionRow(
                    []Blob{ui.Button("Show", () -> RevealSeed(), ui.Working() || revealPassword.Length == 0, true)}
                )
            )
            return prompt
        }
        let panel = ui.PageContent(ui.Strings.Get("recovery phrase"), 760)
        panel.Add(Phrase(words, Math.Min(width - 56, 760) - 42))
        panel.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 16,
                FlexShrink: 0,
                ui.Grow(
                    Checkbox{
                        Label: ui.Strings.Get("I saved these words"),
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
                ui.Button("Continue", () -> FinishSeed(), !seedSaved || ui.Working(), true)
            }
        )
        return panel
    }
}
