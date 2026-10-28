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

partial class WalletView {
    private func Home() string -> Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)

    private func NodeProgressCard() Blob {
        let card = Glass()
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
        let panel = PageContent(
            if wallets.Length > 0 {
                strings.Get("wallets")
            } else {
                strings.Get("new wallet")
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
                        BorderColor: rule,
                        BorderStartColor: lime,
                        BackgroundColor: surface,
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.FlexStart,
                        Disabled: Working(),
                        Hover: Style{BackgroundColor: rule, BorderColor: edge, BorderStartColor: limeHover},
                        Focus: theme.FocusStyle,
                        Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label},
                        OnClick: () -> Run(wallet.Library.ChooseWalletAsync(filename)),
                        Label(label, 14, ink)
                    }
                )
            }
            panel.Add(list)
        }
        panel.Add(
            ActionRow(
                []Blob{
                    SettingsButton(),
                    Container{FlexGrow: 1},
                    Button("Create", () -> Open("Create"), Working(), wallets.Length == 0),
                    Button("Import phrase", () -> Open("Phrase"), Working()),
                    Button("Import file", () -> ImportFile(), Working()),
                    Button("View-only", () -> Open("ViewOnly"), Working())
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
        Decode("page")
        Rebuild()
    }

    private func Back() {
        ClearSecrets()
        error = ""
        name = ""
        draft = nil
        screen = ""
        Decode("page")
        Rebuild()
    }

    private func ImportFile() {
        ChooseFile(FileDialogKind.OpenFile, "Import wallet", Home(), path -> Run(wallet.Library.ImportFileAsync(path)))
    }

    private func CreatePage(kind string) Blob {
        let panel = PageContent(
            strings.Get(
                switch kind {
                    case "Phrase": "import phrase"
                    case "ViewOnly": "import view-only"
                    default: "create wallet"
                }
            )
        )
        let submit Action = () -> CreateWallet(kind)
        panel.Add(
            Field(
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
                Field(
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
                Field(
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
                Field(
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
            Field(
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
            Field(
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
            ActionRow(
                []Blob{
                    Button("Back", () -> Back(), Working()),
                    Button(kind == "Create" ? "Create": "Import", submit, Working() || Incomplete(kind), true)
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
        if Working() || Incomplete(kind) {
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
        let panel = PageContent(WalletName(wallet.Settings.ActiveWallet), 520, SyncIndicator(16, 14))
        panel.Add(
            Field(
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
            ActionRow(
                []Blob{
                    SettingsButton(),
                    Container{FlexGrow: 1},
                    Button("Switch wallet", () -> Run(wallet.UnloadAsync()), Working()),
                    Button("Unlock", () -> Unlock(), Working() || password.Length == 0, true)
                }
            )
        )
        return panel
    }

    private func Unlock() {
        if Working() || password.Length == 0 {
            return
        }
        let buffer = password.ToCharArray()
        password = ""
        Run(wallet.UnlockAsync(buffer), nil, buffer)
    }

    private func SettingsButton() Blob -> IconButton{
        Icon: MaterialIcons.Create("settings", 16, body),
        Disabled: Working(),
        AccessibilityName: strings.Get("Settings"),
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
