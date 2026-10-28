package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Contacts
import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Linq
import System.Numerics
import System.Text
import System.Threading.Tasks

partial class App {
    private func Home() string -> Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)

    private func NodeProgressCard() Blob {
        let card = ui.Glass()
        card.AlignItems = AlignItems.Center
        card.Padding = 32
        card.Add(SyncIndicator(28, 18) ?? Container{})
        return card
    }

    private func WelcomePage() Blob {
        if Preparing() {
            return NodeProgressCard()
        }
        let theme = Theme.Read()
        let panel = ui.PageContent(
            if wallets.Length > 0 {
                ui.Strings.Get("wallets")
            } else {
                ui.Strings.Get("new wallet")
            },
            520,
            SyncIndicator(16, 14)
        )
        if wallets.Length > 0 {
            let list = Container{
                Gap: 6,
                MinHeight: 0,
                FlexShrink: 1,
                OverflowY: Overflow.Scroll,
                ScrollbarY: theme.Scrollbar
            }
            for filename in wallets {
                let label = WalletName(filename)
                list.Add(
                    Goo
                        .Button{
                        Key: filename,
                        Height: 44,
                        FlexShrink: 0,
                        Padding: Edges{Left: 14, Right: 14},
                        BorderWidth: Edges{Left: 3, Top: 1, Right: 1, Bottom: 1},
                        BorderRadius: 4,
                        BorderColor: ui.Rule,
                        BorderStartColor: ui.Lime,
                        BackgroundColor: ui.Surface,
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.FlexStart,
                        Disabled: ui.Working(),
                        Hover: Style{BackgroundColor: ui.Rule, BorderColor: ui.Edge, BorderStartColor: ui.LimeHover},
                        Focus: theme.FocusStyle,
                        Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label},
                        OnClick: () -> Run(wallet.Library.ChooseWalletAsync(filename)),
                        ui.Label(label, 14, ui.Ink)
                    }
                )
            }
            panel.Add(list)
        }
        panel.Add(
            ui.ActionRow(
                []Blob{
                    SettingsButton(),
                    Container{FlexGrow: 1},
                    ui.Button("Create", () -> Open("Create"), ui.Working(), wallets.Length == 0),
                    ui.Button("Import phrase", () -> Open("Phrase"), ui.Working()),
                    ui.Button("Import file", () -> ImportFile(), ui.Working()),
                    ui.Button("View-only", () -> Open("ViewOnly"), ui.Working())
                }
            )
        )
        return panel
    }

    private func Open(target string) {
        ClearSecrets()
        error = ""
        name = ""
        screen = target
        if target == "Contacts" {
            LoadContacts()
        }
        ui.Decode("page")
        Rebuild()
    }

    private func Back() {
        ClearSecrets()
        error = ""
        name = ""
        draft = nil
        screen = ""
        ui.Decode("page")
        Rebuild()
    }

    private func ImportFile() {
        ChooseFile(FileDialogKind.OpenFile, "Import wallet", Home(), path -> Run(wallet.Library.ImportFileAsync(path)))
    }

    private func CreatePage(kind string) Blob {
        let panel = ui.PageContent(
            ui.Strings.Get(
                switch kind {
                    case "Phrase": "import phrase"
                    case "ViewOnly": "import view-only"
                    default: "create wallet"
                }
            )
        )
        let submit Action = () -> CreateWallet(kind)
        panel.Add(
            ui.Field(
                "Name",
                name,
                value -> {
                    name = value
                    Rebuild()
                },
                submit
            )
        )
        if kind == "Phrase" {
            panel.Add(
                ui.Field(
                    "Recovery phrase",
                    phrase,
                    value -> {
                        phrase = value
                        Rebuild()
                    },
                    submit,
                    true
                )
            )
        }
        if kind == "ViewOnly" {
            panel.Add(
                ui.Field(
                    "Spend public key",
                    spendKey,
                    value -> {
                        spendKey = value.Trim()
                        Rebuild()
                    },
                    submit
                )
            )
            panel.Add(
                ui.Field(
                    "View private key",
                    viewKey,
                    value -> {
                        viewKey = value.Trim()
                        Rebuild()
                    },
                    submit,
                    true
                )
            )
        }
        panel.Add(
            ui.Field(
                "Password",
                password,
                value -> {
                    password = value
                    passwordIssue = ""
                    Rebuild()
                },
                submit,
                true
            )
        )
        panel.Add(
            ui.Field(
                "Confirm",
                confirmation,
                value -> {
                    confirmation = value
                    passwordIssue = ""
                    Rebuild()
                },
                submit,
                true,
                passwordIssue
            )
        )
        panel.Add(
            ui.ActionRow(
                []Blob{
                    ui.Button("Back", () -> Back(), ui.Working()),
                    ui.Button(kind == "Create" ? "Create": "Import", submit, ui.Working() || Incomplete(kind), true)
                }
            )
        )
        return panel
    }

    private func Incomplete(kind string) bool -> name.Trim()
        .Length == 0 ||
        password.Length == 0 ||
        kind == "Phrase" &&
        phrase
        .Trim().Length == 0 || kind == "ViewOnly" && (spendKey.Length == 0 || viewKey.Length == 0)

    private func WalletFile(label string) string {
        let trimmed = label.Trim()
        return if trimmed.EndsWith(".wallet.dat", StringComparison.Ordinal) {
            trimmed
        } else {
            trimmed + ".wallet.dat"
        }
    }

    private func CreateWallet(kind string) {
        if ui.Working() || Incomplete(kind) {
            return
        }
        let secret = password.ToCharArray()
        let again = confirmation.ToCharArray()
        let issue = WalletValidation.PasswordError(secret, again)
        Array.Clear(again)
        if issue.Length > 0 {
            Array.Clear(secret)
            passwordIssue = issue
            Rebuild()
            return
        }
        let filename = WalletFile(name)
        if kind == "Phrase" {
            let words = phrase.ToCharArray()
            phrase = ""
            Run(wallet.ImportPhraseAsync(filename, words, secret), nil, secret, words)
        } else if kind == "ViewOnly" {
            let key = viewKey.ToCharArray()
            Run(wallet.ImportViewOnlyAsync(filename, spendKey.ToCharArray(), key, secret), nil, secret, key)
        } else {
            Run(wallet.CreateAsync(filename, secret), nil, secret)
        }
    }

    private func UnlockPage() Blob {
        if Preparing() {
            return NodeProgressCard()
        }
        let panel = ui.PageContent(WalletName(wallet.Settings.ActiveWallet), 520, SyncIndicator(16, 14))
        panel.Add(
            ui.Field(
                "Password",
                password,
                value -> {
                    password = value
                    Rebuild()
                },
                () -> Unlock(),
                true
            )
        )
        panel.Add(
            ui.ActionRow(
                []Blob{
                    SettingsButton(),
                    Container{FlexGrow: 1},
                    ui.Button("Switch wallet", () -> Run(wallet.UnloadAsync()), ui.Working()),
                    ui.Button("Unlock", () -> Unlock(), ui.Working() || password.Length == 0, true)
                }
            )
        )
        return panel
    }

    private func Unlock() {
        if ui.Working() || password.Length == 0 {
            return
        }
        let buffer = password.ToCharArray()
        password = ""
        Run(wallet.UnlockAsync(buffer), nil, buffer)
    }

    private func SettingsButton() Blob -> IconButton{
        Icon: MaterialIcons.Create("settings", 16, ui.Body),
        Disabled: ui.Working(),
        AccessibilityName: ui.Strings.Get("Settings"),
        OnClick: () -> Navigate("Settings")
    }.Build()

    private var spendKey string = ""

    private var viewKey string = ""

    private var wallets[]string

    private var name string = ""

    private var password string = ""

    private var confirmation string = ""

    private var passwordIssue string = ""

    private var phrase string = ""

    private func LoadWallets() {
        try {
            wallets = wallet.Library.ListWallets()
        } catch (failure WalletException) {
            wallets = Array.Empty[string]()
            error = failure.Message
        }
    }

    private func WalletName(filename string) string ->
    if filename.EndsWith(".wallet.dat", StringComparison.Ordinal) {
        filename.Substring(0, filename.Length - 11)
    } else {
        filename
    }
}
