package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
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
import System.Diagnostics
import System.Globalization
import System.IO
import System.Linq
import System.Threading
import System.Threading.Tasks

data struct SettingsPageInput {
    var Session WalletSession
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
    var Clipboard[]char
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

data struct SettingsGeneralInput {
    var Language string
    var Background string
    var Scale int32
    var MaximumScale int32
    var Motion bool
    var Tray bool
    var Height float64
}

data struct SettingsSecurityInput {
    var Language string
    var AutoLock int32
    var BackgroundLock int32
    var Privacy bool
    var State WalletState
    var ViewOnly bool
    var Busy bool
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
    var NodeHeight uint64
    var Owned bool
    var Busy bool
    var Height float64
}

data struct SettingsDialogInput {
    var Kind string
    var Language string
    var Wallet string = ""
    var Directory string
    var Privacy bool
    var Busy bool
    var Width float64
    var Clipboard[]char
}

data struct SettingsPurgeInput {
    var Language string
    var Network string
    var Directory string
    var Size string
    var Unit string
    var Wallets int32
    var Busy bool
    var Width float64
}

class SettingsPage : Cell {
    private var current SettingsPageInput
    private var dialogs SettingsDialogs?
    private let openDialog Action[string]
    private let configureGeneral Action[SettingsGeneral]
    private let configureSecurity Action[SettingsSecurity]
    private let configureNode Action[SettingsNode]
    private let configureWallet Action[SettingsWallet]
    private let configureAdvanced Action[SettingsAdvanced]
    private let configureDialogs Action[SettingsDialogs]

    init() {
        openDialog = kind -> dialogs?.Open(kind)
        configureGeneral = region -> region.Accept(current)
        configureSecurity = region -> region.Accept(current, openDialog)
        configureNode = region -> region.Accept(current)
        configureWallet = region -> region.Accept(current, openDialog)
        configureAdvanced = region -> region.Accept(current, OpenPurge)
        configureDialogs = region -> {
            dialogs = region
            region.Accept(current)
        }
    }

    func Accept(input SettingsPageInput) {
        current = input
        Rebuild()
    }

    private func OpenPurge(size string, unit string, wallets int32) {
        dialogs?.OpenPurge(size, unit, wallets)
    }

    override func Build() Blob {
        let input = current
        let ui = input.Ui
        let sections = List[string]{"general", "security", "node"}
        if input.Snapshot.State == WalletState.Unlocked {
            sections.Add("wallet")
        }
        sections.Add("advanced")
        let section = sections.Contains(input.Section) ? input.Section: "general"
        let navWidth = input.Width < 1100 ? 132.0: 168.0
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
        if !input.Available {
            nav.Add(Container{FlexGrow: 1})
            nav.Add(Button(ui, "Back", input.OnClose, input.Busy))
        }
        let header = WalletParts.Header(
            Label(
                ui,
                ui.Strings.Get(section) +
                    (section == "wallet" && input.Snapshot.ViewOnly ? " " + ui.Strings.Get("view-only"): ""),
                AppTheme.Type17,
                section == "wallet" && input.Snapshot.ViewOnly ? AppTheme.Blue: AppTheme.Ink,
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
            Container{
                Key: "general",
                Display: section == "general" ? Display.Flex: Display.None,
                MinHeight: 0,
                Cell.Mount[SettingsGeneral]("general", configureGeneral)
            }
        )
        pane.Add(
            Container{
                Key: "security",
                Display: section == "security" ? Display.Flex: Display.None,
                MinHeight: 0,
                Cell.Mount[SettingsSecurity]("security", configureSecurity)
            }
        )
        pane.Add(
            Container{
                Key: "node",
                Display: section == "node" ? Display.Flex: Display.None,
                MinHeight: 0,
                Cell.Mount[SettingsNode]("node", configureNode)
            }
        )
        pane.Add(
            Container{
                Key: "wallet",
                Display: section == "wallet" ? Display.Flex: Display.None,
                MinHeight: 0,
                Cell.Mount[SettingsWallet]("wallet", configureWallet)
            }
        )
        pane.Add(
            Container{
                Key: "advanced",
                Display: section == "advanced" ? Display.Flex: Display.None,
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                Cell.Mount[SettingsAdvanced]("advanced", configureAdvanced)
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
        if input.Height > 640 {
            root.Height = Math.Clamp(input.Height * 0.65, 480.0, 740.0)
        }
        root.Add(Cell.Mount[SettingsDialogs]("settings-dialogs", configureDialogs))
        return root
    }
}

class SettingsGeneral : Cell, IDisposable {
    private var state SettingsGeneralInput
    private var context SettingsPageInput
    private var rowHeight float64
    private var lifetime CancellationTokenSource?
    private let requests Dictionary[string, CancellationTokenSource] = Dictionary[string, CancellationTokenSource]()
    private let generations Dictionary[string, int32] = Dictionary[string, int32]()
    private var issue string = ""

    func Accept(input SettingsPageInput) {
        context = input
        lifetime ??= CancellationTokenSource.CreateLinkedTokenSource(input.Window?.Closed ?? CancellationToken.None)
        let settings = input.Session.Settings
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
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    override func Build() Blob {
        let content = Container{MinHeight: 0, Gap: AppTheme.Space8, General(context, context.Session.Settings)}
        if issue.Length > 0 {
            content.Add(Label(context.Ui, context.Ui.Strings.Explain(issue), AppTheme.Type13, AppTheme.Pink, ""))
        }
        return content
    }

    private func Prefer(input SettingsPageInput, key string, change Action[WalletSettings]) {
        guard let owner = input.Window, let lifetime = lifetime else {
            return
        }
        if requests.TryGetValue(key, out let previous) {
            previous.Cancel()
            previous.Dispose()
        }
        let request = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token)
        requests[key] = request
        generations.TryGetValue(key, out let previousGeneration)
        let generation = previousGeneration + 1
        generations[key] = generation
        issue = ""
        go SavePreference(input.Session, owner, input.OnPreference, key, change, generation, request.Token)
    }

    private async func SavePreference(
        session WalletSession,
        owner Window,
        saved Action,
        key string,
        change Action[WalletSettings],
        generation int32,
        token CancellationToken
    ) {
        var error = ""
        try {
            await session.SavePreferenceAsync(change, token)
        } catch (cancelled OperationCanceledException) {
            return
        } catch (failure Exception) {
            error = failure.Message
        }
        owner.TryPost(
            () -> {
                if token.IsCancellationRequested || generations[key] != generation || context.Session != session {
                    return
                }
                issue = error
                if error.Length == 0 {
                    saved()
                }
                Rebuild()
            }
        )
    }

    func Dispose() {
        lifetime?.Cancel()
        for key in requests.Keys {
            generations[key]++
            requests[key].Dispose()
        }
        lifetime?.Dispose()
    }

    private func General(input SettingsPageInput, settings WalletSettings) Blob {
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
                            input.Language,
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
                            settings.Background,
                            false,
                            id -> Prefer(
                                input,
                                "background",
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
                            settings.UiScalePercent.ToString(CultureInfo.InvariantCulture),
                            false,
                            id -> Prefer(
                                input,
                                "scale",
                                value -> {
                                    value.UiScalePercent = Int32.Parse(id, CultureInfo.InvariantCulture)
                                }
                            ),
                            (input.MaximumScalePercent - 100) / 25 + 1
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
                            settings.ReduceMotion,
                            () -> {
                                let enabled = !state.Motion
                                Prefer(input, "motion", value -> value.ReduceMotion = enabled)
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
                            settings.StartInTray,
                            () -> {
                                let enabled = !state.Tray
                                Prefer(input, "tray", value -> value.StartInTray = enabled)
                            }
                        )
                    }
                )
            }
        )
    }
}

class SettingsSecurity : Cell {
    private var state SettingsSecurityInput
    private var context SettingsPageInput
    private var rowHeight float64
    private var showDialog Action[string]

    func Accept(input SettingsPageInput, showDialog Action[string]) {
        context = input
        this.showDialog = showDialog
        rowHeight = RowHeight(input.Height)
        let settings = input.Session.Settings
        let next = SettingsSecurityInput{
            Language: input.Language,
            AutoLock: settings.AutoLockMinutes,
            BackgroundLock: settings.BackgroundLockMinutes,
            Privacy: settings.Privacy,
            State: input.Snapshot.State,
            ViewOnly: input.Snapshot.ViewOnly,
            Busy: input.Busy,
            Height: input.Height
        }
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    override func Build() Blob -> Security(context, context.Session.Settings)

    private func Open(kind string) -> showDialog(kind)

    private func Prefer(input SettingsPageInput, change Action[WalletSettings]) {
        input.Ui.Actions.Run(ct -> input.Session.SavePreferenceAsync(change, ct), input.OnPreference)
    }

    private func Security(input SettingsPageInput, settings WalletSettings) Blob {
        let ui = input.Ui
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
                        settings.AutoLockMinutes.ToString(),
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
                        settings.BackgroundLockMinutes.ToString(),
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
                        settings.Privacy,
                        () -> ui.Actions.Run(ct -> input.Session.SavePrivacyAsync(!settings.Privacy, ct))
                    )
                }
            )
        }
        if input.Snapshot.State == WalletState.Unlocked && !input.Snapshot.ViewOnly {
            rows.Add(
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "recovery phrase",
                    []Blob{
                        Label(ui, ui.Strings.Get("12 words"), AppTheme.Type14, AppTheme.Dim, ""),
                        Button(ui, "Show", () -> Open("phrase"), input.Busy),
                        Info(
                            input,
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

class SettingsNode : Cell, IDisposable {
    private var state SettingsNodeInput
    private var context SettingsPageInput
    private var rowHeight float64
    private var startupOpen bool
    private var startupOwner SettingsStartup?
    private var directoryRead string = ""
    private var directoryExists bool
    private var lifetime CancellationTokenSource?
    private var generation int32
    private let configureStartup Action[SettingsStartup]

    init() {
        configureStartup = region -> {
            startupOwner = region
            region.Accept(context)
        }
    }

    func Accept(input SettingsPageInput) {
        context = input
        startupOwner?.Accept(input)
        rowHeight = RowHeight(input.Height)
        let settings = input.Session.Settings
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
            lifetime?.Cancel()
            lifetime?.Dispose()
            let current = CancellationTokenSource.CreateLinkedTokenSource(
                input.Window?.Closed ?? CancellationToken.None
            )
            lifetime = current
            generation++
            directoryRead = next.Directory
            directoryExists = false
            go ReadDirectory(next.Directory, input.Window, generation, current.Token)
        }
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    override func Build() Blob -> NodeSection(context, context.Session.Settings)

    private func ReadDirectory(path string, owner Window?, request int32, token CancellationToken) {
        var exists = false
        try {
            exists = Directory.Exists(path)
        } catch (failure Exception) { }
        owner?.TryPost(
            () -> {
                if request == generation &&
                    !token.IsCancellationRequested &&
                    state.Directory == path &&
                    directoryExists != exists {
                    directoryExists = exists
                    Rebuild()
                }
            }
        )
    }

    func Dispose() {
        generation++
        lifetime?.Cancel()
        lifetime?.Dispose()
    }

    private func NodeSection(input SettingsPageInput, settings WalletSettings) Blob {
        let ui = input.Ui
        let status = input.Node
        let automatic = settings.NodeMode == "automatic"
        let height = List[Blob]()
        if status.Running {
            let heightText = Count(status.Height)
            height.Add(Value(ui, "height", ui.Strings.Get("Height") + " " + heightText, heightText, 14, AppTheme.Mint))
            if status.Syncing {
                height.Add(Label(ui, "/ " + Count(status.ChainHeight), AppTheme.Type14, AppTheme.Dim, ""))
            }
            height.Add(
                Label(
                    ui,
                    Count(status.Peers) + " " + ui.Strings.Get(status.Peers == 1 ? "peer": "peers"),
                    AppTheme.Type14,
                    AppTheme.Dim,
                    ""
                )
            )
        } else {
            height.Add(Label(ui, ui.Strings.Get("Stopped"), AppTheme.Type14, AppTheme.Dim, ""))
            if automatic && status.Phase == NodePhase.None {
                height.Add(
                    Button(ui, "Start", () -> ui.Actions.Run(ct -> input.Session.StartNodeAsync(ct)), input.Busy)
                )
            }
        }
        let core = List[Blob]{Label(ui, "blocknet-core", AppTheme.Type14, AppTheme.Ink, "")}
        if status.Owned && automatic {
            core.Add(
                Button(
                    ui,
                    "Restart",
                    () -> ui.Actions.Run(ct -> input.Session.RestartNodeAsync(ct)),
                    input.Busy || input.Snapshot.State != WalletState.Unloaded
                )
            )
        }
        let upgrade = List[Blob]{Label(ui, Count(CoreRelease.UpgradeHeight), AppTheme.Type14, AppTheme.Orange, "")}
        if status.UpgradeDate.Length > 0 {
            upgrade.Add(Label(ui, status.UpgradeDate, AppTheme.Type14, AppTheme.Dim, ""))
        }
        if status.UpgradeNotice.Length > 0 {
            upgrade.Add(
                Info(
                    input,
                    "upgrade",
                    "Network upgrade",
                    ui.Strings.UpgradeInstructions(status.UpgradeDate, status.UpgradeDeadline)
                )
            )
        }
        let folder = if status.DataDirectory.Length > 0 {
            status.DataDirectory
        } else {
            settings.DataDirectory
        }
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
                            settings.NodeMode,
                            Pinned("NODE_MODE") || input.Busy,
                            id -> ui.Actions.Run(ct -> input.Session.SaveNodeModeAsync(id, ct))
                        ),
                        Info(
                            input,
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
                            () -> ui.Actions.Run(
                                ct -> {
                                    let start = ProcessStartInfo(
                                        if OperatingSystem.IsWindows() {
                                            "explorer.exe"
                                        } else if OperatingSystem.IsMacOS() {
                                            "open"
                                        } else {
                                            "xdg-open"
                                        }
                                    )
                                    start.ArgumentList.Add(folder)
                                    Process.Start(start)?.Dispose()
                                    return Task.CompletedTask
                                }
                            ),
                            input.Busy || !directoryExists
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
                Expanded: startupOpen
            },
            OnClick: () -> {
                startupOpen = !startupOpen
            },
            Grow(Label(ui, ui.Strings.Get("startup"), AppTheme.Type14, AppTheme.Body, "")),
            MaterialIcons.Create(startupOpen ? "expand_less": "expand_more", AppTheme.Icon18, AppTheme.Dim)
        }
        WidgetKeyBindings.BindActivation(startup)
        let content = Container{MinHeight: 0, Gap: AppTheme.Space8}
        list.Display = startupOpen ? Display.None: Display.Flex
        content.Add(list)
        let startupPane = Container{
            Display: startupOpen ? Display.Flex: Display.None,
            MinHeight: 0,
            Cell.Mount[SettingsStartup]("startup", configureStartup)
        }
        content.Add(startup)
        content.Add(startupPane)
        return content
    }
}

class SettingsStartup : Cell {
    private var state SettingsStartupInput
    private var context SettingsPageInput
    private var draft WalletSettings?
    private var source WalletSettings?
    private var listenIssue string = ""
    private var programIssue string = ""
    private var applyPending bool

    func Accept(input SettingsPageInput) {
        context = input
        let settings = input.Session.Settings
        if source?.StartupDiffers(settings) != false {
            source = settings.Copy()
            draft = settings.Copy()
            applyPending = false
            listenIssue = ""
            programIssue = ""
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
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    override func Build() Blob {
        guard let value = draft else {
            return Container{}
        }
        let content = Container{MinHeight: 0, Gap: AppTheme.Space8, Startup(context, context.Session.Settings, value)}
        if applyPending {
            content.Add(ConfirmApply(context))
        }
        return content
    }

    private func Startup(input SettingsPageInput, settings WalletSettings, value WalletSettings) Blob {
        let ui = input.Ui
        let form = WalletForm(
            ui,
            !input.Busy && (value.StartupDiffers(settings) || settings.LoadError.Length > 0),
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
                Pinned("NETWORK") || input.Busy,
                id -> {
                    value.Network = id
                    Rebuild()
                }
            ),
            form.Row("Node URL", value.Endpoint, text -> value.Endpoint = text, disabled: Pinned("ENDPOINT")),
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
                text -> {
                    value.BinaryPath = text
                    programIssue = ""
                },
                "BINARY",
                programIssue
            )
        }
        if state.ListenVisible {
            fields.Add(
                form.Row(
                    "P2P address",
                    value.ListenAddress,
                    text -> {
                        value.ListenAddress = text
                        listenIssue = ""
                    },
                    issue: listenIssue,
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
        variable string,
        issue string = ""
    ) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.FlexStart,
        Gap: AppTheme.Space8,
        Grow(form.Row(label, value, changed, issue: issue, disabled: Pinned(variable))),
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
            input.Busy || Pinned(variable)
        )
    }

    private func SaveSettings(input SettingsPageInput) {
        guard let value = draft else {
            return
        }
        let settings = input.Session.Settings
        listenIssue = SettingsValidation.ListenError(value.ListenAddress)
        programIssue = if value.BinaryPath != settings.BinaryPath && value.BinaryPath.Length > 0 {
            NodeDiscovery.ProgramError(value.BinaryPath)
        } else {
            ""
        }
        if listenIssue.Length > 0 || programIssue.Length > 0 {
            return
        }
        if input.Snapshot.State != WalletState.Unloaded && !applyPending {
            applyPending = true
            return
        }
        applyPending = false
        let next = value.Copy()
        input.Ui.Actions.Run(ct -> input.Session.ApplySettingsAsync(next, ct), input.OnClose)
    }

    private func ConfirmApply(input SettingsPageInput) Blob {
        let ui = input.Ui
        let close Action = () -> {
            applyPending = false
            Rebuild()
        }
        return WalletParts.Modal(
            ui,
            "apply",
            AppTheme.Dialog with{
                Open = true,
                Preset = ModalDialogPreset.Confirm,
                AccessibilityName = ui.Strings.Get("Apply settings"),
                Width = Math.Min(input.Width - 48, 440),
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
                    if input.Snapshot.State == WalletState.Unlocked {
                        "Lock and apply"
                    } else {
                        "Apply"
                    }
                ),
                CancelText = ui.Strings.Get("Cancel"),
                ConfirmDisabled = input.Busy,
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
    private var lifetime CancellationTokenSource?
    private var generation int32
    private var showDialog Action[string]

    func Accept(input SettingsPageInput, showDialog Action[string]) {
        context = input
        this.showDialog = showDialog
        if lifetime == nil || state.Wallet != input.Session.Settings.ActiveWallet {
            lifetime?.Cancel()
            lifetime?.Dispose()
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(input.Window?.Closed ?? CancellationToken.None)
            generation++
            syncing = false
        }
        rowHeight = RowHeight(input.Height)
        let settings = input.Session.Settings
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
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    override func Build() Blob {
        let pane = Container{MinHeight: 0, Gap: AppTheme.Space12}
        WalletSection(context, context.Session.Settings, pane)
        if issue.Length > 0 {
            pane.Add(Label(context.Ui, context.Ui.Strings.Explain(issue), AppTheme.Type13, AppTheme.Pink, ""))
        }
        return pane
    }

    private func Open(kind string) -> showDialog(kind)

    private func StartSync(input SettingsPageInput) {
        guard let owner = input.Window, let lifetime = lifetime else {
            return
        }
        if syncing {
            return
        }
        syncing = true
        generation++
        go Sync(input.Session, state.Wallet, owner, generation, lifetime.Token)
    }

    private async func Sync(
        session WalletSession,
        wallet string,
        owner Window,
        request int32,
        token CancellationToken
    ) {
        var error = ""
        try {
            await session.SyncAsync(token)
        } catch (cancelled OperationCanceledException) {
            return
        } catch (failure Exception) {
            error = failure.Message
        }
        owner.TryPost(
            () -> {
                if request != generation ||
                    token.IsCancellationRequested ||
                    context.Session != session ||
                    state.Wallet != wallet {
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
        lifetime?.Cancel()
        lifetime?.Dispose()
    }

    private func WalletSection(input SettingsPageInput, settings WalletSettings, pane Container) {
        let ui = input.Ui
        let scan = List[Blob]()
        if let balance = input.Snapshot.Balance {
            let scanText = Count(balance.ScanHeight)
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
        scan.Add(Button(ui, "Sync", () -> StartSync(input), input.Busy || syncing))
        scan.Add(Info(input, "rescan", "About sync", "Scan blocks the wallet has not checked yet"))
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
                        input.Busy
                    ),
                    Info(
                        input,
                        "health",
                        "About output health",
                        "Checks every wallet output against the main chain. Repair removes outputs whose block or transaction is no longer on it"
                    )
                }
            )
        }
        if !input.Snapshot.ViewOnly {
            rows.Add(
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "view key",
                    []Blob{
                        Label(ui, "••••••••", AppTheme.Type14, AppTheme.Dim, ""),
                        Button(ui, "Show", () -> Open("view-key"), input.Busy)
                    }
                )
            )
            rows.Add(
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "keys file",
                    []Blob{Button(ui, "Export…", () -> Open("view-key"), input.Busy)}
                )
            )
            rows.Add(
                WalletParts.Line(
                    ui,
                    rowHeight,
                    "view-only wallet",
                    []Blob{
                        Button(ui, "Create…", () -> Open("view-only"), input.Busy),
                        Info(
                            input,
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
                    Label(
                        ui,
                        Tail(Path.Combine(settings.WalletDirectory, settings.ActiveWallet)),
                        AppTheme.Type14,
                        AppTheme.Dim,
                        ""
                    ),
                    Button(ui, "Switch wallet", () -> input.OnNavigate(AppPage.Library), input.Busy)
                }
            )
        )
        pane.Add(WalletParts.Rows(ui, rows.ToArray()))
        if input.Snapshot.ViewOnly {
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

class SettingsAdvanced : Cell, IDisposable {
    private var state SettingsAdvancedInput
    private var context SettingsPageInput
    private var openPurge Action[string, string, int32]
    private var lifetime CancellationTokenSource?
    private var chainRequest CancellationTokenSource?
    private var certificateRequest CancellationTokenSource?
    private var checkpointGeneration int32
    private var generation int32
    private var certifyGeneration int32
    private var loadIssue string = ""
    private var chainLoaded bool
    private var dataSize int64 = -1
    private var sizeText string = "-"
    private var sizeUnit string = "GB"
    private var freeSpace int64
    private var dataWallets int32
    private var trustedCheckpoint uint64
    private var localCheckpoint uint64
    private var autoSave bool?
    private var certificate ChainCertificate?

    func Accept(input SettingsPageInput, openPurge Action[string, string, int32]) {
        context = input
        this.openPurge = openPurge
        let settings = input.Session.Settings
        if lifetime == nil || state.Network != settings.Network || state.Directory != settings.DataDirectory {
            lifetime?.Cancel()
            chainRequest?.Dispose()
            certificateRequest?.Dispose()
            chainRequest = nil
            certificateRequest = nil
            lifetime?.Dispose()
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(input.Window?.Closed ?? CancellationToken.None)
            generation++
            certifyGeneration++
            checkpointGeneration++
            chainLoaded = false
            dataSize = -1
            sizeText = "-"
            freeSpace = 0
            dataWallets = 0
            trustedCheckpoint = 0
            localCheckpoint = 0
            autoSave = nil
            certificate = nil
            loadIssue = ""
        }
        if input.Section == "advanced" && !chainLoaded {
            chainRequest?.Cancel()
            chainRequest?.Dispose()
            let current = CancellationTokenSource.CreateLinkedTokenSource(lifetime?.Token ?? CancellationToken.None)
            chainRequest = current
            generation++
            chainLoaded = true
            go LoadChain(input.Session, settings.Copy(), input.Window, generation, current.Token)
        }
        let next = SettingsAdvancedInput{
            Language: input.Language,
            Network: settings.Network,
            Directory: settings.DataDirectory,
            NodeHeight: input.Node.Height,
            Owned: input.Node.Owned,
            Busy: input.Busy,
            Height: input.Height
        }
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    override func Build() Blob {
        let pane = Container{FlexGrow: 1, FlexBasis: 0, MinHeight: 0, Gap: AppTheme.Space12}
        Advanced(context, pane)
        if loadIssue.Length > 0 {
            pane.Add(Label(context.Ui, context.Ui.Strings.Explain(loadIssue), AppTheme.Type13, AppTheme.Pink, ""))
        }
        return pane
    }

    func Dispose() {
        generation++
        certifyGeneration++
        checkpointGeneration++
        lifetime?.Cancel()
        chainRequest?.Dispose()
        certificateRequest?.Dispose()
        lifetime?.Dispose()
    }

    private func Advanced(input SettingsPageInput, pane Container) {
        let ui = input.Ui
        let status = input.Node
        let figure = AppTheme.GetInstrumentSize(input.Height)
        let used = if dataSize > 0 {
            Math.Max(1, int32(Math.Round(40.0 * float64(dataSize) / float64(dataSize + freeSpace))))
        } else {
            0
        }
        let data = Instrument(input, "chain data", "data", "About chain data", "Block data the node keeps on this disk")
        data.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Baseline,
                Gap: AppTheme.Space12,
                FlexShrink: 0,
                Value(
                    ui,
                    "size",
                    ui.Strings.Get("chain data") + " " + sizeText,
                    sizeText,
                    figure,
                    AppTheme.Ink,
                    AppTheme.Dim
                ),
                Label(ui, sizeUnit, AppTheme.Type14, AppTheme.Body, ""),
                Label(
                    ui,
                    ui.Strings.Get("{0} GB free").Replace("{0}", (freeSpace / 1000000000).ToString()),
                    AppTheme.Type13,
                    AppTheme.Dim,
                    ""
                )
            }
        )
        data.Add(
            Grid(
                input,
                ui.Strings.Get("chain data") + " " + sizeText + " " + sizeUnit,
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
        if dataWallets > 0 {
            purgeRow.Add(
                Status(
                    ui,
                    ui
                        .Strings
                        .Get(dataWallets == 1 ? "{0} wallet inside": "{0} wallets inside")
                        .Replace("{0}", dataWallets.ToString()),
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
                    OnClick = () -> openPurge(sizeText, sizeUnit, dataWallets),
                    Disabled = input.Busy || !status.Owned || dataSize < 0
                }
            ).Build()
        )
        data.Add(purgeRow)
        let tip = Math.Max(status.Height, certificate?.Height ?? uint64(0))
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
        let wide = AppTheme.GetVerdictSize(input.Height)
        var note = ""
        if let result = certificate {
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
        let checked = certificate?.Height ?? uint64(0)
        checks.Add(
            Grid(
                input,
                ui.Strings.Get("certify") + " " + Count(checked),
                3,
                []string{Short(0), Short(step * 10), Short(step * 20)},
                index -> {
                    let first = uint64(index) * step
                    let bad = certificate?.Violations.Any(
                        (height uint64) -> height >= first && height < first + step
                    ) ==
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
                Button(ui, "Certify", () -> Certify(input), input.Busy)
            }
        )
        pane.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: AppTheme.Space12,
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                data,
                checks
            }
        )
        pane.Add(Checkpoint(input, figure))
    }

    private func Checkpoint(input SettingsPageInput, figure float64) Blob {
        let ui = input.Ui
        let tip = input.Node.Height
        let start = localCheckpoint - localCheckpoint % 1000
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
                    input,
                    "checkpoint-info",
                    "About checkpoints",
                    "Save writes a checkpoint every 100 blocks. Load lets sync skip proof-of-work checks up to the last checkpoint"
                )
            }
        )
        let checkpointText = Count(localCheckpoint)
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
                        autoSave == true,
                        () -> {
                            let enabled = autoSave != true
                            Checkpoints(input, ct -> input.Session.CheckpointAutoSaveAsync(enabled, ct))
                        },
                        autoSave == nil
                    ),
                    Button(
                        ui,
                        "Save",
                        () -> Checkpoints(input, ct -> input.Session.CheckpointsAsync("save", ct)),
                        input.Busy
                    ),
                    Button(
                        ui,
                        "Load",
                        () -> Checkpoints(input, ct -> input.Session.CheckpointsAsync("load", ct)),
                        input.Busy
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
                Name: ui.Strings.Get("checkpoint") + " " + Count(localCheckpoint) + " / " + Count(tip)
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
                if localCheckpoint >= first + 100 {
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
        if trustedCheckpoint > 0 {
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Bottom: 0,
                    Left: 0,
                    Label(
                        ui,
                        ui.Strings.Get("trusted") + " " + Count(trustedCheckpoint),
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
                    ui.Strings.Get("next") + " " + Count(localCheckpoint + 100),
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
        guard let owner = lifetime else {
            return
        }
        checkpointGeneration++
        let request = checkpointGeneration
        let token = owner.Token
        let network = state.Network
        let directory = state.Directory
        input
            .Ui
            .Actions
            .Run(
            ct -> SaveCheckpoints(task, token, ct),
            () -> {
                if request == checkpointGeneration &&
                    !token.IsCancellationRequested &&
                    state.Network == network &&
                    state.Directory == directory {
                    chainLoaded = false
                    Accept(context, openPurge)
                }
            }
        )
    }

    private async func SaveCheckpoints(
        task Func[CancellationToken, Task],
        token CancellationToken,
        ct CancellationToken
    ) {
        using let linked = CancellationTokenSource.CreateLinkedTokenSource(token, ct)
        await task.Invoke(linked.Token)
    }

    private func Certify(input SettingsPageInput) {
        guard let lifetime = lifetime, let owner = input.Window else {
            return
        }
        certificateRequest?.Cancel()
        certificateRequest?.Dispose()
        let current = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token)
        certificateRequest = current
        certifyGeneration++
        go ReadCertificate(input.Session, state.Network, owner, certifyGeneration, current.Token)
    }

    private async func ReadCertificate(
        session WalletSession,
        network string,
        owner Window,
        request int32,
        token CancellationToken
    ) {
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
                if request == certifyGeneration &&
                    !token.IsCancellationRequested &&
                    context.Session == session &&
                    state.Network == network {
                    certificate = result
                    loadIssue = issue
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
                trailing: Info(input, key, topic, line)
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
        let grid = SegmentGrid(rows, 10, slot, rowGap: AppTheme.GetDetailGap(input.Height), label: buildLabel)
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
            let data = DirectoryInfo(settings.DataDirectory)
            var size int64 = 0
            var wallets int32 = 0
            var local uint64 = 0
            if data.Exists {
                for file in data.EnumerateFiles(
                    "*",
                    EnumerationOptions{
                        RecurseSubdirectories: true,
                        IgnoreInaccessible: true,
                        AttributesToSkip: FileAttributes.ReparsePoint
                    }
                ) {
                    ct.ThrowIfCancellationRequested()
                    size += file.Length
                }
                try {
                    wallets = session.Library.DataWallets().Count
                } catch (failure Exception) {
                    wallets = -1
                }
                let saved = FileInfo(Path.Combine(data.FullName, "checkpoints.dat"))
                if saved.Exists && saved.Length <= 1048576 {
                    local = Checkpoints.Height(Checkpoints.Parse(File.ReadAllBytes(saved.FullName)))
                }
            }
            let free = DriveInfo(
                if OperatingSystem.IsWindows() {
                    Path.GetPathRoot(data.FullName) ?? data.FullName
                } else if data.Exists {
                    data.FullName
                } else {
                    data.Parent?.FullName ?? "/"
                }
            ).AvailableFreeSpace
            let trusted = settings.Network == "mainnet" ?
            Checkpoints.Height(Checkpoints.Parse(Resources.Resource("Gyroid.Checkpoints.Mainnet"))): uint64(0)
            let unit = size >= 1000000000 ? "GB": "MB"
            let text = (float64(size) / (size >= 1000000000 ? 1e9: 1e6)).ToString("0.0", CultureInfo.InvariantCulture)
            var save bool? = nil
            try {
                save = await session.CheckpointAutoSaveAsync(nil, ct)
            } catch (failure Exception) { }
            owner?.TryPost(
                () -> {
                    if request != generation ||
                        ct.IsCancellationRequested ||
                        context.Session != session ||
                        state.Network != settings.Network ||
                        state.Directory != settings.DataDirectory {
                        return
                    }
                    freeSpace = free
                    trustedCheckpoint = trusted
                    dataSize = size
                    sizeUnit = unit
                    sizeText = text
                    dataWallets = wallets
                    localCheckpoint = local
                    autoSave = save
                    loadIssue = ""
                    Rebuild()
                }
            )
        } catch (cancelled OperationCanceledException) { } catch (failure Exception) {
            let issue = failure.Message
            owner?.TryPost(
                () -> {
                    if request == generation &&
                        !ct.IsCancellationRequested &&
                        context.Session == session &&
                        state.Network == settings.Network &&
                        state.Directory == settings.DataDirectory {
                        loadIssue = issue
                        Rebuild()
                    }
                }
            )
        }
    }
}

class SettingsDialogs : Cell {
    private var state SettingsDialogInput = SettingsDialogInput{}
    private var context SettingsPageInput
    private var kind string = ""
    private var purge SettingsPurgeInput
    private let configureKeys Action[SettingsKeysDialog]
    private let configureViewOnly Action[SettingsViewOnlyDialog]
    private let configurePurge Action[SettingsPurgeDialog]

    init() {
        configureKeys = region -> region.Accept(context, kind, Close)
        configureViewOnly = region -> region.Accept(context, Close)
        configurePurge = region -> region.Accept(context, purge, Close)
    }

    func Accept(input SettingsPageInput) {
        context = input
        if (state.Wallet.Length > 0 && state.Wallet != input.Session.Settings.ActiveWallet) ||
            (
            input
                .Snapshot
                .State != WalletState.Unlocked &&
                (kind == "view-key" || kind == "phrase" || kind == "view-only")
        ) {
            kind = ""
        }
        let next = DialogInput(input, kind)
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    func Open(kind string) {
        this.kind = kind
        Rebuild()
    }

    func OpenPurge(size string, unit string, wallets int32) {
        purge = SettingsPurgeInput{Size: size, Unit: unit, Wallets: wallets}
        Open("purge")
    }

    private func Close() {
        kind = ""
        Rebuild()
    }

    override func Build() Blob -> switch kind {
        case "phrase", "view-key": Cell.Mount[SettingsKeysDialog](kind, configureKeys)
        case "view-only": Cell.Mount[SettingsViewOnlyDialog]("view-only", configureViewOnly)
        case "purge": Cell.Mount[SettingsPurgeDialog]("purge", configurePurge)
        default: Container{Display: Display.None}
    }
}

class SettingsKeysDialog : Cell, IDisposable {
    private var state SettingsDialogInput
    private var context SettingsPageInput
    private var close Action
    private var dialog string = ""
    private var password string = ""
    private var passwordIssue string = ""
    private var viewKeys WalletViewKeys?
    private var pendingKeys WalletViewKeys?
    private var viewPrivateShown bool
    private var lifetime CancellationTokenSource?
    private var generation int32
    private var loading bool

    func Accept(input SettingsPageInput, kind string, close Action) {
        context = input
        this.close = close
        dialog = kind
        lifetime ??= CancellationTokenSource.CreateLinkedTokenSource(input.Window?.Closed ?? CancellationToken.None)
        let next = DialogInput(input, kind)
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    override func Build() Blob -> Dialog(context, context.Session.Settings)

    private func Close(ui Presentation) -> close.Invoke()

    func Dispose() {
        generation++
        lifetime?.Cancel()
        Interlocked.Exchange[WalletViewKeys](ref pendingKeys, nil)?.Dispose()
        if viewKeys != nil {
            context.Ui.Actions.ReleaseClipboard()
        }
        viewKeys?.Dispose()
        viewKeys = nil
        viewPrivateShown = false
        password = ""
        lifetime?.Dispose()
    }

    private func Dialog(input SettingsPageInput, settings WalletSettings) Blob {
        let ui = input.Ui
        let close Action = () -> Close(ui)
        if let keys = viewKeys {
            return Keys(input, keys)
        }
        let form = WalletForm(ui, !input.Busy && !loading, () -> Reveal(input), []string{password})
        let title = dialog == "phrase" ? "recovery phrase": "view keys"
        return WalletParts.Modal(
            ui,
            input.Window,
            input.Width,
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
        if dialog == "phrase" {
            input.OnRevealSeed.Invoke(buffer)
            return
        }
        guard let owner = input.Window, let lifetime = lifetime else {
            Array.Clear(buffer)
            return
        }
        loading = true
        generation++
        go LoadKeys(input.Session, input.Session.Settings.ActiveWallet, owner, buffer, generation, lifetime.Token)
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
            result = await session.Keys.ExportViewKeysAsync(buffer, token)
        } catch (cancelled OperationCanceledException) {
            return
        } catch (failure Exception) {
            issue = failure.Message
        } finally {
            Array.Clear(buffer)
        }
        Interlocked.Exchange[WalletViewKeys?](ref pendingKeys, result)?.Dispose()
        if token.IsCancellationRequested || !owner.TryPost(
            () -> {
                let keys = Interlocked.Exchange[WalletViewKeys](ref pendingKeys, nil)
                if request != generation ||
                    token.IsCancellationRequested ||
                    context.Session != session ||
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
            Interlocked.Exchange[WalletViewKeys](ref pendingKeys, nil)?.Dispose()
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
        return WalletParts.Modal(
            ui,
            input.Window,
            input.Width,
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
                            Path.Combine(
                                Home(),
                                input.Session.Settings.ActiveWallet.Replace(".wallet.dat", "") + ".keys.txt"
                            ),
                            path -> {
                                if Object.ReferenceEquals(viewKeys, keys) &&
                                    input
                                    .Session
                                    .State == WalletState.Unlocked {
                                    ui.Actions.Run(ct -> input.Session.Keys.SaveViewKeysAsync(path, keys, ct))
                                }
                            }
                        ),
                        input.Busy
                    ),
                    Button(ui, "Done", () -> Close(ui), false, true)
                }
            ),
            () -> Close(ui)
        )
    }

    private func Key(input SettingsPageInput, label string, note string, key[]char, secret bool) Blob {
        let ui = input.Ui
        let masked = !viewPrivateShown && (secret || input.Privacy)
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
                    },
                    size: AppTheme.ControlCompact,
                    style: AppTheme.DisclosureStyle
                )
            )
        }
        let copied = ReadOnlySpan[char](input.Clipboard).SequenceEqual(ReadOnlySpan[char](key))
        row.Add(
            Icon(
                ui,
                MaterialIcons.Create(
                    copied ? "check": "content_copy",
                    AppTheme.Icon14,
                    copied ? AppTheme.Lime: AppTheme.Body
                ),
                ui.Strings.Get("Copy") + " " + ui.Strings.Get(label),
                () -> ui.Actions.Copy(text, 30000),
                size: AppTheme.ControlCompact,
                style: AppTheme.DisclosureStyle
            )
        )
        return row
    }
}

class SettingsViewOnlyDialog : Cell, IDisposable {
    private var state SettingsDialogInput
    private var context SettingsPageInput
    private var close Action
    private var password string = ""
    private var passwordIssue string = ""
    private var viewOnlyName string = ""
    private var viewOnlyPassword string = ""
    private var viewOnlyCreated string = ""
    private var lifetime CancellationTokenSource?
    private var generation int32
    private var creating bool

    func Accept(input SettingsPageInput, close Action) {
        context = input
        this.close = close
        if lifetime == nil {
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(input.Window?.Closed ?? CancellationToken.None)
            viewOnlyName = input
                .Session
                .Settings
                .ActiveWallet
                .Replace(".wallet.dat", "")
                .Replace(".dat", "") +
                ".view.wallet.dat"
        }
        let next = DialogInput(input, "view-only")
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    override func Build() Blob -> ViewOnly(context, context.Session.Settings)

    private func Close(ui Presentation) -> close.Invoke()

    func Dispose() {
        generation++
        lifetime?.Cancel()
        lifetime?.Dispose()
        password = ""
        viewOnlyPassword = ""
    }

    private func ViewOnly(input SettingsPageInput, settings WalletSettings) Blob {
        let ui = input.Ui
        let close Action = () -> Close(ui)
        let form = WalletForm(
            ui,
            !input.Busy && !creating,
            () -> CreateViewOnly(input),
            []string{viewOnlyName.Trim(), password, viewOnlyPassword}
        )
        let content = Container{Gap: AppTheme.Space14}
        let actions = List[Blob]()
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
                        },
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
                            passwordIssue = ""
                        },
                        true,
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
                    Label(ui, Tail(settings.WalletDirectory), AppTheme.Type12, AppTheme.Dim, "")
                }
            )
            actions.Add(Button(ui, "Cancel", close))
            actions.Add(Button(ui, "Create", form.Submit, !form.CanSubmit, true))
        }
        return WalletParts.Modal(
            ui,
            input.Window,
            input.Width,
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
        let candidate = viewOnlyPassword.ToCharArray()
        passwordIssue = if password == viewOnlyPassword {
            "View-only file password must differ from the wallet password"
        } else {
            WalletValidation.PasswordError(candidate, candidate)
        }
        Array.Clear(candidate)
        if passwordIssue.Length > 0 {
            return
        }
        guard let owner = input.Window, let lifetime = lifetime else {
            return
        }
        let current = password.ToCharArray()
        let secret = viewOnlyPassword.ToCharArray()
        creating = true
        generation++
        go CreateFile(
            input.Session,
            input.Session.Settings.ActiveWallet,
            owner,
            filename,
            current,
            secret,
            generation,
            lifetime.Token
        )
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
            await session.Keys.CreateViewOnlyAsync(filename, current, secret, token)
        } catch (cancelled OperationCanceledException) {
            return
        } catch (failure Exception) {
            issue = failure.Message
        } finally {
            Array.Clear(current)
            Array.Clear(secret)
        }
        owner.TryPost(
            () -> {
                if request != generation ||
                    token.IsCancellationRequested ||
                    context.Session != session ||
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
                passwordIssue = issue
                if issue.Length == 0 {
                    password = ""
                    viewOnlyPassword = ""
                    viewOnlyCreated = filename
                }
                Rebuild()
            }
        )
    }
}

class SettingsPurgeDialog : Cell, IDisposable {
    private var state SettingsPurgeInput
    private var context SettingsPageInput
    private var close Action
    private var sizeText string = ""
    private var sizeUnit string = ""
    private var dataWallets int32
    private var purgeText string = ""
    private var purging bool
    private var issue string = ""
    private var lifetime CancellationTokenSource?
    private var generation int32

    func Accept(input SettingsPageInput, data SettingsPurgeInput, close Action) {
        context = input
        this.close = close
        sizeText = data.Size
        sizeUnit = data.Unit
        dataWallets = data.Wallets
        lifetime ??= CancellationTokenSource.CreateLinkedTokenSource(input.Window?.Closed ?? CancellationToken.None)
        let next = data with{
            Language = input.Language,
            Network = input.Session.Settings.Network,
            Directory = input.Session.Settings.DataDirectory,
            Busy = input.Busy,
            Width = input.Width
        }
        if !next.Equals(state) {
            state = next
            Rebuild()
        }
    }

    override func Build() Blob -> Purge(context, context.Session.Settings)

    private func Close(ui Presentation) -> close.Invoke()

    func Dispose() {
        generation++
        lifetime?.Cancel()
        lifetime?.Dispose()
    }

    private func Purge(input SettingsPageInput, settings WalletSettings) Blob {
        let ui = input.Ui
        let close Action = () -> Close(ui)
        if purging {
            return WalletParts.Modal(
                ui,
                input.Window,
                input.Width,
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
        let size = sizeText + " " + sizeUnit
        let deleted = Column(ui, "deleted", AppTheme.Pink)
        deleted.Add(Item(ui, false, "chain database", size))
        deleted.Add(Item(ui, false, "checkpoints.dat", "restored on start"))
        deleted.Add(Item(ui, false, "send retry record", ""))
        deleted.Add(Item(ui, false, "api.cookie", "new on start"))
        deleted.Add(Item(ui, false, "identity.key", "new peer key"))
        let kept = Column(ui, "kept", AppTheme.Mint)
        if dataWallets > 0 {
            kept.Add(
                Item(
                    ui,
                    true,
                    ui
                        .Strings
                        .Get(dataWallets == 1 ? "{0} wallet": "{0} wallets")
                        .Replace("{0}", dataWallets.ToString()),
                    "moved out first"
                )
            )
        }
        kept.Add(Item(ui, true, "settings.json", ""))
        let content = Container{
            Gap: AppTheme.Space14,
            Container{FlexDirection: FlexDirection.Row, Gap: AppTheme.Space12, FlexShrink: 0, deleted, kept}
        }
        if dataWallets > 0 {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space8,
                    MaterialIcons.Create("folder", AppTheme.Icon14, AppTheme.Dim),
                    Label(
                        ui,
                        ui.Strings.Get("wallets move to") + " " + Tail(SettingsStore.DefaultWallets(settings.Network)),
                        AppTheme.Type12,
                        AppTheme.Dim,
                        ""
                    )
                }
            )
        }
        let typed = purgeText == "purge"
        let confirm Action = () -> {
            if typed && !input.Busy {
                StartPurge(input)
            }
        }
        let form = WalletForm(ui, typed && !input.Busy, confirm, []string{})
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
            input.Width,
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
        guard let owner = input.Window, let lifetime = lifetime else {
            return
        }
        purging = true
        generation++
        go PurgeData(input.Session, state.Network, state.Directory, owner, generation, lifetime.Token)
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
        } catch (cancelled OperationCanceledException) {
            return
        } catch (failure Exception) {
            error = failure.Message
        }
        owner.TryPost(
            () -> {
                if request != generation ||
                    token.IsCancellationRequested ||
                    context.Session != session ||
                    state.Network != network ||
                    state.Directory != directory {
                    return
                }
                purging = false
                issue = error
                if error.Length == 0 {
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

        func DialogInput(input SettingsPageInput, kind string) SettingsDialogInput -> SettingsDialogInput{
            Kind: kind,
            Language: input.Language,
            Wallet: input.Session.Settings.ActiveWallet,
            Directory: input.Session.Settings.WalletDirectory,
            Privacy: input.Privacy,
            Busy: input.Busy,
            Width: input.Width,
            Clipboard: input.Clipboard
        }

        func Violations(ui Presentation, count int) string ->
        ui.Strings.Get(count == 1 ? "{0} violation": "{0} violations").Replace("{0}", count.ToString())

        func Toggle(input SettingsPageInput, label string, on bool, changed Action, disabled bool = false) Blob ->
        (
            AppTheme.Switch with{
                Checked = on,
                Disabled = disabled,
                AccessibilityName = input.Ui.Strings.Get(label),
                OnClick = changed
            }
        ).Build()

        func Info(input SettingsPageInput, key string, topic string, line string) Blob ->
        Cell.Mount[InfoTipInput, InfoTip](
            key,
            InfoTipInput{Ui: input.Ui, Topic: topic, Lines: []string{line}, Language: input.Language, Width: 300}
        )

        func Pinned(variable string) bool -> Environment.GetEnvironmentVariable("GYROID_" + variable) != nil

        func Home() string -> Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)

        func Shorten(path string) string -> if path.StartsWith(Home(), StringComparison.Ordinal) && Home().Length > 1 {
            "~" + path.Substring(Home().Length)
        } else {
            path
        }

        func Tail(path string) string {
            let file = Path.GetFileName(path)
            let parent = Path.GetFileName(Path.GetDirectoryName(path) ?? "")
            return "…" + Path.DirectorySeparatorChar + parent + Path.DirectorySeparatorChar + file
        }
    }
}
