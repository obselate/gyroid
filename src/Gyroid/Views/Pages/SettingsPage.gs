package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
import Gyroid.Views.SettingsParts
import System
import System.Collections.Generic
import System.Globalization
import System.IO
import System.Linq
import System.Threading
import System.Threading.Tasks

data struct SettingsPageInput {
    var Session WalletSession
    var Settings WalletSettings
    var Ui Presentation
    var Tools ToolsState
    var Window Window?
    var Snapshot WalletSnapshot
    var Node NodeStatus
    var Section string
    var Available bool
    var Privacy bool
    var Busy bool
    var Language string
    var Width float64
    var Height float64
    var MaximumScalePercent int32
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnSection Action[string]
    var OnLanguage Action[string]
    var OnPreference Action
    var OnRevealSeed Action[[]char]
    var OnNavigate Action[AppPage]
    var OnClose Action
}

data struct SettingsCompositionInput {
    var Section string
    var Available bool
    var State WalletState
    var ViewOnly bool
    var Language string
    var AutoLock int32
    var BackgroundLock int32
    var Privacy bool
    var Busy bool
    var Width float64
    var Height float64
}

data struct SettingsGeneralInput {
    var Language string
    var Background string
    var Scale int32
    var MaximumScale int32
    var Motion bool
    var Tray bool
    var Height float64
}

data struct SettingsNodeInput {
    var Language string
    var Mode string
    var Directory string
    var Height uint64
    var ChainHeight uint64
    var Peers uint64
    var Running bool
    var Syncing bool
    var Owned bool
    var Phase NodePhase
    var UpgradeDate string
    var UpgradeNotice string
    var UpgradeDeadline string
    var State WalletState
    var Busy bool
    var ViewHeight float64
}

data struct SettingsStartupInput {
    var Language string
    var Network string
    var Endpoint string
    var Data string
    var Wallets string
    var Binary string
    var Listen string
    var LoadError string
    var ListenVisible bool
    var State WalletState
    var Busy bool
    var Width float64
}

data struct SettingsWalletInput {
    var Language string
    var ScanHeight uint64
    var HasBalance bool
    var ViewOnly bool
    var Wallet string
    var Directory string
    var Busy bool
    var Height float64
}

data struct SettingsAdvancedInput {
    var Language string
    var Network string
    var Directory string
    var Endpoint string
    var ProcessId int32
    var NodeHeight uint64
    var Owned bool
    var Busy bool
    var Height float64
}

data struct SettingsDialogInput {
    var Language string
    var Wallet string = ""
    var Directory string
    var DefaultWallets string
    var Privacy bool
    var Busy bool
    var Width float64
}

data struct SettingsPurgeInput {
    var Size string
    var Unit string
    var Wallets int32
}

class SettingsRegionState {
    var Value WalletSettings?
    var Source WalletSettings?
    var Open bool
    let Advanced SettingsAdvancedState = SettingsAdvancedState()
}

class SettingsPage : Cell {
    private var state SettingsCompositionInput
    private var generalOwner SettingsGeneral?
    private var walletOwner SettingsWallet?
    private var current SettingsPageInput
    private var dialogs SettingsDialogs?
    private var advancedOwner SettingsAdvanced?
    private var nodeOwner SettingsNode?
    private var mountedSection string = ""
    private let startupDraft SettingsRegionState = SettingsRegionState()
    private let openDialog Action[string]
    private let openPurge Action[string, string, int32]
    private let refreshNodeData Action
    private let configureGeneral Action[SettingsGeneral]
    private let configureNode Action[SettingsNode]
    private let configureWallet Action[SettingsWallet]
    private let configureAdvanced Action[SettingsAdvanced]
    private let configureDialogs Action[SettingsDialogs]

    init() {
        openDialog = kind -> dialogs?.Open(kind)
        refreshNodeData = RefreshNodeData
        openPurge = (size, unit, wallets) -> dialogs?.OpenPurge(size, unit, wallets, refreshNodeData)
        configureGeneral = region -> {
            generalOwner = region
            region.Accept(current)
        }
        configureNode = region -> {
            nodeOwner = region
            region.Accept(current, startupDraft)
        }
        configureWallet = region -> {
            walletOwner = region
            region.Accept(current, openDialog)
        }
        configureAdvanced = region -> {
            advancedOwner = region
            region.Accept(current, openPurge, startupDraft.Advanced)
        }
        configureDialogs = region -> {
            dialogs = region
            region.Accept(current)
        }
    }

    func Accept(input SettingsPageInput) {
        let section = input.Section == "wallet" && input.Snapshot.State != WalletState.Unlocked ?
        "general": input.Section
        if section != mountedSection {
            mountedSection = section
            generalOwner = nil
            nodeOwner = nil
            walletOwner = nil
            advancedOwner = nil
        }
        current = input with{Settings = input.Session.Settings}
        generalOwner?.Accept(current)
        nodeOwner?.Accept(current, startupDraft)
        walletOwner?.Accept(current, openDialog)
        advancedOwner?.Accept(current, openPurge, startupDraft.Advanced)
        dialogs?.Accept(current)
        let next = SettingsCompositionInput{
            Section: input.Section,
            Available: input.Available,
            State: input.Snapshot.State,
            ViewOnly: input.Snapshot.ViewOnly,
            Language: input.Language,
            AutoLock: current.Settings.AutoLockMinutes,
            BackgroundLock: current.Settings.BackgroundLockMinutes,
            Privacy: current.Settings.Privacy,
            Busy: input.Busy,
            Width: input.Width,
            Height: input.Height
        }
        if next.Equals(state) {
            return
        }
        state = next
        Rebuild()
    }

    private func RefreshNodeData() {
        nodeOwner?.InvalidateDirectory()
        advancedOwner?.Refresh()
    }

    override func Build() Blob {
        let input = current
        let ui = input.Ui
        let sections = List[string]{"general", "security", "node"}
        if state.State == WalletState.Unlocked {
            sections.Add("wallet")
        }
        sections.Add("advanced")
        let section = sections.Contains(state.Section) ? state.Section: "general"
        let navWidth = state.Width < 1100 ? 132.0: 168.0
        let nav = WalletParts.Card(ui, AppTheme.Space8, AppTheme.Space2, AppTheme.Radius14)
        nav.Width = navWidth
        nav.FlexShrink = 0
        let entries = [sections.Count]NavigationItem
        for index in 0 ... sections.Count {
            let id = sections[index]
            entries[index] = NavigationItem{
                Id: id,
                Label: ui.Strings.Get(id),
                Content: MaterialIcons.Create(
                    switch id {
                        case "security": "lock"
                        case "node": "dns"
                        case "wallet": "account_balance_wallet"
                        case "advanced": "build"
                        default: "notes"
                    },
                    AppTheme.Icon18,
                    id == section ? AppTheme.Lime: AppTheme.Body
                )
            }
        }
        nav.Add(
            Navigation(
                ui,
                "settings-navigation",
                NavigationRailInput{
                    Items: entries,
                    SelectedId: section,
                    AccessibilityName: ui.Strings.Get("settings"),
                    Expanded: true,
                    ExpandedWidth: navWidth - AppTheme.Space16,
                    Height: Length.Auto,
                    ItemHeight: AppTheme.ControlRegular,
                    Gap: AppTheme.Space2,
                    OnSelect: input.OnSection
                }
            )
        )
        if !state.Available {
            nav.Add(Container{FlexGrow: 1})
            nav.Add(Button(ui, "Back", input.OnClose, state.Busy))
        }
        let header = WalletParts.Header(
            Label(
                ui,
                ui.Strings.Get(section) +
                    (section == "wallet" && state.ViewOnly ? " " + ui.Strings.Get("view-only"): ""),
                AppTheme.Type17,
                section == "wallet" && state.ViewOnly ? AppTheme.Blue: AppTheme.Ink,
                ""
            ),
            AppTheme.Space10
        )
        header.Padding = Edges{
            Top: AppTheme.Space6,
            Left: AppTheme.Space2,
            Right: AppTheme.Space2,
            Bottom: AppTheme.Space2
        }
        let pane = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MaxWidth: 820,
            MinHeight: 0,
            Gap: AppTheme.Space12,
            header
        }
        pane.Add(
            switch section {
                case "general": Cell.Mount[SettingsGeneral]("general", configureGeneral)
                case "security": Security(current)
                case "node": Cell.Mount[SettingsNode]("node", configureNode)
                case "wallet": Cell.Mount[SettingsWallet]("wallet", configureWallet)
                default: Cell.Mount[SettingsAdvanced]("advanced", configureAdvanced)
            }
        )
        let root = Container{
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space16,
            Width: Percent(100),
            MaxWidth: Math.Min(900, navWidth + 836),
            Height: Percent(100),
            MinHeight: 0,
            nav,
            pane
        }
        if state.Height > 640 {
            root.Height = Math.Clamp(state.Height * 0.65, 480.0, 740.0)
        }
        root.Add(Cell.Mount[SettingsDialogs]("settings-dialogs", configureDialogs))
        return root
    }

    private func Prefer(input SettingsPageInput, change Action[WalletSettings]) {
        input.Session.ApplyPreference(change)
        input.Ui.Actions.Run(ct -> input.Session.SavePreferencesAsync(ct), input.OnPreference)
    }

    private func Security(input SettingsPageInput) Blob {
        let ui = input.Ui
        let rowHeight = RowHeight(state.Height)
        let rows = List[Container]{
            WalletParts.Line(
                ui,
                rowHeight,
                "auto-lock",
                []Blob{
                    Segment(
                        ui,
                        "auto-lock",
                        []string{"5", "15", "60", "0"},
                        []string{"5m", "15m", "1h", "never"},
                        state.AutoLock.ToString(),
                        false,
                        id -> ui.Actions.Run(ct -> input.Session.SaveAutoLockAsync(int32.Parse(id), ct))
                    )
                }
            ),
            WalletParts.Line(
                ui,
                rowHeight,
                "lock in background after",
                []Blob{
                    Segment(
                        ui,
                        "lock in background after",
                        []string{"5", "15", "60", "0"},
                        []string{"5m", "15m", "1h", "never"},
                        state.BackgroundLock.ToString(),
                        false,
                        id -> Prefer(
                            input,
                            value -> {
                                value.BackgroundLockMinutes = int32.Parse(id)
                            }
                        )
                    )
                }
            ),
            WalletParts.Line(
                ui,
                rowHeight,
                "hide values on start",
                []Blob{
                    MaterialIcons.Create("visibility_off", AppTheme.Icon16, AppTheme.Dim),
                    Toggle(
                        input,
                        "hide values on start",
                        state.Privacy,
                        () -> ui.Actions.Run(ct -> input.Session.SavePrivacyAsync(!state.Privacy, ct))
                    )
                }
            )
        }
        if state.State == WalletState.Unlocked && !state.ViewOnly {
            rows.Add(
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "recovery phrase",
                    []Blob{
                        Label(ui, ui.Strings.Get("12 words"), AppTheme.Type14, AppTheme.Dim, ""),
                        Button(ui, "Show", () -> openDialog("phrase"), state.Busy),
                        Info(
                            input.Ui,
                            state.Language,
                            "phrase",
                            "About recovery phrase",
                            "The 12 words restore this wallet and can spend it"
                        )
                    }
                )
            )
        }
        return WalletParts.Rows(ui, rows.ToArray())
    }
}

class SettingsGeneral : Cell, IDisposable {
    private var state SettingsGeneralInput
    private var context SettingsPageInput
    private var rowHeight float64
    private var generation int32
    private var issue string = ""

    func Accept(input SettingsPageInput) {
        context = input
        let settings = input.Settings
        rowHeight = RowHeight(input.Height)
        let next = SettingsGeneralInput{
            Language: input.Language,
            Background: settings.Background,
            Scale: settings.UiScalePercent,
            MaximumScale: input.MaximumScalePercent,
            Motion: settings.ReduceMotion,
            Tray: settings.StartInTray,
            Height: input.Height
        }
        if next.Equals(state) {
            return
        }
        state = next
        Rebuild()
    }

    override func Build() Blob {
        let content = Container{MinHeight: 0, Gap: AppTheme.Space8, General(context)}
        if issue.Length > 0 {
            content.Add(Label(context.Ui, context.Ui.Strings.Explain(issue), AppTheme.Type13, AppTheme.Pink, ""))
        }
        return content
    }

    private func Prefer(input SettingsPageInput, change Action[WalletSettings]) {
        guard let owner = input.Window else {
            return
        }
        generation++
        let request = generation
        let session = input.Session
        session.ApplyPreference(change)
        input.Ui.Actions.Background(_ -> SavePreference(session, owner, input.OnPreference, request))
    }

    private async func SavePreference(session WalletSession, owner Window, saved Action, request int32) {
        var error = ""
        try {
            await session.SavePreferencesAsync(CancellationToken.None)
        } catch (failure Exception) {
            error = failure.Message
        }
        owner.TryPost(
            () -> {
                if error.Length == 0 {
                    saved.Invoke()
                }
                if generation != request {
                    return
                }
                issue = error
                Rebuild()
            }
        )
    }

    func Dispose() {
        generation++
    }

    private func General(input SettingsPageInput) Blob {
        let ui = input.Ui
        return WalletParts.Rows(
            ui,
            []Container{
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "language",
                    []Blob{
                        Segment(
                            ui,
                            "language",
                            []string{"en", "zh-Hans"},
                            []string{"English", "简体中文"},
                            state.Language,
                            false,
                            input.OnLanguage
                        )
                    }
                ),
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "background",
                    []Blob{
                        Segment(
                            ui,
                            "background",
                            []string{"gyroid", "glyphs", "off"},
                            []string{"gyroid", "glyphs", "off"},
                            state.Background,
                            false,
                            id -> Prefer(
                                input,
                                value -> {
                                    value.Background = id
                                }
                            )
                        )
                    }
                ),
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "UI scale",
                    []Blob{
                        Segment(
                            ui,
                            "UI scale",
                            []string{"100", "125", "150", "175", "200"},
                            []string{"100% (system)", "125%", "150%", "175%", "200%"},
                            state.Scale.ToString(CultureInfo.InvariantCulture),
                            false,
                            id -> Prefer(
                                input,
                                value -> {
                                    value.UiScalePercent = Int32.Parse(id, CultureInfo.InvariantCulture)
                                }
                            ),
                            (state.MaximumScale - 100) / 25 + 1
                        )
                    }
                ),
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "reduce motion",
                    []Blob{
                        Toggle(
                            input,
                            "reduce motion",
                            state.Motion,
                            () -> {
                                let enabled = !state.Motion
                                Prefer(input, value -> value.ReduceMotion = enabled)
                            }
                        )
                    }
                ),
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "start in tray",
                    []Blob{
                        Toggle(
                            input,
                            "start in tray",
                            state.Tray,
                            () -> {
                                let enabled = !state.Tray
                                Prefer(input, value -> value.StartInTray = enabled)
                            }
                        )
                    }
                )
            }
        )
    }
}

class SettingsNode : Cell, IDisposable {
    private var state SettingsNodeInput
    private var context SettingsPageInput
    private var rowHeight float64
    private var draft SettingsRegionState
    private var startupOwner SettingsStartup?
    private var directoryRead string = ""
    private var directoryExists bool
    private var generation int32
    private let configureStartup Action[SettingsStartup]

    init() {
        configureStartup = region -> {
            startupOwner = region
            region.Accept(context, draft)
        }
    }

    func Accept(input SettingsPageInput, draft SettingsRegionState) {
        context = input
        this.draft = draft
        startupOwner?.Accept(input, draft)
        rowHeight = RowHeight(input.Height)
        let settings = input.Settings
        let status = input.Node
        let next = SettingsNodeInput{
            Language: input.Language,
            Mode: settings.NodeMode,
            Directory: status.DataDirectory.Length > 0 ? status.DataDirectory: settings.DataDirectory,
            Height: status.Height,
            ChainHeight: status.ChainHeight,
            Peers: status.Peers,
            Running: status.Running,
            Syncing: status.Syncing,
            Owned: status.Owned,
            Phase: status.Phase,
            UpgradeDate: status.UpgradeDate,
            UpgradeNotice: status.UpgradeNotice,
            UpgradeDeadline: status.UpgradeDeadline,
            State: input.Snapshot.State,
            Busy: input.Busy,
            ViewHeight: input.Height
        }
        if input.Section == "node" && next.Directory != directoryRead {
            generation++
            directoryRead = next.Directory
            directoryExists = false
            let request = generation
            let path = next.Directory
            let owner = input.Window
            let session = input.Session
            go ReadDirectory(session, path, owner, request)
        }
        if next.Equals(state) {
            return
        }
        state = next
        Rebuild()
    }

    override func Build() Blob -> NodeSection(context)

    private func ReadDirectory(session WalletSession, path string, owner Window?, request int32) {
        var exists = false
        try {
            exists = session.SettingsDirectoryExists(path)
        } catch (failure Exception) { }
        owner?.TryPost(
            () -> {
                if request == generation && directoryExists != exists {
                    directoryExists = exists
                    Rebuild()
                }
            }
        )
    }

    func InvalidateDirectory() {
        generation++
        directoryRead = ""
        directoryExists = false
        Rebuild()
    }

    func Dispose() {
        generation++
    }

    private func NodeSection(input SettingsPageInput) Blob {
        let ui = input.Ui
        let automatic = state.Mode == "automatic"
        let height = List[Blob]()
        if state.Running {
            let heightText = Count(state.Height)
            height.Add(Value(ui, "height", ui.Strings.Get("Height") + " " + heightText, heightText, 14, AppTheme.Mint))
            if state.Syncing {
                height.Add(Label(ui, "/ " + Count(state.ChainHeight), AppTheme.Type14, AppTheme.Dim, ""))
            }
            height.Add(
                Label(
                    ui,
                    Count(state.Peers) + " " + ui.Strings.Get(state.Peers == 1 ? "peer": "peers"),
                    AppTheme.Type14,
                    AppTheme.Dim,
                    ""
                )
            )
        } else {
            height.Add(Label(ui, ui.Strings.Get("Stopped"), AppTheme.Type14, AppTheme.Dim, ""))
            if automatic && state.Phase == NodePhase.None {
                height.Add(
                    Button(ui, "Start", () -> ui.Actions.Run(ct -> input.Session.StartNodeAsync(ct)), state.Busy)
                )
            }
        }
        let core = List[Blob]{Label(ui, "blocknet-core", AppTheme.Type14, AppTheme.Ink, "")}
        if state.Owned && automatic {
            core.Add(
                Button(
                    ui,
                    "Restart",
                    () -> ui.Actions.Run(ct -> input.Session.RestartNodeAsync(ct)),
                    state.Busy || state.State != WalletState.Unloaded
                )
            )
        }
        let upgrade = List[Blob]{Label(ui, Count(CoreRelease.UpgradeHeight), AppTheme.Type14, AppTheme.Orange, "")}
        if state.UpgradeDate.Length > 0 {
            upgrade.Add(Label(ui, state.UpgradeDate, AppTheme.Type14, AppTheme.Dim, ""))
        }
        if state.UpgradeNotice.Length > 0 {
            upgrade.Add(
                Info(
                    input.Ui,
                    state.Language,
                    "upgrade",
                    "Network upgrade",
                    ui.Strings.UpgradeInstructions(state.UpgradeDate, state.UpgradeDeadline)
                )
            )
        }
        let folder = state.Directory
        let list = WalletParts.Rows(
            ui,
            []Container{
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "mode",
                    []Blob{
                        Segment(
                            ui,
                            "mode",
                            []string{"automatic", "manual"},
                            []string{"automatic", "existing node"},
                            state.Mode,
                            Pinned("NODE_MODE") || state.Busy,
                            id -> ui.Actions.Run(ct -> input.Session.SaveNodeModeAsync(id, ct))
                        ),
                        Info(
                            input.Ui,
                            state.Language,
                            "mode",
                            "About node mode",
                            "Automatic runs the installed core. Existing node uses a node you run"
                        )
                    }
                ),
                WalletParts.Line(ui, rowHeight, "height", height.ToArray()),
                WalletParts.Line(ui, rowHeight, "core", core.ToArray()),
                WalletParts.Line(ui, rowHeight, "network upgrade", upgrade.ToArray()),
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "data folder",
                    []Blob{
                        Label(ui, Shorten(folder), AppTheme.Type14, AppTheme.Dim, ""),
                        Button(
                            ui,
                            "Open",
                            () -> ui.Actions.Run(ct -> input.Session.OpenSettingsDirectoryAsync(folder, ct)),
                            state.Busy || !directoryExists
                        )
                    }
                )
            }
        )
        let startup = Goo
            .Button{
            BasedOn: AppTheme.ListRowStyle,
            Height: 52,
            FlexShrink: 0,
            BorderWidth: Edges{Top: AppTheme.Border1, Bottom: AppTheme.Border0},
            BorderColor: AppTheme.FaintRule,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get("startup"),
                Expanded: draft.Open
            },
            OnClick: () -> {
                draft.Open = !draft.Open
            },
            Grow(Label(ui, ui.Strings.Get("startup"), AppTheme.Type14, AppTheme.Body, "")),
            MaterialIcons.Create(draft.Open ? "expand_less": "expand_more", AppTheme.Icon18, AppTheme.Dim)
        }
        WidgetKeyBindings.BindActivation(startup)
        let content = Container{MinHeight: 0, Gap: AppTheme.Space8}
        list.Display = draft.Open ? Display.None: Display.Flex
        content.Add(list)
        let startupPane = Container{
            Display: draft.Open ? Display.Flex: Display.None,
            MinHeight: 0,
            Cell.Mount[SettingsStartup]("startup", configureStartup)
        }
        content.Add(startup)
        content.Add(startupPane)
        return content
    }

    private func Shorten(path string) string -> if path.StartsWith(Home(), StringComparison.Ordinal) &&
        Home().Length > 1 {
        "~" + path.Substring(Home().Length)
    } else {
        path
    }
}

class SettingsStartup : Cell, IDisposable {
    private var state SettingsStartupInput
    private var context SettingsPageInput
    private var draft SettingsRegionState
    private var generation int32
    private var validated WalletSettings?
    private var validationIssue string = ""
    private var lifetime CancellationTokenSource?

    func Accept(input SettingsPageInput, draft SettingsRegionState) {
        context = input
        this.draft = draft
        let settings = input.Settings
        if lifetime == nil {
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(input.Window?.Closed ?? CancellationToken.None)
        }
        if draft.Source?.StartupDiffers(settings) != false {
            generation++
            validated = nil
            validationIssue = ""
            draft.Source = settings
            draft.Value = settings.Copy()
        }
        let next = SettingsStartupInput{
            Language: input.Language,
            Network: settings.Network,
            Endpoint: settings.Endpoint,
            Data: settings.DataDirectory,
            Wallets: settings.WalletDirectory,
            Binary: settings.BinaryPath,
            Listen: settings.ListenAddress,
            LoadError: settings.LoadError,
            ListenVisible: input
                .Node
                .Source != "External" &&
                settings.DataDirectory != settings.DiscoveredDataDirectory,
            State: input.Snapshot.State,
            Busy: input.Busy,
            Width: input.Width
        }
        if next.Equals(state) {
            return
        }
        state = next
        Rebuild()
    }

    override func Build() Blob {
        guard let value = draft.Value else {
            return Container{}
        }
        let content = Container{MinHeight: 0, Gap: AppTheme.Space8, Startup(context, value)}
        if validationIssue.Length > 0 {
            content.Add(
                Label(context.Ui, context.Ui.Strings.Explain(validationIssue), AppTheme.Type13, AppTheme.Pink, "")
            )
        }
        if validated != nil {
            content.Add(ConfirmApply(context))
        }
        return content
    }

    private func Startup(input SettingsPageInput, value WalletSettings) Blob {
        let ui = input.Ui
        let form = WalletForm(
            ui,
            !state.Busy &&
                (
                value.Network != state.Network ||
                    value.Endpoint != state.Endpoint ||
                    value.DataDirectory != state.Data ||
                    value.WalletDirectory != state.Wallets ||
                    value.BinaryPath != state.Binary ||
                    value.ListenAddress != state.Listen ||
                    state
                    .LoadError
                    .Length > 0
            ),
            () -> SaveSettings(input),
            []string{}
        )
        let fields = Container{
            Gap: AppTheme.Space8,
            MinHeight: 0,
            Segment(
                ui,
                "Network",
                []string{"mainnet", "testnet"},
                []string{"Mainnet", "Testnet"},
                value.Network,
                Pinned("NETWORK") || state.Busy,
                id -> {
                    value.Network = id
                    Rebuild()
                }
            ),
            form.Row(
                "Node URL",
                value.Endpoint,
                text -> {
                    value.Endpoint = text
                    Rebuild()
                },
                disabled: Pinned("ENDPOINT")
            ),
            PathRow(
                input,
                form,
                "Data",
                value.DataDirectory,
                FileDialogKind.Folder,
                text -> value.DataDirectory = text,
                "DATA_DIR"
            ),
            PathRow(
                input,
                form,
                "Wallets",
                value.WalletDirectory,
                FileDialogKind.Folder,
                text -> value.WalletDirectory = text,
                "WALLET_DIR"
            ),
            PathRow(
                input,
                form,
                "Node program",
                value.BinaryPath,
                FileDialogKind.OpenFile,
                text -> value.BinaryPath = text,
                "BINARY"
            )
        }
        if state.ListenVisible {
            fields.Add(
                form.Row(
                    "P2P address",
                    value.ListenAddress,
                    text -> {
                        value.ListenAddress = text
                        Rebuild()
                    },
                    disabled: Pinned("LISTEN")
                )
            )
        }
        fields.Add(ActionRow([]Blob{Button(ui, "Save", form.Submit, !form.CanSubmit, true)}))
        return fields
    }

    private func PathRow(
        input SettingsPageInput,
        form WalletForm,
        label string,
        value string,
        kind FileDialogKind,
        changed Action[string],
        variable string
    ) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.FlexStart,
        Gap: AppTheme.Space8,
        Grow(
            form.Row(
                label,
                value,
                text -> {
                    changed.Invoke(text)
                    Rebuild()
                },
                disabled: Pinned(variable)
            )
        ),
        Button(
            input.Ui,
            "Browse",
            () -> input.ChooseFile.Invoke(
                kind,
                label,
                Path.IsPathFullyQualified(value) ? value: Home(),
                text -> {
                    changed.Invoke(text)
                    Rebuild()
                }
            ),
            state.Busy || Pinned(variable)
        )
    }

    private func SaveSettings(input SettingsPageInput) {
        guard let value = draft.Value, let owner = input.Window else {
            return
        }
        if let next = validated {
            validated = nil
            input.Ui.Actions.Run(ct -> input.Session.ApplySettingsAsync(next, ct), input.OnClose)
            return
        }
        generation++
        let request = generation
        let next = value.Copy()
        let current = input.Settings.Copy()
        let token = lifetime?.Token ?? CancellationToken.None
        go ValidateSettings(next, current, owner, request, token)
    }

    private func ValidateSettings(
        value WalletSettings,
        current WalletSettings,
        owner Window,
        request int32,
        token CancellationToken
    ) {
        var result WalletSettings?
        var issue = ""
        try {
            token.ThrowIfCancellationRequested()
            result = SettingsValidation.Prepare(value, current)
            token.ThrowIfCancellationRequested()
        } catch (cancelled OperationCanceledException) {
            return
        } catch (failure Exception) {
            issue = failure.Message
        }
        owner.TryPost(
            () -> {
                guard let edited = draft.Value else {
                    return
                }
                if request != generation || value.StartupDiffers(edited) {
                    return
                }
                validationIssue = issue
                validated = result
                if validated != nil && state.State == WalletState.Unloaded {
                    SaveSettings(context)
                }
                Rebuild()
            }
        )
    }

    func Dispose() {
        generation++
        lifetime?.Cancel()
        lifetime?.Dispose()
    }

    private func ConfirmApply(input SettingsPageInput) Blob {
        let ui = input.Ui
        let close Action = () -> {
            validated = nil
            Rebuild()
        }
        return WalletParts.Modal(
            ui,
            "apply",
            AppTheme.Dialog with{
                Open = true,
                Preset = ModalDialogPreset.Confirm,
                AccessibilityName = ui.Strings.Get("Apply settings"),
                Width = Math.Min(state.Width - 48, 440),
                Content = Container{
                    Gap: AppTheme.Space10,
                    Label(ui, ui.Strings.Get("Apply settings"), AppTheme.Type17, AppTheme.Ink, ""),
                    Label(
                        ui,
                        ui.Strings.Get("The wallet locks and the node reconnects"),
                        AppTheme.Type13,
                        AppTheme.Body,
                        ""
                    )
                },
                ConfirmText = ui.Strings.Get(
                    if state.State == WalletState.Unlocked {
                        "Lock and apply"
                    } else {
                        "Apply"
                    }
                ),
                CancelText = ui.Strings.Get("Cancel"),
                ConfirmDisabled = state.Busy,
                OnConfirm = () -> SaveSettings(input),
                OnCancel = close,
                OnClose = close
            }
        )
    }
}

class SettingsWallet : Cell, IDisposable {
    private var state SettingsWalletInput
    private var context SettingsPageInput
    private var rowHeight float64
    private var syncing bool
    private var issue string = ""
    private var generation int32
    private var showDialog Action[string]

    func Accept(input SettingsPageInput, showDialog Action[string]) {
        context = input
        this.showDialog = showDialog
        if state.Wallet != input.Settings.ActiveWallet {
            generation++
            syncing = false
        }
        rowHeight = RowHeight(input.Height)
        let settings = input.Settings
        let next = SettingsWalletInput{
            Language: input.Language,
            ScanHeight: input.Snapshot.Balance?.ScanHeight ?? uint64(0),
            HasBalance: input.Snapshot.Balance != nil,
            ViewOnly: input.Snapshot.ViewOnly,
            Wallet: settings.ActiveWallet,
            Directory: settings.WalletDirectory,
            Busy: input.Busy,
            Height: input.Height
        }
        if next.Equals(state) {
            return
        }
        state = next
        Rebuild()
    }

    override func Build() Blob {
        let pane = Container{MinHeight: 0, Gap: AppTheme.Space12}
        WalletSection(context, pane)
        if issue.Length > 0 {
            pane.Add(Label(context.Ui, context.Ui.Strings.Explain(issue), AppTheme.Type13, AppTheme.Pink, ""))
        }
        return pane
    }

    private func StartSync(input SettingsPageInput) {
        guard let owner = input.Window else {
            return
        }
        if syncing {
            return
        }
        syncing = true
        generation++
        Rebuild()
        let request = generation
        let session = input.Session
        input.Ui.Actions.Run(ct -> Sync(session, owner, request, ct))
    }

    private async func Sync(session WalletSession, owner Window, request int32, token CancellationToken) {
        var error = ""
        try {
            await session.SyncAsync(token)
        } catch (failure Exception) {
            if failure is OperationCanceledException {
                throw failure
            }
            error = failure.Message
        }
        owner.TryPost(
            () -> {
                if request != generation {
                    return
                }
                syncing = false
                issue = error
                Rebuild()
            }
        )
    }

    func Dispose() {
        generation++
    }

    private func WalletSection(input SettingsPageInput, pane Container) {
        let ui = input.Ui
        let scan = List[Blob]()
        if state.HasBalance {
            let scanText = Count(state.ScanHeight)
            scan.Add(
                Value(
                    ui,
                    "scan",
                    ui.Strings.Get("scan height") + " " + scanText,
                    scanText,
                    AppTheme.Type14,
                    AppTheme.Ink
                )
            )
        }
        if syncing {
            scan.Add(
                Cell.Mount[SpinnerInput, Spinner](
                    "rescan-spinner",
                    SpinnerInput{Size: AppTheme.Icon16, Color: AppTheme.Lime, Label: ui.Strings.Get("Syncing")}
                )
            )
        }
        scan.Add(Button(ui, "Sync", () -> StartSync(input), state.Busy || syncing))
        scan.Add(Info(input.Ui, state.Language, "rescan", "About sync", "Scan blocks the wallet has not checked yet"))
        let rows = List[Container]{
            WalletParts.Line(ui, rowHeight, "scan height", scan.ToArray()),
            WalletParts.Line(
                ui,
                rowHeight,
                "output health",
                []Blob{
                    Button(
                        ui,
                        "Check",
                        () -> {
                            input.Tools.Tab = "health"
                            input.OnNavigate.Invoke(AppPage.Tools)
                        },
                        state.Busy
                    ),
                    Info(
                        input.Ui,
                        state.Language,
                        "health",
                        "About output health",
                        "Checks every wallet output against the main chain. Repair removes outputs whose block or transaction is no longer on it"
                    )
                }
            )
        }
        if !state.ViewOnly {
            rows.Add(
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "view key",
                    []Blob{
                        Label(ui, "••••••••", AppTheme.Type14, AppTheme.Dim, ""),
                        Button(ui, "Show", () -> showDialog("view-key"), state.Busy)
                    }
                )
            )
            rows.Add(
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "keys file",
                    []Blob{Button(ui, "Export…", () -> showDialog("view-key"), state.Busy)}
                )
            )
            rows.Add(
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "view-only wallet",
                    []Blob{
                        Button(ui, "Create…", () -> showDialog("view-only"), state.Busy),
                        Info(
                            input.Ui,
                            state.Language,
                            "view-only-info",
                            "About view-only wallets",
                            "A view-only wallet sees incoming payments but cannot send"
                        )
                    }
                )
            )
        }
        rows.Add(
            WalletParts.Line(
                ui,
                rowHeight,
                "wallet file",
                []Blob{
                    Label(ui, Tail(Path.Combine(state.Directory, state.Wallet)), AppTheme.Type14, AppTheme.Dim, ""),
                    Button(ui, "Switch wallet", () -> input.OnNavigate(AppPage.Library), state.Busy)
                }
            )
        )
        pane.Add(WalletParts.Rows(ui, rows.ToArray()))
        if state.ViewOnly {
            let note = WalletParts.Card(ui, AppTheme.Space16, AppTheme.Space10, AppTheme.Radius14)
            note.FlexDirection = FlexDirection.Row
            note.AlignItems = AlignItems.Center
            note.FlexShrink = 0
            note.Add(MaterialIcons.Create("warning", AppTheme.Icon16, AppTheme.Body))
            note.Add(
                Label(
                    ui,
                    ui.Strings.Get("Balance counts received coins. Spends need the spend key"),
                    AppTheme.Type13,
                    AppTheme.Ink,
                    ""
                )
            )
            pane.Add(note)
        }
    }
}

class SettingsAdvancedState {
    var state SettingsAdvancedInput
    var loadIssue string = ""
    var chainLoaded bool
    var dataSize int64 = -1
    var sizeText string = "-"
    var sizeUnit string = "GB"
    var freeSpace int64
    var dataWallets int32
    var trustedCheckpoint uint64
    var localCheckpoint uint64
    var autoSave bool?
    var certificate ChainCertificate?
}

class SettingsAdvanced : Cell, IDisposable {
    private var data SettingsAdvancedState
    private var context SettingsPageInput
    private var openPurge Action[string, string, int32]
    private var lifetime CancellationTokenSource?
    private var checkpointGeneration int32
    private var generation int32
    private var certifyGeneration int32

    func Accept(input SettingsPageInput, openPurge Action[string, string, int32], data SettingsAdvancedState) {
        this.data = data
        context = input
        this.openPurge = openPurge
        let settings = input.Settings
        if lifetime == nil {
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(input.Window?.Closed ?? CancellationToken.None)
        }
        if data
            .state
            .Network != settings.Network ||
            data
            .state
            .Directory != settings.DataDirectory ||
            data
            .state
            .Endpoint != settings.Endpoint ||
            data
            .state
            .ProcessId != settings
            .OwnedProcessId {
            lifetime?.Cancel()
            lifetime?.Dispose()
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(input.Window?.Closed ?? CancellationToken.None)
            generation++
            certifyGeneration++
            checkpointGeneration++
            data.chainLoaded = false
            data.dataSize = -1
            data.sizeText = "-"
            data.freeSpace = 0
            data.dataWallets = 0
            data.trustedCheckpoint = 0
            data.localCheckpoint = 0
            data.autoSave = nil
            data.certificate = nil
            data.loadIssue = ""
        }
        if input.Section == "advanced" && !data.chainLoaded {
            generation++
            data.chainLoaded = true
            let request = generation
            let token = lifetime?.Token ?? CancellationToken.None
            let session = input.Session
            let value = settings.Copy()
            let owner = input.Window
            go LoadChain(session, value, owner, request, token)
        }
        let next = SettingsAdvancedInput{
            Language: input.Language,
            Network: settings.Network,
            Directory: settings.DataDirectory,
            Endpoint: settings.Endpoint,
            ProcessId: settings.OwnedProcessId,
            NodeHeight: input.Node.Height,
            Owned: input.Node.Owned,
            Busy: input.Busy,
            Height: input.Height
        }
        if next.Equals(data.state) {
            return
        }
        data.state = next
        Rebuild()
    }

    override func Build() Blob {
        let pane = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, Gap: AppTheme.Space12}
        Advanced(context, pane)
        if data.loadIssue.Length > 0 {
            pane.Add(Label(context.Ui, context.Ui.Strings.Explain(data.loadIssue), AppTheme.Type13, AppTheme.Pink, ""))
        }
        return pane
    }

    func Dispose() {
        if data.dataSize < 0 {
            data.chainLoaded = false
        }
        generation++
        certifyGeneration++
        checkpointGeneration++
        lifetime?.Cancel()
        lifetime?.Dispose()
    }

    func Refresh() {
        data.chainLoaded = false
        Accept(context, openPurge, data)
    }

    private func Advanced(input SettingsPageInput, pane Container) {
        let ui = input.Ui
        let figure = AppTheme.GetInstrumentSize(data.state.Height)
        let used = if data.dataSize > 0 {
            Math.Max(1, int32(Math.Round(40.0 * float64(data.dataSize) / float64(data.dataSize + data.freeSpace))))
        } else {
            0
        }
        let storage = Instrument(
            input,
            "chain data",
            "data",
            "About chain data",
            "Block data the node keeps on this disk"
        )
        storage.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Baseline,
                Gap: AppTheme.Space12,
                FlexShrink: 0,
                Value(
                    ui,
                    "size",
                    ui.Strings.Get("chain data") + " " + data.sizeText,
                    data.sizeText,
                    figure,
                    AppTheme.Ink,
                    AppTheme.Dim
                ),
                Label(ui, data.sizeUnit, AppTheme.Type14, AppTheme.Body, ""),
                Label(
                    ui,
                    ui.Strings.Get("{0} GB free").Replace("{0}", (data.freeSpace / 1000000000).ToString()),
                    AppTheme.Type13,
                    AppTheme.Dim,
                    ""
                )
            }
        )
        storage.Add(
            Grid(
                input,
                ui.Strings.Get("chain data") + " " + data.sizeText + " " + data.sizeUnit,
                4,
                nil,
                index -> Slot(ui, index < used ? AppTheme.Blue: AppTheme.Rule, 1)
            )
        )
        let purgeRow = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            FlexShrink: 0
        }
        if data.dataWallets > 0 {
            purgeRow.Add(
                Status(
                    ui,
                    ui
                        .Strings
                        .Get(data.dataWallets == 1 ? "{0} wallet inside": "{0} wallets inside")
                        .Replace("{0}", data.dataWallets.ToString()),
                    AppTheme.Orange,
                    "warning"
                )
            )
        }
        purgeRow.Add(Container{FlexGrow: 1})
        purgeRow.Add(
            (
                AppTheme.DangerButton with{
                    Content = ui.Strings.Get("Purge…"),
                    OnClick = () -> openPurge(data.sizeText, data.sizeUnit, data.dataWallets),
                    Disabled = data.state.Busy || !data.state.Owned || data.dataSize < 0
                }
            ).Build()
        )
        storage.Add(purgeRow)
        let tip = Math.Max(data.state.NodeHeight, data.certificate?.Height ?? uint64(0))
        var step uint64 = 100
        for candidate in[]uint64{250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000} {
            if step * 30 < tip {
                step = candidate
            }
        }
        let checks = Instrument(
            input,
            "certify",
            "certify",
            "About certify",
            "Checks block links, difficulty and timestamps. Does not re-check proof of work or transactions"
        )
        let verdict = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Baseline,
            Gap: AppTheme.Space12,
            FlexShrink: 0
        }
        let wide = AppTheme.GetVerdictSize(data.state.Height)
        var note = ""
        if let result = data.certificate {
            let clean = result.Violations.Length == 0
            note = Violations(ui, result.Violations.Length)
            verdict.Add(
                Label(
                    ui,
                    clean ? ui.Strings.Get("clean"): Violations(ui, result.Violations.Length),
                    wide,
                    clean ? AppTheme.Mint: AppTheme.Pink,
                    ""
                )
            )
            verdict.Add(
                Label(
                    ui,
                    Count(result.Height) + " · " + result.Time.ToString("HH:mm", CultureInfo.InvariantCulture),
                    AppTheme.Type13,
                    AppTheme.Dim,
                    ""
                )
            )
        } else {
            verdict.Add(Label(ui, ui.Strings.Get("not checked"), wide, AppTheme.Dim, ""))
        }
        checks.Add(verdict)
        let checked = data.certificate?.Height ?? uint64(0)
        checks.Add(
            Grid(
                input,
                ui.Strings.Get("certify") + " " + Count(checked),
                3,
                []string{Short(0), Short(step * 10), Short(step * 20)},
                index -> {
                    let first = uint64(index) * step
                    let bad = data
                        .certificate
                        ?.Violations
                        .Any((height uint64) -> height >= first && height < first + step) ==
                    true
                    return if bad {
                        Slot(ui, AppTheme.Pink, 1)
                    } else if checked > first {
                        Slot(ui, AppTheme.MintMuted, Math.Min(1.0, float64(checked - first) / float64(step)))
                    } else {
                        Slot(ui, AppTheme.Rule, 0)
                    }
                }
            )
        )
        checks.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                FlexShrink: 0,
                Label(ui, note, AppTheme.Type13, AppTheme.Dim, ""),
                Container{FlexGrow: 1},
                Button(ui, "Certify", () -> Certify(input), data.state.Busy)
            }
        )
        pane.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: AppTheme.Space12,
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                storage,
                checks
            }
        )
        pane.Add(Checkpoint(input, figure))
    }

    private func Checkpoint(input SettingsPageInput, figure float64) Blob {
        let ui = input.Ui
        let tip = data.state.NodeHeight
        let start = data.localCheckpoint - data.localCheckpoint % 1000
        let card = WalletParts.Card(ui, AppTheme.Space16, AppTheme.Space12, AppTheme.Radius14)
        card.FlexShrink = 0
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                FlexShrink: 0,
                Label(ui, ui.Strings.Get("checkpoint"), AppTheme.Type12, AppTheme.Body, ""),
                Container{FlexGrow: 1},
                Info(
                    input.Ui,
                    data.state.Language,
                    "checkpoint-info",
                    "About checkpoints",
                    "Save writes a checkpoint every 100 blocks. Load lets sync skip proof-of-work checks up to the last checkpoint"
                )
            }
        )
        let checkpointText = Count(data.localCheckpoint)
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexEnd,
                Gap: AppTheme.Space8,
                FlexShrink: 0,
                Value(
                    ui,
                    "checkpoint",
                    ui.Strings.Get("checkpoint") + " " + checkpointText,
                    checkpointText,
                    figure,
                    AppTheme.Ink,
                    AppTheme.Dim
                ),
                Container{FlexGrow: 1},
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space8,
                    Label(ui, ui.Strings.Get("auto save"), AppTheme.Type12, AppTheme.Body, ""),
                    Toggle(
                        input,
                        "auto save",
                        data.autoSave == true,
                        () -> {
                            let enabled = data.autoSave != true
                            Checkpoints(input, ct -> input.Session.CheckpointAutoSaveAsync(enabled, ct))
                        },
                        data.autoSave == nil
                    ),
                    Button(
                        ui,
                        "Save",
                        () -> Checkpoints(input, ct -> input.Session.CheckpointsAsync("save", ct)),
                        data.state.Busy
                    ),
                    Button(
                        ui,
                        "Load",
                        () -> Checkpoints(input, ct -> input.Session.CheckpointsAsync("load", ct)),
                        data.state.Busy
                    )
                }
            }
        )
        let bar = Container{
            Position: PositionType.Relative,
            FlexShrink: 0,
            Height: 42,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Image,
                Name: ui.Strings.Get("checkpoint") + " " + Count(data.localCheckpoint) + " / " + Count(tip)
            }
        }
        let slots = Container{
            Position: PositionType.Absolute,
            Top: 6,
            Left: 0,
            Right: 0,
            Height: 10,
            FlexDirection: FlexDirection.Row,
            Gap: AppTheme.Space4
        }
        for index in 0 ... 10 {
            let first = start + uint64(index) * 100
            slots.Add(
                if data.localCheckpoint >= first + 100 {
                    Slot(ui, AppTheme.LimeMuted, 1)
                } else if tip > first {
                    Slot(ui, AppTheme.Orange, Math.Min(1.0, float64(tip - first) / 100))
                } else {
                    Slot(ui, AppTheme.Rule, 0)
                }
            )
        }
        bar.Add(slots)
        if tip > start {
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Top: 1,
                    Left: Percent(Math.Min(1.0, float64(tip - start) / 1000) * 100),
                    Width: 2,
                    Height: 20,
                    BackgroundColor: AppTheme.Ink
                }
            )
        }
        if data.trustedCheckpoint > 0 {
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Bottom: 0,
                    Left: 0,
                    Label(
                        ui,
                        ui.Strings.Get("trusted") + " " + Count(data.trustedCheckpoint),
                        AppTheme.Type12,
                        AppTheme.Blue,
                        ""
                    )
                }
            )
        }
        bar.Add(
            Container{
                Position: PositionType.Absolute,
                Bottom: 0,
                Right: 0,
                Label(
                    ui,
                    ui.Strings.Get("next") + " " + Count(data.localCheckpoint - data.localCheckpoint % 100 + 100),
                    AppTheme.Type12,
                    AppTheme.Dim,
                    ""
                )
            }
        )
        card.Add(bar)
        return card
    }

    private func Checkpoints(input SettingsPageInput, task Func[CancellationToken, Task]) {
        guard let owner = input.Window else {
            return
        }
        checkpointGeneration++
        let request = checkpointGeneration
        input.Ui.Actions.Run(ct -> SaveCheckpoints(task, owner, request, ct))
    }

    private async func SaveCheckpoints(
        task Func[CancellationToken, Task],
        owner Window,
        request int32,
        token CancellationToken
    ) {
        var issue = ""
        try {
            await task.Invoke(token)
        } catch (failure Exception) {
            if failure is OperationCanceledException {
                throw failure
            }
            issue = failure.Message
        }
        owner.TryPost(
            () -> {
                if request != checkpointGeneration {
                    return
                }
                data.loadIssue = issue
                if issue.Length == 0 {
                    Refresh()
                } else {
                    Rebuild()
                }
            }
        )
    }

    private func Certify(input SettingsPageInput) {
        guard let lifetime = lifetime, let owner = input.Window else {
            return
        }
        certifyGeneration++
        let request = certifyGeneration
        let token = lifetime.Token
        let session = input.Session
        go ReadCertificate(session, owner, request, token)
    }

    private async func ReadCertificate(session WalletSession, owner Window, request int32, token CancellationToken) {
        var result ChainCertificate?
        var issue = ""
        try {
            result = await session.CertifyAsync(token)
        } catch (cancelled OperationCanceledException) {
            return
        } catch (failure Exception) {
            issue = failure.Message
        }
        owner.TryPost(
            () -> {
                if request == certifyGeneration {
                    data.certificate = result
                    data.loadIssue = issue
                    Rebuild()
                }
            }
        )
    }

    private func Instrument(input SettingsPageInput, title string, key string, topic string, line string) Container {
        let ui = input.Ui
        let card = WalletParts.Card(ui, AppTheme.Space16, AppTheme.Space12, AppTheme.Radius14)
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.Add(
            WalletParts.Header(
                Label(ui, ui.Strings.Get(title), AppTheme.Type12, AppTheme.Body, ""),
                trailing: Info(input.Ui, data.state.Language, key, topic, line)
            )
        )
        return card
    }

    private func Grid(input SettingsPageInput, name string, rows int32, labels[]?string, slot Func[int32, Blob]) Blob {
        var buildLabel Func[int32, Blob]? = nil
        if let names = labels {
            buildLabel = row -> Container{
                Width: 34,
                AlignItems: AlignItems.FlexEnd,
                JustifyContent: JustifyContent.Center,
                Label(input.Ui, names[row], AppTheme.Type11, AppTheme.Dim, "")
            }
        }
        let grid = SegmentGrid(rows, 10, slot, rowGap: AppTheme.GetDetailGap(data.state.Height), label: buildLabel)
        grid.Accessibility = Accessibility{Role: AccessibilityRole.Image, Name: name}
        return grid
    }

    private func Slot(ui Presentation, color Color, share float64) Blob -> Container{
        FlexGrow: 1,
        FlexBasis: 0,
        BorderRadius: AppTheme.Radius1,
        Overflow: Overflow.Hidden,
        BackgroundColor: AppTheme.Rule,
        Progress("", share, color, 0, widthLength: Percent(100), heightLength: Percent(100))
    }

    private func Short(height uint64) string -> if height >= 1000 && height % 1000 == 0 {
        (height / 1000).ToString() + "k"
    } else {
        height.ToString()
    }

    private async func LoadChain(
        session WalletSession,
        settings WalletSettings,
        owner Window?,
        request int32,
        ct CancellationToken
    ) {
        try {
            let result = await session.ReadSettingsChainAsync(settings, ct)
            let unit = result.Size >= 1000000000 ? "GB": "MB"
            let text = (float64(result.Size) / (result.Size >= 1000000000 ? 1e9: 1e6)).ToString(
                "0.0",
                CultureInfo.InvariantCulture
            )
            owner?.TryPost(
                () -> {
                    if request != generation {
                        return
                    }
                    data.freeSpace = result.Free
                    data.trustedCheckpoint = result.Trusted
                    data.dataSize = result.Size
                    data.sizeUnit = unit
                    data.sizeText = text
                    data.dataWallets = result.Wallets
                    data.localCheckpoint = result.Local
                    data.autoSave = result.AutoSave
                    data.loadIssue = ""
                    Rebuild()
                }
            )
        } catch (cancelled OperationCanceledException) { } catch (failure Exception) {
            let issue = failure.Message
            owner?.TryPost(
                () -> {
                    if request == generation {
                        data.loadIssue = issue
                        Rebuild()
                    }
                }
            )
        }
    }

    private func Violations(ui Presentation, count int) string ->
    ui.Strings.Get(count == 1 ? "{0} violation": "{0} violations").Replace("{0}", count.ToString())
}

class SettingsDialogs : Cell, IDisposable {
    private var state SettingsDialogInput
    private var context SettingsPageInput
    private var kind string = ""
    private var purge SettingsPurgeInput
    private var purged Action?
    private let close Action
    private var password string = ""
    private var passwordIssue string = ""
    private var viewKeys WalletViewKeys?
    private var viewPrivateShown bool
    private var lifetime CancellationTokenSource?
    private var generation int32
    private var loading bool
    private var viewOnlyName string = ""
    private var viewOnlyPassword string = ""
    private var viewOnlyCreated string = ""
    private var filenameIssue string = ""
    private var fileIssue string = ""
    private var currentPasswordIssue string = ""
    private var creating bool
    private var purgeText string = ""
    private var purging bool
    private var issue string = ""

    init() {
        close = Close
    }

    func Accept(input SettingsPageInput) {
        context = input
        if state.Wallet != input
            .Settings
            .ActiveWallet ||
            input
            .Snapshot
            .State != WalletState.Unlocked &&
            (kind == "view-key" || kind == "phrase" || kind == "view-only") {
            Close()
        }
        let next = SettingsDialogInput{
            Language: input.Language,
            Wallet: input.Settings.ActiveWallet,
            Directory: input.Settings.WalletDirectory,
            DefaultWallets: SettingsStore.DefaultWallets(input.Settings.Network),
            Privacy: input.Privacy,
            Busy: input.Busy,
            Width: input.Width
        }
        if next.Equals(state) {
            return
        }
        state = next
        Rebuild()
    }

    func Open(kind string) {
        ResetDialog()
        this.kind = kind
        if kind == "view-key" || kind == "phrase" {
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(context.Window?.Closed ?? CancellationToken.None)
        } else if kind == "view-only" {
            viewOnlyName = AppSettings.WalletBasename(state.Wallet) + ".view.wallet.dat"
        }
        Rebuild()
    }

    func OpenPurge(size string, unit string, wallets int32, purged Action) {
        Open("purge")
        purge = SettingsPurgeInput{Size: size, Unit: unit, Wallets: wallets}
        this.purged = purged
    }

    private func ResetDialog() {
        generation++
        lifetime?.Cancel()
        lifetime?.Dispose()
        lifetime = nil
        if viewKeys != nil {
            context.Ui.Actions.ReleaseClipboard()
        }
        viewKeys?.Dispose()
        viewKeys = nil
        viewPrivateShown = false
        password = ""
        passwordIssue = ""
        viewOnlyName = ""
        viewOnlyPassword = ""
        viewOnlyCreated = ""
        filenameIssue = ""
        fileIssue = ""
        currentPasswordIssue = ""
        purgeText = ""
        issue = ""
        loading = false
        creating = false
        purging = false
        purge = SettingsPurgeInput{}
        purged = nil
        kind = ""
    }

    private func Close() {
        ResetDialog()
        Rebuild()
    }

    func Dispose() -> ResetDialog()

    override func Build() Blob -> switch kind {
        case "phrase", "view-key": Dialog(context)
        case "view-only": ViewOnly(context)
        case "purge": Purge(context)
        default: Container{Display: Display.None}
    }

    private func Dialog(input SettingsPageInput) Blob {
        let ui = input.Ui
        if let keys = viewKeys {
            return Keys(input, keys)
        }
        let form = WalletForm(ui, !state.Busy && !loading, () -> Reveal(input), []string{password}, () -> Rebuild())
        let title = kind == "phrase" ? "recovery phrase": "view keys"
        return WalletParts.Modal(
            ui,
            input.Window,
            state.Width,
            "password",
            title,
            420,
            Label(ui, ui.Strings.Get(title), AppTheme.Type17, AppTheme.Ink, ""),
            form.Field(
                "Password",
                password,
                value -> {
                    password = value
                    passwordIssue = ""
                },
                true,
                passwordIssue
            ),
            ActionRow([]Blob{Button(ui, "Cancel", close), Button(ui, "Show", form.Submit, !form.CanSubmit, true)}),
            close
        )
    }

    private func Reveal(input SettingsPageInput) {
        if loading {
            return
        }
        let buffer = password.ToCharArray()
        password = ""
        guard let owner = input.Window, let lifetime = lifetime else {
            Array.Clear(buffer)
            return
        }
        loading = true
        generation++
        Rebuild()
        let request = generation
        let token = lifetime.Token
        let wallet = state.Wallet
        let session = input.Session
        if kind == "phrase" {
            let publish = input.OnRevealSeed
            go LoadPhrase(session, wallet, owner, buffer, publish, request, token)
        } else {
            go LoadKeys(session, wallet, owner, buffer, request, token)
        }
    }

    private async func LoadPhrase(
        session WalletSession,
        wallet string,
        owner Window,
        password[]char,
        publish Action[[]char],
        request int32,
        token CancellationToken
    ) {
        var words[]char = []char{}
        var issue = ""
        try {
            words = await session.Keys.RevealSeedAsync(password, token)
        } catch (cancelled OperationCanceledException) {
            return
        } catch (failure Exception) {
            issue = failure.Message
        } finally {
            Array.Clear(password)
        }
        let cleanup = token.Register(() -> Array.Clear(words))
        if !owner.TryPost(
            () -> {
                cleanup.Dispose()
                if request != generation || session.Settings.ActiveWallet != wallet {
                    Array.Clear(words)
                    return
                }
                loading = false
                passwordIssue = issue
                if issue.Length == 0 {
                    publish.Invoke(words)
                    Close()
                }
                Rebuild()
            }
        ) {
            cleanup.Dispose()
            Array.Clear(words)
        }
    }

    private async func LoadKeys(
        session WalletSession,
        wallet string,
        owner Window,
        buffer[]char,
        request int32,
        token CancellationToken
    ) {
        var result WalletViewKeys?
        var issue = ""
        try {
            try {
                result = await session.Keys.ExportViewKeysAsync(buffer, token)
            } catch (cancelled OperationCanceledException) {
                return
            } catch (failure Exception) {
                issue = failure.Message
            }
        } finally {
            Array.Clear(buffer)
        }
        let keys = result
        let cancellation = token.Register(() -> keys?.Dispose())
        if !owner.TryPost(
            () -> {
                cancellation.Dispose()
                if request != generation ||
                    context
                    .Session
                    .Settings
                    .ActiveWallet != wallet ||
                    context
                    .Session
                    .State != WalletState.Unlocked {
                    keys?.Dispose()
                    return
                }
                viewKeys = keys
                loading = false
                passwordIssue = issue
                Rebuild()
            }
        ) {
            cancellation.Dispose()
            keys?.Dispose()
        }
    }

    private func Keys(input SettingsPageInput, keys WalletViewKeys) Blob {
        let ui = input.Ui
        let content = Container{
            Gap: AppTheme.Space10,
            Key(input, "spend public", "", keys.SpendPublic, false),
            Key(input, "view private", "private", keys.ViewPrivate, true),
            Key(input, "view public", "", keys.ViewPublic, false),
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space8,
                Padding: Edges{Top: AppTheme.Space4},
                MaterialIcons.Create("warning", AppTheme.Icon14, AppTheme.Dim),
                Text{
                    Content: ui.Strings.Get(
                        "Anyone with these keys sees every payment and message to this wallet. They cannot spend"
                    ),
                    FontFamily: AppTheme.Font,
                    FontSize: AppTheme.Type12,
                    Color: AppTheme.Dim,
                    TextWrap: TextWrap.Wrap,
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0
                }
            }
        }
        if fileIssue.Length > 0 {
            content.Add(
                Label(
                    ui,
                    ui.Strings.Explain(fileIssue),
                    AppTheme.Type13,
                    fileIssue == "Saved" ? AppTheme.Body: AppTheme.Pink,
                    ""
                )
            )
        }
        return WalletParts.Modal(
            ui,
            input.Window,
            state.Width,
            "keys",
            "view keys",
            640,
            Label(ui, ui.Strings.Get("view keys"), AppTheme.Type17, AppTheme.Ink, ""),
            content,
            ActionRow(
                []Blob{
                    Button(
                        ui,
                        "Copy all",
                        () -> ui.Actions.Copy(
                            "spend_public " +
                                String(keys.SpendPublic) +
                                "\nview_private " +
                                String(keys.ViewPrivate) +
                                "\nview_public " +
                                String(keys.ViewPublic),
                            30000
                        )
                    ),
                    Button(
                        ui,
                        "Save…",
                        () -> input.ChooseFile.Invoke(
                            FileDialogKind.SaveFile,
                            "keys file",
                            Path.Combine(Home(), AppSettings.WalletBasename(state.Wallet) + ".keys.txt"),
                            path -> {
                                if Object.ReferenceEquals(viewKeys, keys) &&
                                    input
                                    .Session
                                    .State == WalletState.Unlocked {
                                    SaveKeys(input, path, keys)
                                }
                            }
                        ),
                        state.Busy
                    ),
                    Button(ui, "Done", close, false, true)
                }
            ),
            close
        )
    }

    private func SaveKeys(input SettingsPageInput, path string, keys WalletViewKeys) {
        guard let owner = input.Window else {
            return
        }
        let copy = WalletViewKeys{
            SpendPublic: keys.SpendPublic.ToArray(),
            ViewPrivate: keys.ViewPrivate.ToArray(),
            ViewPublic: keys.ViewPublic.ToArray()
        }
        let request = generation
        let session = input.Session
        fileIssue = ""
        Rebuild()
        input.Ui.Actions.Run(ct -> ExportKeys(session, owner, path, copy, request, ct))
    }

    private async func ExportKeys(
        session WalletSession,
        owner Window,
        path string,
        keys WalletViewKeys,
        request int32,
        token CancellationToken
    ) {
        var issue = ""
        try {
            await session.Keys.SaveViewKeysAsync(path, keys, token)
        } catch (failure Exception) {
            issue = failure.Message
        } finally {
            keys.Dispose()
        }
        owner.TryPost(
            () -> {
                if request != generation {
                    return
                }
                fileIssue = issue.Length == 0 ? "Saved": issue
                Rebuild()
            }
        )
    }

    private func Key(input SettingsPageInput, label string, note string, key[]char, secret bool) Blob {
        let ui = input.Ui
        let masked = !viewPrivateShown && (secret || state.Privacy)
        let text = String(key)
        let name = Container{
            Width: AppTheme.LabelColumn,
            FlexShrink: 0,
            Gap: AppTheme.Space2,
            Label(ui, ui.Strings.Get(label), AppTheme.Type13, AppTheme.Body, "")
        }
        if note.Length > 0 {
            name.Add(Label(ui, ui.Strings.Get(note), AppTheme.Type11, AppTheme.Orange, ""))
        }
        let field = FieldBox(
            ui,
            Label(
                ui,
                if masked {
                    "••••••••"
                } else if text.Length > 30 {
                    text.Substring(0, 20) + "…" + text.Substring(text.Length - 8)
                } else {
                    text
                },
                AppTheme.Type13,
                masked ? AppTheme.Dim: AppTheme.Body,
                ""
            ),
            Edges{Left: AppTheme.Space12, Right: AppTheme.Space12}
        )
        field.Height = AppTheme.ControlRegular
        field.JustifyContent = JustifyContent.Center
        let row = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            FlexShrink: 0,
            name,
            Grow(field)
        }
        if secret {
            row.Add(
                Icon(
                    ui,
                    MaterialIcons.Create(
                        viewPrivateShown ? "visibility": "visibility_off",
                        AppTheme.Icon14,
                        viewPrivateShown ? AppTheme.Body: AppTheme.Lime
                    ),
                    ui.Strings.Get(viewPrivateShown ? "Hide": "Reveal"),
                    () -> {
                        viewPrivateShown = !viewPrivateShown
                        Rebuild()
                    },
                    size: AppTheme.ControlCompact,
                    style: AppTheme.DisclosureStyle
                )
            )
        }
        row.Add(
            TextParts.Copy(
                ui,
                text,
                ui.Strings.Get("Copy") + " " + ui.Strings.Get(label),
                size: AppTheme.ControlCompact,
                iconSize: AppTheme.Icon14,
                style: AppTheme.DisclosureStyle,
                clearAfterMs: 30000
            )
        )
        return row
    }

    private func ViewOnly(input SettingsPageInput) Blob {
        let ui = input.Ui
        let form = WalletForm(
            ui,
            !state.Busy && !creating,
            () -> CreateViewOnly(input),
            []string{viewOnlyName.Trim(), password, viewOnlyPassword},
            () -> Rebuild()
        )
        let content = Container{Gap: AppTheme.Space14}
        let actions = List[Blob]()
        if fileIssue.Length > 0 {
            content.Add(Label(ui, ui.Strings.Explain(fileIssue), AppTheme.Type13, AppTheme.Pink, ""))
        }
        if viewOnlyCreated.Length > 0 {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space8,
                    MaterialIcons.Create("check_circle", AppTheme.Icon18, AppTheme.Lime),
                    Label(ui, viewOnlyCreated, AppTheme.Type14, AppTheme.Ink, "")
                }
            )
            actions.Add(Button(ui, "Done", close, false, true))
        } else {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: AppTheme.Space12,
                    FlexShrink: 0,
                    Ability(
                        ui,
                        "can",
                        []string{"see incoming payments", "read amounts and memos", "prove a payment"},
                        true
                    ),
                    Ability(ui, "cannot", []string{"send or sign", "show the phrase", "see spends"}, false)
                }
            )
            content.Add(
                form.Labelled(
                    "file name",
                    form.Field(
                        "file name",
                        viewOnlyName,
                        value -> {
                            viewOnlyName = value
                            filenameIssue = ""
                        },
                        issue: filenameIssue,
                        labelled: false
                    )
                )
            )
            content.Add(
                form.Labelled(
                    "new password",
                    form.Field(
                        "new password",
                        viewOnlyPassword,
                        value -> {
                            viewOnlyPassword = value
                            passwordIssue = ""
                        },
                        true,
                        passwordIssue,
                        labelled: false
                    )
                )
            )
            content.Add(
                form.Labelled(
                    "",
                    Label(
                        ui,
                        ui.Strings.Get("Must differ from this wallet's password"),
                        AppTheme.Type12,
                        AppTheme.Dim,
                        ""
                    )
                )
            )
            content.Add(
                form.Labelled(
                    "this wallet",
                    form.Field(
                        "this wallet",
                        password,
                        value -> {
                            password = value
                            currentPasswordIssue = ""
                        },
                        true,
                        issue: currentPasswordIssue,
                        labelled: false
                    )
                )
            )
            actions.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space6,
                    FlexGrow: 1,
                    MinWidth: 0,
                    MaterialIcons.Create("folder", AppTheme.Icon14, AppTheme.Dim),
                    Label(ui, Tail(state.Directory), AppTheme.Type12, AppTheme.Dim, "")
                }
            )
            actions.Add(Button(ui, "Cancel", close))
            actions.Add(Button(ui, "Create", form.Submit, !form.CanSubmit, true))
        }
        return WalletParts.Modal(
            ui,
            input.Window,
            state.Width,
            "view-only",
            "create view-only wallet",
            620,
            Label(ui, ui.Strings.Get("create view-only wallet"), AppTheme.Type17, AppTheme.Ink, ""),
            content,
            ActionRow(actions.ToArray()),
            close
        )
    }

    private func Ability(ui Presentation, title string, items[]string, allowed bool) Blob {
        let box = Container{
            BasedOn: AppTheme.TileStyle,
            BackgroundColor: Color.Transparent,
            BackdropBlur: AppTheme.Space0,
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Gap: AppTheme.Space8,
            Padding: Edges{
                Top: AppTheme.Space12,
                Bottom: AppTheme.Space12,
                Left: AppTheme.Space14,
                Right: AppTheme.Space14
            },
            BorderColor: AppTheme.Rule,
            Label(ui, ui.Strings.Get(title), AppTheme.Type12, AppTheme.Dim, "")
        }
        for item in items {
            box.Add(
                Status(ui, ui.Strings.Get(item), allowed ? AppTheme.Mint: AppTheme.Pink, allowed ? "check": "close")
            )
        }
        return box
    }

    private func CreateViewOnly(input SettingsPageInput) {
        if creating {
            return
        }
        let filename = viewOnlyName.Trim()
        filenameIssue = ""
        fileIssue = ""
        try {
            WalletValidation.ValidateFilename(filename)
            if !filename.EndsWith(".wallet.dat", StringComparison.Ordinal) {
                throw WalletException("View-only file name must end in .wallet.dat")
            }
        } catch (failure Exception) {
            filenameIssue = failure.Message
            Rebuild()
            return
        }
        let candidate = viewOnlyPassword.ToCharArray()
        passwordIssue = if password == viewOnlyPassword {
            "View-only file password must differ from the wallet password"
        } else {
            WalletValidation.PasswordError(candidate, candidate)
        }
        Array.Clear(candidate)
        if passwordIssue.Length > 0 {
            Rebuild()
            return
        }
        guard let owner = input.Window else {
            return
        }
        let current = password.ToCharArray()
        let secret = viewOnlyPassword.ToCharArray()
        creating = true
        generation++
        Rebuild()
        let request = generation
        let session = input.Session
        let wallet = state.Wallet
        input.Ui.Actions.Run(ct -> CreateFile(session, wallet, owner, filename, current, secret, request, ct))
    }

    private async func CreateFile(
        session WalletSession,
        wallet string,
        owner Window,
        filename string,
        current[]char,
        secret[]char,
        request int32,
        token CancellationToken
    ) {
        var issue = ""
        try {
            try {
                await session.Keys.CreateViewOnlyAsync(filename, current, secret, token)
            } catch (failure Exception) {
                if failure is OperationCanceledException {
                    throw failure
                }
                issue = failure.Message
            }
        } finally {
            Array.Clear(current)
            Array.Clear(secret)
        }
        owner.TryPost(
            () -> {
                if request != generation ||
                    context
                    .Session
                    .Settings
                    .ActiveWallet != wallet ||
                    context
                    .Session
                    .State != WalletState.Unlocked {
                    return
                }
                creating = false
                if issue == "Wrong wallet password" {
                    currentPasswordIssue = issue
                } else if issue == "Wallet file already exists. Choose a different name" {
                    filenameIssue = issue
                } else {
                    fileIssue = issue
                }
                if issue.Length == 0 {
                    password = ""
                    viewOnlyPassword = ""
                    viewOnlyCreated = filename
                }
                Rebuild()
            }
        )
    }

    private func Purge(input SettingsPageInput) Blob {
        let ui = input.Ui
        if purging {
            return WalletParts.Modal(
                ui,
                input.Window,
                state.Width,
                "purging",
                "purging",
                620,
                Label(ui, ui.Strings.Get("purging"), AppTheme.Type17, AppTheme.Ink, ""),
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space12,
                    Cell.Mount[SpinnerInput, Spinner](
                        "purging",
                        SpinnerInput{Size: AppTheme.Icon20, Color: AppTheme.Lime, Label: ui.Strings.Get("purging")}
                    ),
                    Label(ui, ui.Strings.Get("delete data folder"), AppTheme.Type14, AppTheme.Ink, "")
                },
                Container{},
                () -> { }
            )
        }
        let size = purge.Size + " " + purge.Unit
        let deleted = Column(ui, "deleted", AppTheme.Pink)
        deleted.Add(Item(ui, false, "chain database", size))
        deleted.Add(Item(ui, false, "checkpoints.dat", "restored on start"))
        deleted.Add(Item(ui, false, "send retry record", ""))
        deleted.Add(Item(ui, false, "api.cookie", "new on start"))
        deleted.Add(Item(ui, false, "identity.key", "new peer key"))
        let kept = Column(ui, "kept", AppTheme.Mint)
        if purge.Wallets > 0 {
            kept.Add(
                Item(
                    ui,
                    true,
                    ui
                        .Strings
                        .Get(purge.Wallets == 1 ? "{0} wallet": "{0} wallets")
                        .Replace("{0}", purge.Wallets.ToString()),
                    "moved out first"
                )
            )
        }
        kept.Add(Item(ui, true, "settings.json", ""))
        let content = Container{
            Gap: AppTheme.Space14,
            Container{FlexDirection: FlexDirection.Row, Gap: AppTheme.Space12, FlexShrink: 0, deleted, kept}
        }
        if purge.Wallets > 0 {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space8,
                    MaterialIcons.Create("folder", AppTheme.Icon14, AppTheme.Dim),
                    Label(
                        ui,
                        ui.Strings.Get("wallets move to") + " " + Tail(state.DefaultWallets),
                        AppTheme.Type12,
                        AppTheme.Dim,
                        ""
                    )
                }
            )
        }
        let typed = purgeText == "purge"
        let confirm Action = () -> {
            if typed && !state.Busy {
                StartPurge(input)
            }
        }
        let form = WalletForm(ui, typed && !state.Busy, confirm, []string{}, () -> Rebuild())
        if issue.Length > 0 {
            content.Add(Label(ui, ui.Strings.Explain(issue), AppTheme.Type13, AppTheme.Pink, ""))
        }
        let footer = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space10,
            Label(ui, ui.Strings.Get("type purge"), AppTheme.Type13, AppTheme.Body, ""),
            Container{
                Width: 220,
                FlexShrink: 1,
                MinWidth: 80,
                form.Field(
                    "type purge",
                    purgeText,
                    value -> {
                        purgeText = value
                    },
                    labelled: false
                )
            }
        }
        if typed {
            footer.Add(MaterialIcons.Create("check", AppTheme.Icon16, AppTheme.Mint))
        }
        footer.Add(Container{FlexGrow: 1})
        footer.Add(Button(ui, "Cancel", close))
        footer.Add(
            (
                AppTheme.DangerButton with{
                    Content = ui.Strings.Get("Purge {0}").Replace("{0}", size),
                    OnClick = form.Submit,
                    Disabled = !form.CanSubmit
                }
            ).Build()
        )
        return WalletParts.Modal(
            ui,
            input.Window,
            state.Width,
            "purge",
            "purge chain data",
            640,
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space10,
                MaterialIcons.Create("warning", AppTheme.Icon20, AppTheme.Pink),
                Label(ui, ui.Strings.Get("purge chain data"), AppTheme.Type17, AppTheme.Ink, "")
            },
            content,
            footer,
            close
        )
    }

    private func StartPurge(input SettingsPageInput) {
        guard let owner = input.Window else {
            return
        }
        purging = true
        generation++
        Rebuild()
        let request = generation
        let session = input.Session
        let network = input.Settings.Network
        let directory = input.Settings.DataDirectory
        input.Ui.Actions.Run(ct -> PurgeData(session, network, directory, owner, request, ct))
    }

    private async func PurgeData(
        session WalletSession,
        network string,
        directory string,
        owner Window,
        request int32,
        token CancellationToken
    ) {
        var error = ""
        try {
            await session.PurgeDataAsync(token)
        } catch (failure Exception) {
            if failure is OperationCanceledException {
                throw failure
            }
            error = failure.Message
        }
        owner.TryPost(
            () -> {
                if request != generation ||
                    context
                    .Session
                    .Settings
                    .Network != network ||
                    context
                    .Session
                    .Settings
                    .DataDirectory != directory {
                    return
                }
                purging = false
                issue = error
                if error.Length == 0 {
                    purged?.Invoke()
                    close.Invoke()
                } else {
                    Rebuild()
                }
            }
        )
    }

    private func Column(ui Presentation, title string, color Color) Container -> Container{
        BasedOn: AppTheme.TileStyle,
        BackgroundColor: Color.Transparent,
        BackdropBlur: AppTheme.Space0,
        FlexGrow: 1,
        FlexBasis: 0,
        MinWidth: 0,
        Gap: AppTheme.Space8,
        Padding: Edges{
            Top: AppTheme.Space12,
            Bottom: AppTheme.Space12,
            Left: AppTheme.Space14,
            Right: AppTheme.Space14
        },
        BorderColor: AppTheme.Rule,
        Label(ui, ui.Strings.Get(title), AppTheme.Type12, color, "")
    }

    private func Item(ui Presentation, kept bool, label string, note string) Blob {
        var trailing Blob? = nil
        if note.Length > 0 {
            trailing = Label(ui, ui.Strings.Get(note), AppTheme.Type12, AppTheme.Dim, "")
        }
        return WalletParts.Header(
            Status(ui, ui.Strings.Get(label), kept ? AppTheme.Mint: AppTheme.Pink, kept ? "check": "close"),
            trailing: trailing
        )
    }
}

class SettingsParts {
    shared {
        func RowHeight(height float64) float64 -> Math.Clamp(52 + Math.Max(0, height - 640) * 0.025, 52.0, 72.0)

        func Toggle(input SettingsPageInput, label string, on bool, changed Action, disabled bool = false) Blob ->
        (
            AppTheme.Switch with{
                Checked = on,
                Disabled = disabled,
                AccessibilityName = input.Ui.Strings.Get(label),
                OnClick = changed
            }
        ).Build()

        func Info(ui Presentation, language string, key string, topic string, line string) Blob ->
        Cell.Mount[InfoTipInput, InfoTip](
            key,
            InfoTipInput{Ui: ui, Topic: topic, Lines: []string{line}, Language: language, Width: 300}
        )

        func Pinned(variable string) bool -> Environment.GetEnvironmentVariable("GYROID_" + variable) != nil

        func Home() string -> Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)

        func Tail(path string) string {
            let file = Path.GetFileName(path)
            let parent = Path.GetFileName(Path.GetDirectoryName(path) ?? "")
            return "…" + Path.DirectorySeparatorChar + parent + Path.DirectorySeparatorChar + file
        }
    }
}
