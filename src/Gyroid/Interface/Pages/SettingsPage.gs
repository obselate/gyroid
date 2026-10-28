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

partial class App {
    private var settingsTab string = "general"

    private var applyPending bool

    private var listenIssue string = ""

    private var programIssue string = ""

    private func Pinned(variable string) bool -> Environment.GetEnvironmentVariable("GYROID_" + variable) != nil

    private func SettingsPage() Blob {
        if seedFromWallet {
            if let words = seed {
                let phrase = ui.PageContent(ui.Strings.Get("recovery phrase"), 860)
                phrase.Add(Phrase(words, Math.Min(width - 256, 860) - 42))
                return phrase
            }
        }
        let panel = ui.PageContent(
            ui.Strings.Get("settings"),
            860,
            ui.Tabs(
                "settings-tabs",
                "Settings",
                []NavigationItem{
                    NavigationItem{Id: "general", Label: ui.Strings.Get("General")},
                    NavigationItem{Id: "node", Label: ui.Strings.Get("Node")},
                    NavigationItem{Id: "wallet", Label: ui.Strings.Get("Wallet")}
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
            actions.Add(ui.Button("Back", () -> Back(), ui.Working()))
        }
        if settingsTab != "general" {
            actions.Add(Container{FlexGrow: 1})
            actions.Add(
                ui.Button(
                    "Save",
                    () -> SaveSettings(value),
                    ui.Working() || !value.StartupDiffers(wallet.Settings) && value.LoadError.Length == 0,
                    true
                )
            )
        }
        if actions.Count > 0 {
            panel.Add(ui.ActionRow(actions.ToArray()))
        }
        return panel
    }

    private func Setting(label string, control Blob) Blob -> Container{
        Gap: Theme.Read().ControlGap,
        FlexShrink: 0,
        AlignItems: AlignItems.FlexStart,
        ui.Label(ui.Strings.Get(label), Theme.Read().LabelFontSize, ui.Body),
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
                AccessibilityName: ui.Strings.Get(label),
                Disabled: disabled || ui.Working(),
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
        Accessibility: Accessibility{Name: ui.Strings.Get(label) + " " + value},
        Container{Width: 88, FlexShrink: 0, ui.Label(ui.Strings.Get(label), 12, ui.Body, "")},
        ui.Grow(ui.Label(value, 13, color, ""))
    }

    private func GeneralSettings() Blob -> Container{
        Gap: 20,
        FlexShrink: 0,
        Choice(
            "language",
            "Language",
            []ToggleOption{
                ToggleOption{Id: "en", Label: ui.Strings.Get("English")},
                ToggleOption{Id: "zh-Hans", Label: ui.Strings.Get("中文")}
            },
            ui.Strings.Language,
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
                        ui.Strings.Get("Off")
                    } else {
                        minutes + " " + ui.Strings.Get("min")
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
                Checked: ui.Privacy,
                AccessibilityName: ui.Strings.Get("Privacy"),
                OnClick: () -> TogglePrivacy()
            }.Build(),
            ui.Label(ui.Strings.Get("Privacy"), 14, ui.Ink)
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
                    ToggleOption{Id: "automatic", Label: ui.Strings.Get("Automatic")},
                    ToggleOption{Id: "manual", Label: ui.Strings.Get("Manual")}
                },
                current.NodeMode,
                Pinned("NODE_MODE"),
                id -> Run(wallet.SaveNodeModeAsync(id))
            ),
            Container{
                Gap: 8,
                FlexShrink: 0,
                Reading("Source", ui.Strings.Get(status.Source), ui.Ink),
                if Phase().Length > 0 {
                    Reading("State", PhaseText(), ui.Lime)
                } else if status.Running {
                    Reading("State", ui.Strings.Get("Running"), ui.Lime)
                } else {
                    Reading("State", ui.Strings.Get("Stopped"), ui.Body)
                },
                Reading(
                    "Version",
                    if status.Version.Length > 0 {
                        status.Version
                    } else {
                        "-"
                    },
                    ui.Ink
                ),
                Reading(
                    "Network",
                    ui.Strings.Get(
                        if status.Network == "testnet" {
                            "Testnet"
                        } else {
                            "Mainnet"
                        }
                    ),
                    ui.Ink
                ),
                Reading(
                    "Height",
                    if !status.Running {
                        "-"
                    } else if status.Syncing {
                        ui.Count(status.Height) + " / " + ui.Count(status.ChainHeight)
                    } else {
                        ui.Count(status.Height)
                    },
                    ui.Ink
                ),
                Reading(
                    "Peers",
                    if status.Running {
                        ui.Count(status.Peers)
                    } else {
                        "-"
                    },
                    ui.Ink
                ),
                Reading("Node URL", status.Endpoint, ui.Ink),
                Reading("Data", status.DataDirectory, ui.Ink)
            }
        }
        let actions = Container{FlexDirection: FlexDirection.Row, Gap: 8, FlexShrink: 0}
        if !status.Running && current.NodeMode == "automatic" && wallet.Node.Status.Progress.Length == 0 {
            actions.Add(ui.Button("Start", () -> Run(wallet.StartNodeAsync()), ui.Working()))
        }
        if status.Owned {
            actions.Add(ui.Button("Stop", () -> Run(wallet.StopNodeAsync()), ui.Working() || loaded))
            if current.NodeMode == "automatic" {
                actions.Add(ui.Button("Restart", () -> Run(wallet.RestartNodeAsync()), ui.Working() || loaded))
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
                    ToggleOption{Id: "mainnet", Label: ui.Strings.Get("Mainnet")},
                    ToggleOption{Id: "testnet", Label: ui.Strings.Get("Testnet")}
                },
                value.Network,
                Pinned("NETWORK"),
                id -> {
                    value.Network = id
                    Rebuild()
                }
            ),
            ui.Field(
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
                ui.Field(
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
                    ui.Grow(
                        Container{
                            MinWidth: 0,
                            ui.Field(
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
                    ui.Button("Show phrase", () -> RevealSeed(), ui.Working() || revealPassword.Length == 0, true),
                    ui.Button("View keys", () -> ExportViewKeys(), ui.Working() || revealPassword.Length == 0)
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
            actions.Add(ui.Button("Sync", () -> Rescan(), ui.Working()))
            if rescan?.IsCompleted == false {
                actions.Add(
                    Cell.Mount[SpinnerInput, Spinner](
                        if PlaybackActive() {
                            "rescan"
                        } else {
                            "rescan-idle"
                        },
                        SpinnerInput{Size: 16, Color: ui.Lime, Label: ui.Strings.Get("Scanning")}
                    )
                )
                actions.Add(ui.Label(ui.Strings.Get("Scanning"), 13, ui.Body, ""))
            }
        }
        actions.Add(Container{FlexGrow: 1})
        if wallet.Snapshot.State == "Unlocked" && !wallet.Snapshot.ViewOnly {
            actions.Add(
                ui.Button(
                    "Create view-only",
                    () -> {
                        ClearSecrets()
                        name = ""
                        error = ""
                        viewOnlyOpen = true
                        Rebuild()
                    },
                    ui.Working()
                )
            )
        }
        if wallet.Snapshot.Page != "Welcome" {
            actions.Add(ui.Button("Switch wallet", () -> Run(wallet.UnloadAsync()), ui.Working()))
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
            CreateRoot: ui.DialogRoot,
            AccessibilityName: ui.Strings.Get("Apply settings"),
            Width: Math.Min(width - 48, 420),
            Content: ui.Label(ui.Strings.Get("Apply settings"), 18, ui.Ink, ""),
            ConfirmText: ui.Strings.Get(
                if wallet.Snapshot.State == "Unlocked" {
                    "Lock and apply"
                } else {
                    "Apply"
                }
            ),
            CancelText: ui.Strings.Get("Cancel"),
            ConfirmDisabled: ui.Working(),
            OnConfirm: () -> SaveSettings(value),
            OnCancel: close,
            OnClose: close
        }.Build()
    }

    private async func SetLanguage(language string) {
        ui.Strings.Language = language
        if let value = draft {
            value.Language = language
        }
        ui.Decoding.Clear()
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
            ui.Field(
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
        row.Add(ui.Grow(input))
        row.Add(
            ui.Button(
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
                disabled || ui.Working()
            )
        )
        return Setting(label, row)
    }

    private var revealPassword string = ""

    private func RevealSeed() {
        if ui.Working() || revealPassword.Length == 0 {
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
        if ui.Working() || revealPassword.Length == 0 {
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
                CreateRoot: ui.DialogRoot,
                AccessibilityName: ui.Strings.Get("View keys"),
                Width: Math.Min(width - 48, 600),
                Header: ui.Label(ui.Strings.Get("View keys"), 18, ui.Ink, ""),
                Content: Container{
                    Gap: 14,
                    ViewKey("Spend public key", keys.SpendPublic),
                    ViewKey("View private key", keys.ViewPrivate)
                },
                Footer: ui.ActionRow(
                    []Blob{
                        ui.Button(
                            viewKeysVisible ? "Hide": "Reveal",
                            () -> {
                                viewKeysVisible = !viewKeysVisible
                                Rebuild()
                            }
                        ),
                        ui.Button("Close", close)
                    }
                ),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func ViewKey(label string, key[]char) Blob -> ui.Accent(
        viewKeysVisible ? ui.Lime: ui.Edge,
        ui.Copyable(label, String(key), ui.Grouped(viewKeysVisible ? String(key): String('•', key.Length)), 30000)
    )

    private func ViewOnlyDialog() Blob {
        let close Action = () -> {
            ClearSecrets()
            name = ""
            Rebuild()
        }
        let content = Container{Gap: 14}
        let actions = List[Blob]{ui.Button(viewOnlyCreated.Length > 0 ? "Close": "Cancel", close)}
        if viewOnlyCreated.Length > 0 {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    MaterialIcons.Create("check_circle", 18, ui.Lime),
                    ui.Label(WalletName(viewOnlyCreated), 16, ui.Lime, "")
                }
            )
        } else {
            if error.Length > 0 {
                content.Add(ui.Label(ui.Strings.Explain(error), 13, ui.Pink, ""))
            }
            let submit Action = () -> CreateViewOnly()
            content.Add(
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
            content.Add(
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
            content.Add(
                ui.Field(
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
            actions.Add(
                ui.Button(
                    "Create",
                    submit,
                    ui.Working() || name.Trim().Length == 0 || password.Length == 0 || filePassword.Length == 0,
                    true
                )
            )
        }
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "view-only",
            ModalDialog{
                Open: true,
                CreateRoot: ui.DialogRoot,
                AccessibilityName: ui.Strings.Get("Create view-only"),
                Width: Math.Min(width - 48, 520),
                Header: ui.Label(ui.Strings.Get("Create view-only"), 18, ui.Ink, ""),
                Content: content,
                Footer: ui.ActionRow(actions.ToArray()),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func CreateViewOnly() {
        if ui.Working() || name.Trim().Length == 0 || password.Length == 0 || filePassword.Length == 0 {
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
