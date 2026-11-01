package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Services.WalletText
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

class SettingsPage : Cell[SettingsPageInput], IDisposable {
    private var draft WalletSettings?
    private var rowHeight float64 = 52

    private var startupOpen bool

    private var listenIssue string = ""

    private var programIssue string = ""

    private var applyPending bool

    private var dialog string = ""

    private var password string = ""

    private var passwordIssue string = ""

    private var viewKeys WalletViewKeys?

    private var viewPrivateShown bool

    private var viewOnlyName string = ""

    private var viewOnlyPassword string = ""

    private var viewOnlyCreated string = ""

    private var purgeText string = ""

    private var purging bool

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

    private var rescan Task?

    func Dispose() {
        viewKeys?.Dispose()
        viewKeys = nil
        viewPrivateShown = false
        dialog = ""
        password = ""
        viewOnlyPassword = ""
    }

    protected override func Build(input SettingsPageInput) Blob {
        let ui = input.Ui
        rowHeight = Math.Clamp(52 + Math.Max(0, input.Height - 640) * 0.025, 52.0, 72.0)
        let settings = input.Session.Settings
        if input.Snapshot.State != WalletState.Unlocked && (dialog == "view-key" || viewKeys != nil) {
            Close()
        }
        draft ??= settings
        let sections = List[string]{"general", "security", "node"}
        if input.Snapshot.State == WalletState.Unlocked {
            sections.Add("wallet")
        }
        sections.Add("advanced")
        let section = sections.Contains(input.Section) ? input.Section: "general"
        if section == "advanced" && !chainLoaded {
            chainLoaded = true
            ui.Actions.Delay(0, () -> ui.Actions.Run(ct -> LoadChain(input.Session, ct)))
        }
        let navWidth = input.Width < 1100 ? 132.0: 168.0
        let nav = WalletParts.Card(ui, 8, 2, 14)
        nav.Width = navWidth
        nav.FlexShrink = 0
        nav.Accessibility = Accessibility{Role: AccessibilityRole.TabList, Name: ui.Strings.Get("settings")}
        for id in sections {
            let selected = id == section
            let fill = selected ? ui.Active: Color.Transparent
            let button = Goo
                .Button{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.FlexStart,
                Gap: 10,
                Height: 38,
                FlexShrink: 0,
                Padding: Edges{Left: 12, Right: 12},
                BorderRadius: 8,
                BackgroundColor: fill,
                Hover: Style{BackgroundColor: selected ? fill: ui.Rule},
                Focus: Theme.Read().FocusStyle,
                Accessibility: Accessibility{Role: AccessibilityRole.Tab, Name: ui.Strings.Get(id), Selected: selected},
                OnClick: () -> input.OnSection.Invoke(id),
                MaterialIcons.Create(
                    switch id {
                        case "security": "lock"
                        case "node": "dns"
                        case "wallet": "account_balance_wallet"
                        case "advanced": "build"
                        default: "notes"
                    },
                    18,
                    selected ? ui.Lime: ui.Body
                ),
                Label(ui, ui.Strings.Get(id), 14, selected ? ui.Lime: ui.Body, "")
            }
            WidgetKeyBindings.BindActivation(button)
            nav.Add(button)
        }
        if !input.Available {
            nav.Add(Container{FlexGrow: 1})
            nav.Add(Button(ui, "Back", input.OnClose, input.Busy))
        }
        let header = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            FlexShrink: 0,
            Padding: Edges{Top: 6, Left: 2, Right: 2, Bottom: 2},
            Label(ui, ui.Strings.Get(section), 17, ui.Ink, "")
        }
        if section == "wallet" && input.Snapshot.ViewOnly {
            header.Add(Badge(ui, ui.Strings.Get("view-only"), ui.Blue, "key"))
        }
        let pane = Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, MaxWidth: 820, MinHeight: 0, Gap: 12, header}
        if section == "security" {
            pane.Add(Security(input, settings))
        } else if section == "node" {
            pane.Add(NodeSection(input, settings))
        } else if section == "wallet" {
            WalletSection(input, settings, pane)
        } else if section == "advanced" {
            Advanced(input, pane)
        } else {
            pane.Add(General(input, settings))
        }
        let root = Container{
            FlexDirection: FlexDirection.Row,
            Gap: 16,
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
        if applyPending {
            root.Add(ConfirmApply(input))
        }
        if dialog.Length > 0 {
            root.Add(Dialog(input, settings))
        }
        return root
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
                            input.Busy,
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
                            input.Busy,
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
                            settings.UiScalePercent.ToString(CultureInfo.InvariantCulture),
                            input.Busy,
                            id -> Prefer(
                                input,
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
                            () -> Prefer(
                                input,
                                value -> {
                                    value.ReduceMotion = !settings.ReduceMotion
                                }
                            )
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
                            () -> Prefer(
                                input,
                                value -> {
                                    value.StartInTray = !settings.StartInTray
                                }
                            )
                        )
                    }
                )
            }
        )
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
                        input.Busy,
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
                        input.Busy,
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
                    MaterialIcons.Create("visibility_off", 16, ui.Dim),
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
                        Label(ui, ui.Strings.Get("12 words"), 14, ui.Dim, ""),
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

    private func NodeSection(input SettingsPageInput, settings WalletSettings) Blob {
        let ui = input.Ui
        let status = input.Node
        let automatic = settings.NodeMode == "automatic"
        let height = List[Blob]()
        if status.Running {
            height.Add(Value(input, "height", "Height", Count(status.Height), 14, ui.Mint))
            if status.Syncing {
                height.Add(Label(ui, "/ " + Count(status.ChainHeight), 14, ui.Dim, ""))
            }
            height.Add(
                Label(
                    ui,
                    Count(status.Peers) + " " + ui.Strings.Get(status.Peers == 1 ? "peer": "peers"),
                    14,
                    ui.Dim,
                    ""
                )
            )
        } else {
            height.Add(Label(ui, ui.Strings.Get("Stopped"), 14, ui.Dim, ""))
            if automatic && status.Phase == NodePhase.None {
                height.Add(
                    Button(ui, "Start", () -> ui.Actions.Run(ct -> input.Session.StartNodeAsync(ct)), input.Busy)
                )
            }
        }
        let core = List[Blob]{Label(ui, "blocknet-core", 14, ui.Ink, "")}
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
        let upgrade = List[Blob]{Label(ui, Count(CoreRelease.UpgradeHeight), 14, ui.Orange, "")}
        if status.UpgradeDate.Length > 0 {
            upgrade.Add(Label(ui, status.UpgradeDate, 14, ui.Dim, ""))
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
                        Label(ui, Shorten(folder), 14, ui.Dim, ""),
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
                            input.Busy || !Directory.Exists(folder)
                        )
                    }
                )
            }
        )
        let startup = Goo
            .Button{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Height: 52,
            FlexShrink: 0,
            BorderWidth: Edges{Top: 1},
            BorderColor: ui.FaintRule,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: ui.Strings.Get("startup"),
                Expanded: startupOpen
            },
            OnClick: () -> {
                startupOpen = !startupOpen
                Rebuild()
            },
            Grow(Label(ui, ui.Strings.Get("startup"), 14, ui.Body, "")),
            MaterialIcons.Create(startupOpen ? "expand_less": "expand_more", 18, ui.Dim)
        }
        WidgetKeyBindings.BindActivation(startup)
        list.Add(startup)
        if startupOpen {
            if let value = draft {
                list.Add(Startup(input, settings, value))
            }
        }
        return list
    }

    private func Startup(input SettingsPageInput, settings WalletSettings, value WalletSettings) Blob {
        let ui = input.Ui
        let form = WalletForm(
            ui,
            !input.Busy && (value.StartupDiffers(settings) || settings.LoadError.Length > 0),
            () -> SaveSettings(input),
            []string{},
            () -> Rebuild()
        )
        let fields = Container{
            Gap: 14,
            FlexShrink: 0,
            Padding: Edges{Bottom: 14},
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
            form.Field("Node URL", value.Endpoint, text -> value.Endpoint = text, disabled: Pinned("ENDPOINT")),
            form.PathField(
                "Data",
                value.DataDirectory,
                FileDialogKind.Folder,
                text -> value.DataDirectory = text,
                Pinned("DATA_DIR"),
                input.ChooseFile,
                input.Busy
            ),
            form.PathField(
                "Wallets",
                value.WalletDirectory,
                FileDialogKind.Folder,
                text -> value.WalletDirectory = text,
                Pinned("WALLET_DIR"),
                input.ChooseFile,
                input.Busy
            ),
            form.PathField(
                "Node program",
                value.BinaryPath,
                FileDialogKind.OpenFile,
                text -> {
                    value.BinaryPath = text
                    programIssue = ""
                },
                Pinned("BINARY"),
                input.ChooseFile,
                input.Busy,
                programIssue
            )
        }
        if input.Node.Source != "External" && settings.DataDirectory != settings.DiscoveredDataDirectory {
            fields.Add(
                form.Field(
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

    private func WalletSection(input SettingsPageInput, settings WalletSettings, pane Container) {
        let ui = input.Ui
        let scan = List[Blob]()
        if let balance = input.Snapshot.Balance {
            scan.Add(Value(input, "scan", "scan height", Count(balance.ScanHeight), 14, ui.Ink))
        }
        if rescan?.IsCompleted == false {
            scan.Add(
                Cell.Mount[SpinnerInput, Spinner](
                    "rescan-spinner",
                    SpinnerInput{Size: 16, Color: ui.Lime, Label: ui.Strings.Get("Syncing")}
                )
            )
        }
        scan.Add(
            Button(
                ui,
                "Sync",
                () -> {
                    ui.Actions.Run(
                        ct -> {
                            let task = input.Session.SyncAsync(ct)
                            rescan = task
                            return task
                        }
                    )
                },
                input.Busy
            )
        )
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
                        Label(ui, "••••••••", 14, ui.Dim, ""),
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
                        Button(
                            ui,
                            "Create…",
                            () -> {
                                viewOnlyName = settings
                                    .ActiveWallet
                                    .Replace(".wallet.dat", "")
                                    .Replace(".dat", "") +
                                    ".view.wallet.dat"
                                viewOnlyCreated = ""
                                Open("view-only")
                            },
                            input.Busy
                        ),
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
                    Label(ui, Tail(Path.Combine(settings.WalletDirectory, settings.ActiveWallet)), 14, ui.Dim, ""),
                    Button(ui, "Switch wallet", () -> input.OnNavigate(AppPage.Library), input.Busy)
                }
            )
        )
        pane.Add(WalletParts.Rows(ui, rows.ToArray()))
        if input.Snapshot.ViewOnly {
            let note = WalletParts.Card(ui, 16, 10, 14)
            note.FlexDirection = FlexDirection.Row
            note.AlignItems = AlignItems.Center
            note.FlexShrink = 0
            note.Add(MaterialIcons.Create("warning", 16, ui.Body))
            note.Add(
                Label(ui, ui.Strings.Get("Balance counts received coins. Spends need the spend key"), 13, ui.Ink, "")
            )
            pane.Add(note)
        }
    }

    private func Advanced(input SettingsPageInput, pane Container) {
        let ui = input.Ui
        let status = input.Node
        let figure = Math.Clamp(input.Height * 0.065, 26.0, 64.0)
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
                Gap: 12,
                FlexShrink: 0,
                Value(input, "size", "chain data", sizeText, figure, ui.Ink),
                Label(ui, sizeUnit, 15, ui.Body, ""),
                Label(
                    ui,
                    ui.Strings.Get("{0} GB free").Replace("{0}", (freeSpace / 1000000000).ToString()),
                    12.5,
                    ui.Dim,
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
                index -> Slot(ui, index < used ? ui.Blue: ui.Rule, 1)
            )
        )
        let purgeRow = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, FlexShrink: 0}
        if dataWallets > 0 {
            purgeRow.Add(
                Status(
                    ui,
                    ui
                        .Strings
                        .Get(dataWallets == 1 ? "{0} wallet inside": "{0} wallets inside")
                        .Replace("{0}", dataWallets.ToString()),
                    ui.Orange,
                    "warning"
                )
            )
        }
        purgeRow.Add(Container{FlexGrow: 1})
        purgeRow.Add(
            (
                Theme.Read()
                    .Button with{
                    Content = ui.Strings.Get("Purge…"),
                    OnClick = () -> {
                        purgeText = ""
                        Open("purge")
                    },
                    Disabled = input.Busy || !status.Owned || dataSize < 0,
                    BorderColor = ui.Pink,
                    FontFamily = ui.Font
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
            Gap: 12,
            FlexShrink: 0
        }
        let wide = Math.Clamp(input.Height * 0.05, 22.0, 48.0)
        var note = ""
        if let result = certificate {
            let clean = result.Violations.Length == 0
            note = Violations(ui, result.Violations.Length)
            verdict.Add(
                Label(
                    ui,
                    clean ? ui.Strings.Get("clean"): Violations(ui, result.Violations.Length),
                    wide,
                    clean ? ui.Mint: ui.Pink,
                    ""
                )
            )
            verdict.Add(
                Label(
                    ui,
                    Count(result.Height) + " · " + result.Time.ToString("HH:mm", CultureInfo.InvariantCulture),
                    12.5,
                    ui.Dim,
                    ""
                )
            )
        } else {
            verdict.Add(Label(ui, ui.Strings.Get("not checked"), wide, ui.Dim, ""))
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
                        Slot(ui, ui.Pink, 1)
                    } else if checked > first {
                        Slot(ui, Color.Parse("#048f5f"), Math.Min(1.0, float64(checked - first) / float64(step)))
                    } else {
                        Slot(ui, ui.Rule, 0)
                    }
                }
            )
        )
        checks.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                FlexShrink: 0,
                Label(ui, note, 12.5, ui.Dim, ""),
                Container{FlexGrow: 1},
                Button(
                    ui,
                    "Certify",
                    () -> {
                        var task Task[ChainCertificate]
                        ui.Actions.Run(
                            ct -> {
                                task = input.Session.CertifyAsync(ct)
                                return task
                            },
                            () -> {
                                certificate = task.Result
                            }
                        )
                    },
                    input.Busy
                )
            }
        )
        pane.Add(
            Container{FlexDirection: FlexDirection.Row, Gap: 12, FlexGrow: 1, FlexBasis: 0, MinHeight: 0, data, checks}
        )
        pane.Add(Checkpoint(input, figure))
    }

    private func Checkpoint(input SettingsPageInput, figure float64) Blob {
        let ui = input.Ui
        let tip = input.Node.Height
        let start = localCheckpoint - localCheckpoint % 1000
        let card = WalletParts.Card(ui, 16, 12, 14)
        card.FlexShrink = 0
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                FlexShrink: 0,
                Label(ui, ui.Strings.Get("checkpoint"), 12, ui.Body, ""),
                Container{FlexGrow: 1},
                Info(
                    input,
                    "checkpoint-info",
                    "About checkpoints",
                    "Save writes a checkpoint every 100 blocks. Load lets sync skip proof-of-work checks up to the last checkpoint"
                )
            }
        )
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexEnd,
                Gap: 8,
                FlexShrink: 0,
                Value(input, "checkpoint", "checkpoint", Count(localCheckpoint), figure, ui.Ink),
                Container{FlexGrow: 1},
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    Label(ui, ui.Strings.Get("auto save"), 12, ui.Body, ""),
                    Toggle(
                        input,
                        "auto save",
                        autoSave == true,
                        () -> Checkpoints(input, ct -> input.Session.CheckpointAutoSaveAsync(autoSave != true, ct)),
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
            Gap: 4
        }
        for index in 0 ... 10 {
            let first = start + uint64(index) * 100
            slots.Add(
                if localCheckpoint >= first + 100 {
                    Slot(ui, Color.Parse("#598304"), 1)
                } else if tip > first {
                    Slot(ui, ui.Orange, Math.Min(1.0, float64(tip - first) / 100))
                } else {
                    Slot(ui, ui.Rule, 0)
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
                    BackgroundColor: ui.Ink
                }
            )
        }
        if trustedCheckpoint > 0 {
            bar.Add(
                Container{
                    Position: PositionType.Absolute,
                    Bottom: 0,
                    Left: 0,
                    Label(ui, ui.Strings.Get("trusted") + " " + Count(trustedCheckpoint), 12, ui.Blue, "")
                }
            )
        }
        bar.Add(
            Container{
                Position: PositionType.Absolute,
                Bottom: 0,
                Right: 0,
                Label(ui, ui.Strings.Get("next") + " " + Count(localCheckpoint + 100), 12, ui.Dim, "")
            }
        )
        card.Add(bar)
        return card
    }

    private func Checkpoints(input SettingsPageInput, task Func[CancellationToken, Task]) {
        input
            .Ui
            .Actions
            .Run(
            task,
            () -> {
                chainLoaded = false
            }
        )
    }

    private func Instrument(input SettingsPageInput, title string, key string, topic string, line string) Container {
        let ui = input.Ui
        let card = WalletParts.Card(ui, 16, 12, 14)
        card.FlexGrow = 1
        card.FlexBasis = 0
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                FlexShrink: 0,
                Label(ui, ui.Strings.Get(title), 12, ui.Body, ""),
                Container{FlexGrow: 1},
                Info(input, key, topic, line)
            }
        )
        return card
    }

    private func Grid(input SettingsPageInput, name string, rows int32, labels[]?string, slot Func[int32, Blob]) Blob {
        let grid = Container{
            FlexGrow: 1,
            MinHeight: 0,
            JustifyContent: JustifyContent.Center,
            Gap: Math.Clamp(input.Height * 0.01, 4.0, 8.0),
            Accessibility: Accessibility{Role: AccessibilityRole.Image, Name: name}
        }
        for row in 0 ... rows {
            let line = Container{
                FlexDirection: FlexDirection.Row,
                Gap: 10,
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 8,
                MaxHeight: 44
            }
            if let names = labels {
                line.Add(
                    Container{
                        Width: 34,
                        AlignItems: AlignItems.FlexEnd,
                        JustifyContent: JustifyContent.Center,
                        Label(input.Ui, names[row], 11, input.Ui.Dim, "")
                    }
                )
            }
            let cells = Container{FlexDirection: FlexDirection.Row, Gap: 4, FlexGrow: 1}
            for column in 0 ... 10 {
                cells.Add(slot(row * 10 + column))
            }
            line.Add(cells)
            grid.Add(line)
        }
        return grid
    }

    private func Slot(ui Presentation, color Color, share float64) Blob -> Container{
        FlexGrow: 1,
        FlexBasis: 0,
        BorderRadius: 1,
        Overflow: Overflow.Hidden,
        BackgroundColor: ui.Rule,
        Container{Width: Percent(share * 100), Height: Percent(100), BackgroundColor: color}
    }

    private func Short(height uint64) string -> if height >= 1000 && height % 1000 == 0 {
        (height / 1000).ToString() + "k"
    } else {
        height.ToString()
    }

    private async func LoadChain(session WalletSession, ct CancellationToken) {
        let settings = session.Settings
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
        freeSpace = DriveInfo(
            if OperatingSystem.IsWindows() {
                Path.GetPathRoot(data.FullName) ?? data.FullName
            } else if data.Exists {
                data.FullName
            } else {
                data.Parent?.FullName ?? "/"
            }
        ).AvailableFreeSpace
        trustedCheckpoint = if settings.Network == "mainnet" {
            Checkpoints.Height(Checkpoints.Parse(Resources.Resource("Gyroid.Checkpoints.Mainnet")))
        } else {
            0
        }
        dataSize = size
        sizeUnit = size >= 1000000000 ? "GB": "MB"
        sizeText = (float64(size) / (size >= 1000000000 ? 1e9: 1e6)).ToString("0.0", CultureInfo.InvariantCulture)
        dataWallets = wallets
        localCheckpoint = local
        try {
            autoSave = await session.CheckpointAutoSaveAsync(nil, ct)
        } catch (failure Exception) {
            autoSave = nil
        }
    }

    private func Open(kind string) {
        dialog = kind
        password = ""
        passwordIssue = ""
        Rebuild()
    }

    private func Close() {
        viewKeys?.Dispose()
        viewKeys = nil
        viewPrivateShown = false
        dialog = ""
        password = ""
        passwordIssue = ""
        viewOnlyPassword = ""
        Rebuild()
    }

    private func Dialog(input SettingsPageInput, settings WalletSettings) Blob {
        let ui = input.Ui
        let close Action = () -> Close()
        if dialog == "purge" {
            return Purge(input, settings)
        }
        if dialog == "view-only" {
            return ViewOnly(input, settings)
        }
        if let keys = viewKeys {
            return Keys(input, keys)
        }
        let form = WalletForm(ui, !input.Busy, () -> Reveal(input), []string{password})
        let title = dialog == "phrase" ? "recovery phrase": "view keys"
        return WalletParts.Modal(
            ui,
            input.Window,
            input.Width,
            "password",
            title,
            420,
            Label(ui, ui.Strings.Get(title), 17, ui.Ink, ""),
            form.Field(
                "Password",
                password,
                value -> {
                    password = value
                    passwordIssue = ""
                    Rebuild()
                },
                true,
                passwordIssue
            ),
            ActionRow([]Blob{Button(ui, "Cancel", close), Button(ui, "Show", form.Submit, !form.CanSubmit, true)}),
            close
        )
    }

    private func Reveal(input SettingsPageInput) {
        let buffer = password.ToCharArray()
        password = ""
        if dialog == "phrase" {
            input.OnRevealSeed.Invoke(buffer)
            return
        }
        var task Task[WalletViewKeys?]
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                task = LoadKeys(input.Session, buffer, ct)
                return task
            },
            () -> {
                if dialog == "view-key" && input.Session.State == WalletState.Unlocked {
                    viewKeys = task.Result
                } else {
                    task.Result?.Dispose()
                }
            }
        )
    }

    private async func LoadKeys(session WalletSession, buffer[]char, ct CancellationToken) WalletViewKeys? {
        try {
            return await session.Keys.ExportViewKeysAsync(buffer, ct)
        } catch (failure WalletException) {
            passwordIssue = failure.Message
            return nil
        } finally {
            Array.Clear(buffer)
        }
    }

    private func Keys(input SettingsPageInput, keys WalletViewKeys) Blob {
        let ui = input.Ui
        let content = Container{
            Gap: 10,
            Key(input, "spend public", "", keys.SpendPublic, false),
            Key(input, "view private", "private", keys.ViewPrivate, true),
            Key(input, "view public", "", keys.ViewPublic, false),
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                Padding: Edges{Top: 4},
                MaterialIcons.Create("warning", 14, ui.Dim),
                Text{
                    Content: ui.Strings.Get(
                        "Anyone with these keys sees every payment and message to this wallet. They cannot spend"
                    ),
                    FontFamily: ui.Font,
                    FontSize: 12,
                    Color: ui.Dim,
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
            Label(ui, ui.Strings.Get("view keys"), 17, ui.Ink, ""),
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
                    Button(ui, "Done", () -> Close(), false, true)
                }
            ),
            () -> Close()
        )
    }

    private func Key(input SettingsPageInput, label string, note string, key[]char, secret bool) Blob {
        let ui = input.Ui
        let masked = !viewPrivateShown && (secret || input.Privacy)
        let text = String(key)
        let name = Container{Width: 130, FlexShrink: 0, Gap: 2, Label(ui, ui.Strings.Get(label), 12.5, ui.Body, "")}
        if note.Length > 0 {
            name.Add(Label(ui, ui.Strings.Get(note), 11, ui.Orange, ""))
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
                12.5,
                masked ? ui.Dim: ui.Body,
                ""
            ),
            Edges{Left: 12, Right: 12}
        )
        field.Height = 34
        field.JustifyContent = JustifyContent.Center
        let row = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            FlexShrink: 0,
            name,
            Grow(field)
        }
        if secret {
            row.Add(
                IconButton{
                    Icon: MaterialIcons.Create(
                        viewPrivateShown ? "visibility": "visibility_off",
                        14,
                        viewPrivateShown ? ui.Body: ui.Lime
                    ),
                    AccessibilityName: ui.Strings.Get(viewPrivateShown ? "Hide": "Reveal"),
                    OnClick: () -> {
                        viewPrivateShown = !viewPrivateShown
                        Rebuild()
                    }
                }.Build()
            )
        }
        let copied = ReadOnlySpan[char](input.Clipboard).SequenceEqual(ReadOnlySpan[char](key))
        row.Add(
            IconButton{
                Icon: MaterialIcons.Create(copied ? "check": "content_copy", 14, copied ? ui.Lime: ui.Body),
                AccessibilityName: ui.Strings.Get("Copy") + " " + ui.Strings.Get(label),
                OnClick: () -> ui.Actions.Copy(text, 30000)
            }.Build()
        )
        return row
    }

    private func ViewOnly(input SettingsPageInput, settings WalletSettings) Blob {
        let ui = input.Ui
        let close Action = () -> Close()
        let form = WalletForm(
            ui,
            !input.Busy,
            () -> CreateViewOnly(input),
            []string{viewOnlyName.Trim(), password, viewOnlyPassword}
        )
        let content = Container{Gap: 14}
        let actions = List[Blob]()
        if viewOnlyCreated.Length > 0 {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    MaterialIcons.Create("check_circle", 18, ui.Lime),
                    Label(ui, viewOnlyCreated, 15, ui.Ink, "")
                }
            )
            actions.Add(Button(ui, "Done", close, false, true))
        } else {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: 12,
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
                            Rebuild()
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
                            Rebuild()
                        },
                        true,
                        passwordIssue,
                        labelled: false
                    )
                )
            )
            content.Add(
                form.Labelled("", Label(ui, ui.Strings.Get("Must differ from this wallet's password"), 12, ui.Dim, ""))
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
                            Rebuild()
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
                    Gap: 6,
                    FlexGrow: 1,
                    MinWidth: 0,
                    MaterialIcons.Create("folder", 14, ui.Dim),
                    Label(ui, Tail(settings.WalletDirectory), 12, ui.Dim, "")
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
            Label(ui, ui.Strings.Get("create view-only wallet"), 17, ui.Ink, ""),
            content,
            ActionRow(actions.ToArray()),
            close
        )
    }

    private func Ability(ui Presentation, title string, items[]string, allowed bool) Blob {
        let box = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Gap: 8,
            Padding: Edges{Top: 12, Bottom: 12, Left: 14, Right: 14},
            BorderRadius: 10,
            BorderWidth: 1,
            BorderColor: ui.Rule,
            Label(ui, ui.Strings.Get(title), 12, ui.Dim, "")
        }
        for item in items {
            box.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    MaterialIcons.Create(allowed ? "check": "close", 14, allowed ? ui.Mint: ui.Pink),
                    Label(ui, ui.Strings.Get(item), 12.5, ui.Ink, "")
                }
            )
        }
        return box
    }

    private func CreateViewOnly(input SettingsPageInput) {
        let filename = viewOnlyName.Trim()
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
        let current = password.ToCharArray()
        let secret = viewOnlyPassword.ToCharArray()
        var task Task[bool]
        input
            .Ui
            .Actions
            .Run(
            ct -> {
                task = CreateFile(input.Session, filename, current, secret, ct)
                return task
            },
            () -> {
                if task.Result {
                    password = ""
                    viewOnlyPassword = ""
                    viewOnlyCreated = filename
                }
            }
        )
    }

    private async func CreateFile(
        session WalletSession,
        filename string,
        current[]char,
        secret[]char,
        ct CancellationToken
    ) bool {
        try {
            await session.Keys.CreateViewOnlyAsync(filename, current, secret, ct)
            return true
        } catch (failure WalletException) {
            passwordIssue = failure.Message
            return false
        } finally {
            Array.Clear(current)
            Array.Clear(secret)
        }
    }

    private func Purge(input SettingsPageInput, settings WalletSettings) Blob {
        let ui = input.Ui
        let close Action = () -> Close()
        if purging {
            return WalletParts.Modal(
                ui,
                input.Window,
                input.Width,
                "purging",
                "purging",
                620,
                Label(ui, ui.Strings.Get("purging"), 17, ui.Ink, ""),
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 12,
                    Cell.Mount[SpinnerInput, Spinner](
                        "purging",
                        SpinnerInput{Size: 20, Color: ui.Lime, Label: ui.Strings.Get("purging")}
                    ),
                    Label(ui, ui.Strings.Get("delete data folder"), 14, ui.Ink, "")
                },
                Container{},
                () -> { }
            )
        }
        let size = sizeText + " " + sizeUnit
        let deleted = Column(ui, "deleted", ui.Pink)
        deleted.Add(Item(ui, false, "chain database", size))
        deleted.Add(Item(ui, false, "checkpoints.dat", "restored on start"))
        deleted.Add(Item(ui, false, "send retry record", ""))
        deleted.Add(Item(ui, false, "api.cookie", "new on start"))
        deleted.Add(Item(ui, false, "identity.key", "new peer key"))
        let kept = Column(ui, "kept", ui.Mint)
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
            Gap: 14,
            Container{FlexDirection: FlexDirection.Row, Gap: 12, FlexShrink: 0, deleted, kept}
        }
        if dataWallets > 0 {
            content.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    MaterialIcons.Create("folder", 14, ui.Dim),
                    Label(
                        ui,
                        ui.Strings.Get("wallets move to") + " " + Tail(SettingsStore.DefaultWallets(settings.Network)),
                        12,
                        ui.Dim,
                        ""
                    )
                }
            )
        }
        let typed = purgeText == "purge"
        let confirm Action = () -> {
            if typed && !input.Busy {
                purging = true
                ui.Actions.Run(ct -> PurgeData(input.Session, ct))
            }
        }
        let form = WalletForm(ui, typed && !input.Busy, confirm, []string{})
        let footer = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Label(ui, ui.Strings.Get("type purge"), 12.5, ui.Body, ""),
            Container{
                Width: 220,
                FlexShrink: 1,
                MinWidth: 80,
                form.Field(
                    "type purge",
                    purgeText,
                    value -> {
                        purgeText = value
                        Rebuild()
                    },
                    labelled: false
                )
            }
        }
        if typed {
            footer.Add(MaterialIcons.Create("check", 16, ui.Mint))
        }
        footer.Add(Container{FlexGrow: 1})
        footer.Add(Button(ui, "Cancel", close))
        footer.Add(
            (
                Theme.Read()
                    .DangerButton with{
                    Content = ui.Strings.Get("Purge {0}").Replace("{0}", size),
                    OnClick = form.Submit,
                    Disabled = !form.CanSubmit,
                    FontFamily = ui.Font
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
                Gap: 10,
                MaterialIcons.Create("warning", 20, ui.Pink),
                Label(ui, ui.Strings.Get("purge chain data"), 17, ui.Ink, "")
            },
            content,
            footer,
            close
        )
    }

    private async func PurgeData(session WalletSession, ct CancellationToken) {
        try {
            await session.PurgeDataAsync(ct)
            await LoadChain(session, ct)
        } finally {
            purging = false
            dialog = ""
        }
    }

    private func Column(ui Presentation, title string, color Color) Container -> Container{
        FlexGrow: 1,
        FlexBasis: 0,
        MinWidth: 0,
        Gap: 8,
        Padding: Edges{Top: 12, Bottom: 12, Left: 14, Right: 14},
        BorderRadius: 10,
        BorderWidth: 1,
        BorderColor: ui.Rule,
        Label(ui, ui.Strings.Get(title), 12, color, "")
    }

    private func Item(ui Presentation, kept bool, label string, note string) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 8,
        MaterialIcons.Create(kept ? "check": "close", 14, kept ? ui.Mint: ui.Pink),
        Grow(Label(ui, ui.Strings.Get(label), 13, ui.Ink, "")),
        Label(ui, note.Length > 0 ? ui.Strings.Get(note): "", 12, ui.Dim, "")
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
            startupOpen = true
            Rebuild()
            return
        }
        if input.Snapshot.State != WalletState.Unloaded && !applyPending {
            applyPending = true
            Rebuild()
            return
        }
        applyPending = false
        input.Ui.Actions.Run(ct -> input.Session.ApplySettingsAsync(value.Copy(), ct), input.OnClose)
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
            ModalDialog{
                Open: true,
                Preset: ModalDialogPreset.Confirm,
                AccessibilityName: ui.Strings.Get("Apply settings"),
                Width: Math.Min(input.Width - 48, 440),
                Padding: 22,
                BackgroundColor: ui.Raised,
                BorderRadius: 14,
                Content: Container{
                    Gap: 10,
                    Label(ui, ui.Strings.Get("Apply settings"), 17, ui.Ink, ""),
                    Label(ui, ui.Strings.Get("The wallet locks and the node reconnects"), 13, ui.Body, "")
                },
                ConfirmText: ui.Strings.Get(
                    if input.Snapshot.State == WalletState.Unlocked {
                        "Lock and apply"
                    } else {
                        "Apply"
                    }
                ),
                CancelText: ui.Strings.Get("Cancel"),
                ConfirmDisabled: input.Busy,
                OnConfirm: () -> SaveSettings(input),
                OnCancel: close,
                OnClose: close
            }
        )
    }

    private func Prefer(input SettingsPageInput, change Action[WalletSettings]) {
        input.Ui.Actions.Run(ct -> input.Session.SavePreferenceAsync(change, ct), input.OnPreference)
    }

    private func Violations(ui Presentation, count int) string ->
    ui.Strings.Get(count == 1 ? "{0} violation": "{0} violations").Replace("{0}", count.ToString())

    private func Toggle(input SettingsPageInput, label string, on bool, changed Action, disabled bool = false) Blob ->
    ToggleSwitch{
        Checked: on,
        Disabled: disabled || input.Busy,
        AccessibilityName: input.Ui.Strings.Get(label),
        OnClick: changed,
        Width: 36,
        Height: 20,
        ThumbSize: 14,
        OffTrackColor: input.Ui.Edge,
        OnTrackColor: input.Ui.Lime,
        ThumbColor: Color.Parse("#8c8c8c"),
        OnThumbColor: input.Ui.Surface
    }.Build()

    private func Info(input SettingsPageInput, key string, topic string, line string) Blob ->
    Cell.Mount[InfoTipInput, InfoTip](
        key,
        InfoTipInput{Ui: input.Ui, Topic: topic, Lines: []string{line}, Language: input.Language, Width: 300}
    )

    private func Value(
        input SettingsPageInput,
        key string,
        name string,
        value string,
        size float64,
        color Color
    ) Blob ->
    Cell.Mount[DecodeValueInput, DecodeValue](
        key,
        DecodeValueInput{
            Value: value,
            Name: input.Ui.Strings.Get(name) + " " + value,
            Size: size,
            Color: color,
            FractionColor: if size > 20 {
                input.Ui.Dim
            } else {
                color
            },
            Live: AccessibilityLive.Off,
            Ui: input.Ui
        }
    )

    private func Pinned(variable string) bool -> Environment.GetEnvironmentVariable("GYROID_" + variable) != nil

    private func Home() string -> Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)

    private func Shorten(path string) string -> if path.StartsWith(Home(), StringComparison.Ordinal) &&
        Home().Length > 1 {
        "~" + path.Substring(Home().Length)
    } else {
        path
    }

    private func Tail(path string) string {
        let file = Path.GetFileName(path)
        let parent = Path.GetFileName(Path.GetDirectoryName(path) ?? "")
        return "…" + Path.DirectorySeparatorChar + parent + Path.DirectorySeparatorChar + file
    }
}
