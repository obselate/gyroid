package Gyroid.Views

import Goo
import Goo.Widgets.Inputs
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.TextParts
import Gyroid.Services
import System
import System.IO
import System.Threading
import System.Threading.Tasks

data struct SeedPageInput {
    var Session WalletSession
    var Wallet string
    var Ui Presentation
    var Words[]char
    var FromWallet bool
    var Busy bool
    var Language string
    var OnDone Action
    var Issue string
    var OnRetry Action
}

class SeedPage : Cell, IDisposable {
    private var input SeedPageInput
    private var visible bool
    private var saved bool
    private var hold int32
    private var copiedOwner ReadOnlyMemory[uint8]
    private var generation int32
    private var actions UiService?
    private let clipboardChanged Action
    private var phrase SeedPhraseData?
    private var exporting bool
    private var exportResult string = ""

    init() {
        clipboardChanged = () -> Rebuild()
    }

    func Accept(next SeedPageInput) {
        if actions != next.Ui.Actions {
            if let source = actions {
                source.ClipboardChanged -= clipboardChanged
            }
            actions = next.Ui.Actions
            next.Ui.Actions.ClipboardChanged += clipboardChanged
        }
        if next == input {
            return
        }
        if next.Wallet != input.Wallet || !Object.ReferenceEquals(input.Words, next.Words) {
            ReleaseCopy()
            generation++
            phrase?.Dispose()
            phrase = SeedPhraseData(next.Words)
            exporting = false
            exportResult = ""
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
        let card = WalletParts.PageCard(ui, maxWidth: 760, fill: true)
        card.Add(Label(ui, ui.Strings.Get("recovery phrase"), AppTheme.Type17, AppTheme.Ink, ""))
        if input.Words.Length == 0 {
            if input.Issue.Length > 0 {
                card.Add(MessageParts.Problem(ui, input.Issue))
                card.Add(Button(ui, "Retry", input.OnRetry, input.Busy, true))
            }
            return card
        }
        card.Add(
            Cell.Mount[SeedPhraseInput, SeedPhrase](
                "seed-phrase",
                SeedPhraseInput{Ui: ui, Phrase: phrase, Visible: visible, Hold: hold, Language: input.Language}
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
        let copied = !copiedOwner.IsEmpty && copiedOwner.Equals(ui.Actions.ClipboardOwner)
        actions.Add(
            Button(
                ui,
                copied ? "Copied": "Copy",
                () -> {
                    copiedOwner = ui.Actions.Copy(input.Words, 30000)
                }
            )
        )
        actions.Add(Button(ui, "Export", () -> Export(input), input.Busy || exporting))
        actions.Add(Container{FlexGrow: 1})
        if !input.FromWallet {
            actions.Add(
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
        if exportResult.Length > 0 {
            card.Add(Label(ui, exportResult, AppTheme.Type12, AppTheme.Body, ""))
        }
        return card
    }

    private func Export(input SeedPageInput) {
        guard let owner = input.Ui.Actions.window else {
            return
        }
        guard let data = phrase else {
            return
        }
        let request = [data.Words.Length]char
        Array.Copy(data.Words, request, request.Length)
        let current = generation
        try {
            let pending = owner.ShowFileDialogAsync(
                FileDialogKind.SaveFile,
                FileDialogOptions{
                    Title: input.Ui.Strings.Get("Export"),
                    InitialPath: Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                        "seed.txt"
                    )
                }
            )
            exporting = true
            exportResult = ""
            let keys = input.Session.Keys
            input.Ui.Actions.Run(ct -> CompleteExport(owner, pending, keys, request, current, ct), secret: request)
        } catch (failure Exception) {
            Array.Clear(request)
            exportResult = input.Ui.Strings.Explain(failure.Message)
        }
    }

    private async func CompleteExport(
        owner Window,
        pending Task[FileDialogResult],
        keys WalletKeys,
        request[]char,
        current int32,
        ct CancellationToken
    ) {
        var result = ""
        try {
            let chosen = await pending
            if chosen.Status == FileDialogStatus.Success && chosen.Paths.Count > 0 {
                await keys.ExportSeedAsync(chosen.Paths[0], request, ct)
                result = "Saved"
            } else if chosen.Status != FileDialogStatus.Cancelled {
                result = "File dialog unavailable"
            }
        } catch (failure Exception) {
            result = failure.Message
        } finally {
            Array.Clear(request)
        }
        let message = result
        owner.TryPost(
            () -> {
                if current == generation {
                    exporting = false
                    exportResult = input.Ui.Strings.Explain(message)
                    Rebuild()
                }
            }
        )
    }

    private func ReleaseCopy() {
        if let source = actions {
            if !copiedOwner.IsEmpty {
                source.ReleaseClipboard(copiedOwner)
            }
        }
        copiedOwner = ReadOnlyMemory[uint8].Empty
    }

    func Dispose() {
        generation++
        phrase?.Dispose()
        phrase = nil
        if let source = actions {
            source.ClipboardChanged -= clipboardChanged
        }
        ReleaseCopy()
        actions = nil
    }
}

data struct SeedPhraseInput {
    var Ui Presentation
    var Phrase SeedPhraseData?
    var Visible bool
    var Hold int32
    var Language string
}

class SeedPhrase : Cell[SeedPhraseInput] {
    protected override func Build(input SeedPhraseInput) Blob {
        let grid = Container{Gap: AppTheme.Space6, FlexShrink: 0}
        var line = Container{}
        guard let phrase = input.Phrase else {
            return grid
        }
        for offset in 0 ... phrase.Offsets.Length {
            if offset % 4 == 0 {
                line = Container{FlexDirection: FlexDirection.Row, Gap: AppTheme.Space6}
                grid.Add(line)
            }
            line.Add(Word(input, offset + 1, phrase.Indices[offset]))
        }
        if input.Visible {
            grid.Add(
                Label(input.Ui, input.Ui.Strings.Get("Keep these words secret"), AppTheme.Type12, AppTheme.Body, "")
            )
        }
        return grid
    }

    private func Word(input SeedPhraseInput, index int32, wordIndex int32) Blob {
        let ui = input.Ui
        let word = input.Visible && wordIndex >= 0 ? Bip39Wordlist.Words[wordIndex]: ""
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
