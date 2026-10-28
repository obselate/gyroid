package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Data
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Contacts
import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Send
import Gyroid.Settings
import Gyroid.Wallet
import Net.Codecrete.QrCodeGenerator
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.IO
import System.Linq
import System.Numerics
import System.Text
import System.Threading.Tasks

partial class WalletView {
    private var settingsTab string = "general"

    private var applyPending bool

    private var listenIssue string = ""

    private var programIssue string = ""

    private func Pinned(variable string) bool -> Environment.GetEnvironmentVariable("GYROID_" + variable) != nil

    private func SettingsPage() Blob {
        if seedFromWallet {
            if let words = seed {
                let phrase = PageContent(strings.Get("recovery phrase"), 860)
                phrase.Add(Phrase(words, Math.Min(width - 256, 860) - 42))
                return phrase
            }
        }
        let panel = PageContent(
            strings.Get("settings"),
            860,
            Tabs(
                "settings-tabs",
                "Settings",
                []NavigationItem{
                    NavigationItem{Id: "general", Label: strings.Get("General")},
                    NavigationItem{Id: "node", Label: strings.Get("Node")},
                    NavigationItem{Id: "wallet", Label: strings.Get("Wallet")}
                },
                settingsTab,
                id -> {
                    settingsTab = id
                    Rebuild()
                }
            )
        )
        guard let value = draft else {
            return panel
        }
        panel.Add(
            switch settingsTab {
                case "node": NodeSettings(value)
                case "wallet": WalletTab(value)
                default: GeneralSettings()
            }
        )
        let actions = List[Blob]()
        if !WalletAvailable() {
            actions.Add(Button("Back", () -> Back(), Working()))
        }
        if settingsTab != "general" {
            actions.Add(Container{FlexGrow: 1})
            actions.Add(
                Button(
                    "Save",
                    () -> SaveSettings(value),
                    Working() || !value.StartupDiffers(wallet.Settings) && value.LoadError.Length == 0,
                    true
                )
            )
        }
        if actions.Count > 0 {
            panel.Add(ActionRow(actions.ToArray()))
        }
        return panel
    }

    private func Setting(label string, control Blob) Blob -> Container{
        Gap: Theme.Read().ControlGap,
        FlexShrink: 0,
        AlignItems: AlignItems.FlexStart,
        Label(strings.Get(label), Theme.Read().LabelFontSize, body),
        control
    }

    private func Choice(
        key string,
        label string,
        options[]ToggleOption,
        selected string,
        disabled bool,
        chosen Action[string]
    ) Blob -> Setting(
        label,
        Cell.Mount[ToggleGroupInput, ToggleGroup](
            key,
            ToggleGroupInput{
                Items: options,
                SelectedIds: []string{selected},
                AccessibilityName: strings.Get(label),
                Disabled: disabled || Working(),
                OnChange: ids -> {
                    if ids.Length > 0 {
                        chosen(ids[0])
                    }
                }
            }
        )
    )

    private func Reading(label string, value string, color Color) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Baseline,
        Gap: 12,
        FlexShrink: 0,
        Accessibility: Accessibility{Name: strings.Get(label) + " " + value},
        Container{Width: 88, FlexShrink: 0, Label(strings.Get(label), 12, body, "")},
        Grow(Label(value, 13, color, ""))
    }

    private func GeneralSettings() Blob -> Container{
        Gap: 20,
        FlexShrink: 0,
        Choice(
            "language",
            "Language",
            []ToggleOption{
                ToggleOption{Id: "en", Label: strings.Get("English")},
                ToggleOption{Id: "zh-Hans", Label: strings.Get("中文")}
            },
            strings.Language,
            false,
            id -> SetLanguage(id)
        ),
        Choice(
            "auto-lock",
            "Auto-lock",
            []string{"0", "5", "15", "30", "60"}.Select(
                (minutes string) -> ToggleOption{
                    Id: minutes,
                    Label: if minutes == "0" {
                        strings.Get("Off")
                    } else {
                        minutes + " " + strings.Get("min")
                    }
                }
            )
                .ToArray(),
            wallet.Settings.AutoLockMinutes.ToString(),
            false,
            id -> Run(wallet.SaveAutoLockAsync(int32.Parse(id)))
        ),
        Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 12,
            FlexShrink: 0,
            ToggleSwitch{
                Checked: privacy,
                AccessibilityName: strings.Get("Privacy"),
                OnClick: () -> TogglePrivacy()
            }.Build(),
            Label(strings.Get("Privacy"), 14, ink)
        }
    }

    private func NodeSettings(value WalletSettings) Blob {
        let status = wallet.Node.Status
        let current = wallet.Settings
        let loaded = wallet.Snapshot.State != "Unloaded"
        let left = Container{
            Gap: 16,
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Choice(
                "node-mode",
                "Node mode",
                []ToggleOption{
                    ToggleOption{Id: "automatic", Label: strings.Get("Automatic")},
                    ToggleOption{Id: "manual", Label: strings.Get("Manual")}
                },
                current.NodeMode,
                Pinned("NODE_MODE"),
                id -> Run(wallet.SaveNodeModeAsync(id))
            ),
            Container{
                Gap: 8,
                FlexShrink: 0,
                Reading("Source", strings.Get(status.Source), ink),
                if Phase().Length > 0 {
                    Reading("State", PhaseText(), lime)
                } else if status.Running {
                    Reading("State", strings.Get("Running"), lime)
                } else {
                    Reading("State", strings.Get("Stopped"), body)
                },
                Reading(
                    "Version",
                    if status.Version.Length > 0 {
                        status.Version
                    } else {
                        "-"
                    },
                    ink
                ),
                Reading(
                    "Network",
                    strings.Get(
                        if status.Network == "testnet" {
                            "Testnet"
                        } else {
                            "Mainnet"
                        }
                    ),
                    ink
                ),
                Reading(
                    "Height",
                    if !status.Running {
                        "-"
                    } else if status.Syncing {
                        Count(status.Height) + " / " + Count(status.ChainHeight)
                    } else {
                        Count(status.Height)
                    },
                    ink
                ),
                Reading(
                    "Peers",
                    if status.Running {
                        Count(status.Peers)
                    } else {
                        "-"
                    },
                    ink
                ),
                Reading("Node URL", status.Endpoint, ink),
                Reading("Data", status.DataDirectory, ink)
            }
        }
        let actions = Container{FlexDirection: FlexDirection.Row, Gap: 8, FlexShrink: 0}
        if !status.Running && current.NodeMode == "automatic" && wallet.Node.Status.Progress.Length == 0 {
            actions.Add(Button("Start", () -> Run(wallet.StartNodeAsync()), Working()))
        }
        if status.Owned {
            actions.Add(Button("Stop", () -> Run(wallet.StopNodeAsync()), Working() || loaded))
            if current.NodeMode == "automatic" {
                actions.Add(Button("Restart", () -> Run(wallet.RestartNodeAsync()), Working() || loaded))
            }
        }
        left.Add(actions)
        let fields = Container{
            Gap: 16,
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Choice(
                "network",
                "Network",
                []ToggleOption{
                    ToggleOption{Id: "mainnet", Label: strings.Get("Mainnet")},
                    ToggleOption{Id: "testnet", Label: strings.Get("Testnet")}
                },
                value.Network,
                Pinned("NETWORK"),
                id -> {
                    value.Network = id
                    Rebuild()
                }
            ),
            Field(
                "Node URL",
                value.Endpoint,
                text -> {
                    value.Endpoint = text
                    Rebuild()
                },
                disabled: Pinned("ENDPOINT")
            ),
            PathField(
                "Data",
                value.DataDirectory,
                FileDialogKind.Folder,
                text -> {
                    value.DataDirectory = text
                },
                Pinned("DATA_DIR")
            ),
            PathField(
                "Node program",
                value.BinaryPath,
                FileDialogKind.OpenFile,
                text -> {
                    value.BinaryPath = text
                    programIssue = ""
                },
                Pinned("BINARY"),
                programIssue
            )
        }
        if status.Source != "External" && current.DataDirectory != current.DiscoveredDataDirectory {
            fields.Add(
                Field(
                    "P2P address",
                    value.ListenAddress,
                    text -> {
                        value.ListenAddress = text
                        listenIssue = ""
                        Rebuild()
                    },
                    issue: listenIssue,
                    disabled: Pinned("LISTEN")
                )
            )
        }
        return Container{FlexDirection: FlexDirection.Row, Gap: 24, MinHeight: 0, FlexShrink: 1, left, fields}
    }

    private func WalletTab(value WalletSettings) Blob {
        let tab = Container{
            Gap: 16,
            FlexShrink: 0,
            PathField(
                "Wallets",
                value.WalletDirectory,
                FileDialogKind.Folder,
                text -> {
                    value.WalletDirectory = text
                },
                Pinned("WALLET_DIR")
            )
        }
        if wallet.Snapshot.State == "Unlocked" && !wallet.Snapshot.ViewOnly {
            tab.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.FlexEnd,
                    Gap: 8,
                    FlexShrink: 0,
                    Grow(
                        Container{
                            MinWidth: 0,
                            Field(
                                "Password",
                                revealPassword,
                                text -> {
                                    revealPassword = text
                                    Rebuild()
                                },
                                () -> RevealSeed(),
                                true
                            )
                        }
                    ),
                    Button("Show phrase", () -> RevealSeed(), Working() || revealPassword.Length == 0, true),
                    Button("View keys", () -> ExportViewKeys(), Working() || revealPassword.Length == 0)
                }
            )
        }
        let actions = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, FlexShrink: 0}
        if wallet.Snapshot.State == "Unlocked" {
            tab.Add(
                Explainer(
                    "About view-only wallets",
                    "A view-only wallet sees incoming payments but cannot send",
                    []string{
                        "View keys show incoming payments only",
                        "A view-only wallet cannot send or sign",
                        "It cannot see spends, so balance may be high",
                        "Share view keys only with people you trust"
                    }
                )
            )
            tab.Add(
                Explainer(
                    "About rescan",
                    "Scan blocks the wallet has not checked yet",
                    []string{
                        "Finds new payments and spends",
                        "Then updates the balance",
                        "If the wallet is up to date, nothing changes",
                        "Nothing is sent and no coins move"
                    }
                )
            )
            actions.Add(Button("Sync", () -> Rescan(), Working()))
            if rescan?.IsCompleted == false {
                actions.Add(
                    Cell.Mount[SpinnerInput, Spinner](
                        if PlaybackActive() {
                            "rescan"
                        } else {
                            "rescan-idle"
                        },
                        SpinnerInput{Size: 16, Color: lime, Label: strings.Get("Scanning")}
                    )
                )
                actions.Add(Label(strings.Get("Scanning"), 13, body, ""))
            }
        }
        actions.Add(Container{FlexGrow: 1})
        if wallet.Snapshot.State == "Unlocked" && !wallet.Snapshot.ViewOnly {
            actions.Add(
                Button(
                    "Create view-only",
                    () -> {
                        ClearSecrets()
                        name = ""
                        error = ""
                        viewOnlyOpen = true
                        Rebuild()
                    },
                    Working()
                )
            )
        }
        if wallet.Snapshot.Page != "Welcome" {
            actions.Add(Button("Switch wallet", () -> Run(wallet.UnloadAsync()), Working()))
        }
        tab.Add(actions)
        return tab
    }

    private func SaveSettings(value WalletSettings) {
        listenIssue = WalletSettings.ListenError(value.ListenAddress)
        programIssue = if value.BinaryPath != wallet.Settings.BinaryPath && value.BinaryPath.Length > 0 {
            NodeDiscovery.ProgramError(value.BinaryPath)
        } else {
            ""
        }
        if listenIssue.Length > 0 || programIssue.Length > 0 {
            settingsTab = "node"
            Rebuild()
            return
        }
        if wallet.Snapshot.State != "Unloaded" && !applyPending {
            applyPending = true
            Rebuild()
            return
        }
        applyPending = false
        Run(
            wallet.ApplySettingsAsync(value.Copy()),
            () -> {
                draft = nil
                screen = ""
                LoadWallets()
            }
        )
    }

    private func ConfirmApply(value WalletSettings) Blob {
        let close Action = () -> {
            applyPending = false
            Rebuild()
        }
        return ModalDialog{
            Open: true,
            CreateRoot: DialogRoot,
            AccessibilityName: strings.Get("Apply settings"),
            Width: Math.Min(width - 48, 420),
            Content: Label(strings.Get("Apply settings"), 18, ink, ""),
            ConfirmText: strings.Get(
                if wallet.Snapshot.State == "Unlocked" {
                    "Lock and apply"
                } else {
                    "Apply"
                }
            ),
            CancelText: strings.Get("Cancel"),
            ConfirmDisabled: Working(),
            OnConfirm: () -> SaveSettings(value),
            OnCancel: close,
            OnClose: close
        }.Build()
    }

    private async func SetLanguage(language string) {
        strings.Language = language
        if let value = draft {
            value.Language = language
        }
        decoding.Clear()
        tray?.Update(TraySettings())
        Rebuild()
        try {
            await wallet.SaveLanguageAsync(language)
        } catch (failure Exception) {
            window?.TryPost(
                () -> {
                    error = "Language setting could not be saved"
                    Rebuild()
                }
            )
        }
    }

    private func PathField(
        label string,
        current string,
        kind FileDialogKind,
        changed Action[string],
        disabled bool,
        issue string = ""
    ) Blob {
        let input = Container{}
        input.Add(
            Field(
                label,
                current,
                text -> {
                    changed(text)
                    Rebuild()
                },
                issue: issue,
                disabled: disabled,
                labelled: false
            )
        )
        let row = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            AlignSelf: AlignSelf.Stretch,
            Gap: 8,
            FlexShrink: 0
        }
        row.Add(Grow(input))
        row.Add(
            Button(
                "Browse",
                () -> ChooseFile(
                    kind,
                    label,
                    if Path.IsPathFullyQualified(current) {
                        current
                    } else {
                        Home()
                    },
                    path -> {
                        changed(path)
                        Rebuild()
                    }
                ),
                disabled || Working()
            )
        )
        return Setting(label, row)
    }

    private var revealPassword string = ""

    private func RevealSeed() {
        if Working() || revealPassword.Length == 0 {
            return
        }
        let buffer = revealPassword.ToCharArray()
        revealPassword = ""
        seedFromWallet = true
        Run(wallet.Keys.RevealSeedAsync(buffer), nil, buffer)
    }

    private var rescan Task?

    private var filePassword string = ""

    private var viewKeys WalletViewKeys?

    private var viewKeysVisible bool

    private var viewOnlyOpen bool

    private var viewOnlyCreated string = ""

    private func Rescan() {
        let task = wallet.SyncAsync()
        rescan = task
        Run(task)
    }

    private func ExportViewKeys() {
        if Working() || revealPassword.Length == 0 {
            return
        }
        let buffer = revealPassword.ToCharArray()
        revealPassword = ""
        let task = wallet.Keys.ExportViewKeysAsync(buffer)
        Run(
            task,
            () -> {
                viewKeys = task.Result
            },
            buffer
        )
    }

    private func ViewKeysDialog(keys WalletViewKeys) Blob {
        let close Action = () -> {
            ClearSecrets()
            Rebuild()
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "view-keys",
            ModalDialog{
                Open: true,
                CreateRoot: DialogRoot,
                AccessibilityName: strings.Get("View keys"),
                Width: Math.Min(width - 48, 600),
                Header: Label(strings.Get("View keys"), 18, ink, ""),
                Content: Container{
                    Gap: 14,
                    ViewKey("Spend public key", keys.SpendPublic),
                    ViewKey("View private key", keys.ViewPrivate)
                },
                Footer: ActionRow(
                    []Blob{
                        Button(
                            viewKeysVisible ? "Hide": "Reveal",
                            () -> {
                                viewKeysVisible = !viewKeysVisible
                                Rebuild()
                            }
                        ),
                        Button("Close", close)
                    }
                ),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func ViewKey(label string, key[]char) Blob -> Accent(
        viewKeysVisible ? lime: edge,
        Copyable(label, String(key), Grouped(viewKeysVisible ? String(key): String('•', key.Length)), 30000)
    )

    private func ViewOnlyDialog() Blob {
        let close Action = () -> {
            ClearSecrets()
            name = ""
            Rebuild()
        }
        let content = Container{Gap: 14}
        let actions = List[Blob]{Button(viewOnlyCreated.Length > 0 ? "Close": "Cancel", close)}
        if viewOnlyCreated.Length > 0 {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    MaterialIcons.Create("check_circle", 18, lime),
                    Label(WalletName(viewOnlyCreated), 16, lime, "")
                }
            )
        } else {
            if error.Length > 0 {
                content.Add(Label(Explain(error), 13, pink, ""))
            }
            let submit Action = () -> CreateViewOnly()
            content.Add(
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
            content.Add(
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
            content.Add(
                Field(
                    "File password",
                    filePassword,
                    value -> {
                        filePassword = value
                        passwordIssue = ""
                        Rebuild()
                    },
                    submit,
                    true
                )
            )
            content.Add(
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
            actions.Add(
                Button(
                    "Create",
                    submit,
                    Working() || name.Trim().Length == 0 || password.Length == 0 || filePassword.Length == 0,
                    true
                )
            )
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "view-only",
            ModalDialog{
                Open: true,
                CreateRoot: DialogRoot,
                AccessibilityName: strings.Get("Create view-only"),
                Width: Math.Min(width - 48, 520),
                Header: Label(strings.Get("Create view-only"), 18, ink, ""),
                Content: content,
                Footer: ActionRow(actions.ToArray()),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func CreateViewOnly() {
        if Working() || name.Trim().Length == 0 || password.Length == 0 || filePassword.Length == 0 {
            return
        }
        passwordIssue = if password == filePassword {
            "View-only file password must differ from the wallet password"
        } else {
            WalletValidation.PasswordError(filePassword.ToCharArray(), confirmation.ToCharArray())
        }
        if passwordIssue.Length > 0 {
            Rebuild()
            return
        }
        let filename = WalletFile(name)
        let current = password.ToCharArray()
        let secret = filePassword.ToCharArray()
        Run(
            wallet.Keys.CreateViewOnlyAsync(filename, current, secret),
            () -> {
                ClearSecrets()
                name = ""
                viewOnlyOpen = true
                viewOnlyCreated = filename
            },
            current,
            secret
        )
    }

    private var draft WalletSettings?
}
