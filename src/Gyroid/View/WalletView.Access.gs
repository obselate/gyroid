package Gyroid.View

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Node
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.IO
import System.Linq

partial class WalletView {
    private func Home() string -> Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)

    private func Phase() string {
        let status = wallet.Node.Status
        return if status.Phase.Length == 0 && status.Running && status.Peers == 0 {
            "Connecting"
        } else {
            status.Phase
        }
    }

    private func Preparing() bool -> wallet.Node.Status.Phase.Length > 0 && wallet.Node.Status.Phase != "ChainSync"

    private func PhaseName() string -> strings.Get(
        switch Phase() {
            case "Core": "Core download"
            case "ChainSync": "Syncing"
            default: Phase()
        }
    )

    private func PhasePercent() int32? {
        let status = wallet.Node.Status
        if status.Phase != "ChainSync" {
            return status.DownloadPercent
        }
        if status.ChainHeight == 0 {
            return nil
        }
        return Math.Min(100, int32(100 * (status.SyncProgress ?? status.Height) / status.ChainHeight))
    }

    private func PhaseText() string -> if let value = PhasePercent() {
        PhaseName() + " " + value.ToString() + "%"
    } else {
        PhaseName()
    }

    private func SyncIndicator(size float64, fontSize float64) Blob? {
        if Phase().Length == 0 {
            return nil
        }
        let row = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            FlexShrink: 0,
            Accessibility: Accessibility{Role: AccessibilityRole.ProgressBar, Name: PhaseText(), Busy: true}
        }
        guard let percent = PhasePercent() else {
            row.Add(
                Cell.Mount[SpinnerInput, Spinner](
                    if PlaybackActive() {
                        "sync"
                    } else {
                        "sync-idle"
                    },
                    SpinnerInput{Size: size, Color: lime, Label: PhaseName()}
                )
            )
            row.Add(Label(PhaseName(), fontSize, body, ""))
            return row
        }
        let stroke = Math.Max(2.0, size / 10)
        let center = size / 2
        let radius = center - stroke / 2
        let circle = PathBuilder(0, 0, size, size)
            .MoveTo(center, stroke / 2)
            .ArcTo(radius, radius, 0, false, true, center, size - stroke / 2)
            .ArcTo(radius, radius, 0, false, true, center, stroke / 2)
            .Build()
        row.Add(
            Container{
                Width: size,
                Height: size,
                FlexShrink: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                Shape{
                    Position: PositionType.Absolute,
                    Width: size,
                    Height: size,
                    Path: circle,
                    BorderWidth: stroke,
                    BorderColor: rule
                },
                Shape{
                    Position: PositionType.Absolute,
                    Width: size,
                    Height: size,
                    Path: circle,
                    BorderWidth: stroke,
                    BorderColor: lime,
                    StrokeEnd: percent / 100.0
                },
                MaterialIcons.Create(
                    switch wallet.Node.Status.Phase {
                        case "Checkpoints": "verified"
                        case "ChainSync": "sync"
                        default: "download"
                    },
                    size * 0.6,
                    lime
                )
            }
        )
        row.Add(Label(PhaseName(), fontSize, body, ""))
        row.Add(Label((percent.ToString() + "%").PadLeft(4), fontSize, lime, ""))
        return row
    }

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
}
