package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Data
import Goo.Widgets.Icons
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
import System.Globalization
import System.IO
import System.Linq
import System.Threading
import System.Threading.Tasks

data struct LibraryInput {
    var Session WalletSession
    var Ui Presentation
    var State WalletState
    var ActiveWallet string
    var Directory string
    var Network string
    var Busy bool
    var Language string
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnNavigate Action[AppPage]
    var OnCreate Action[string, []char]
    var OnBackup Action[[]char]
}

class LibraryPage : Cell, IDisposable {
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var request CancellationTokenSource?
    private var generation int32
    private var input LibraryInput
    private var form string = ""
    private var issue string = ""
    private var wallets IReadOnlyList[LibraryWallet] = []LibraryWallet{}
    private var importPath string = ""
    private let start Action[string]
    private let back Action
    private let configureList Action[LibraryList]

    init() {
        start = kind -> {
            form = kind
            Rebuild()
        }
        back = () -> {
            form = ""
            Rebuild()
        }
        configureList = cell -> cell.Accept(
            LibraryListInput{
                Session: input.Session,
                Ui: input.Ui,
                State: input.State,
                ActiveWallet: input.ActiveWallet,
                Directory: input.Directory,
                Network: input.Network,
                Busy: input.Busy,
                Language: input.Language,
                Wallets: wallets,
                Issue: issue,
                ChooseFile: input.ChooseFile,
                OnNavigate: input.OnNavigate,
                OnBackup: input.OnBackup,
                OnStart: start,
                OnImport: path -> {
                    importPath = path
                    start("File")
                }
            }
        )
    }

    func Accept(next LibraryInput) {
        if EqualityComparer[LibraryInput].Default.Equals(input, next) {
            return
        }
        let previous = input
        input = next
        if previous.Directory != next.Directory || previous.Network != next.Network {
            wallets = []LibraryWallet{}
            issue = ""
        }
        Rebuild()
        if previous.Session == next.Session &&
            previous.State == next.State &&
            previous.ActiveWallet == next.ActiveWallet &&
            previous.Directory == next.Directory &&
            previous.Network == next.Network {
            return
        }
        guard let owner = next.Ui.Actions.window else {
            return
        }
        request?.Cancel()
        request?.Dispose()
        let current = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, owner.Closed)
        request = current
        generation++
        let library = next.Session.Library
        let directory = next.Directory
        let network = next.Network
        let id = generation
        let token = current.Token
        let previousRows = wallets
        go Load(library, directory, network, previousRows, owner, id, token)
    }

    private func Load(
        library WalletLibrary,
        directory string,
        network string,
        previous IReadOnlyList[LibraryWallet],
        owner Window,
        id int32,
        token CancellationToken
    ) {
        try {
            let result = library.ListWallets(directory, token)
            let rows = result.Rows.SequenceEqual(previous) ? previous: result.Rows
            owner.TryPost(
                () -> {
                    if id != generation || directory != input.Directory || network != input.Network {
                        return
                    }
                    if result.Error == issue && rows == wallets {
                        return
                    }
                    wallets = rows
                    issue = result.Error
                    Rebuild()
                }
            )
        } catch (failure OperationCanceledException) { }
    }

    override func Build() Blob {
        let card = WalletParts.PageCard(input.Ui, maxWidth: 560, fill: true)
        if form.Length > 0 {
            card.Add(
                Cell.Mount[LibraryFormInput, LibraryForm](
                    form,
                    LibraryFormInput{
                        Session: input.Session,
                        Ui: input.Ui,
                        Kind: form,
                        Busy: input.Busy,
                        Language: input.Language,
                        Path: importPath,
                        OnBackup: input.OnBackup,
                        OnBack: back,
                        OnCreate: input.OnCreate
                    }
                )
            )
        } else {
            card.Add(Cell.Mount[LibraryList]("list", configureList))
        }
        return card
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        request?.Dispose()
        lifetime.Dispose()
    }
}

data struct LibraryListInput {
    var Session WalletSession
    var Ui Presentation
    var State WalletState
    var ActiveWallet string
    var Directory string
    var Busy bool
    var Language string
    var Network string
    var Wallets IReadOnlyList[LibraryWallet]
    var Issue string
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnNavigate Action[AppPage]
    var OnBackup Action[[]char]
    var OnStart Action[string]
    var OnImport Action[string]
}

class LibraryList : Cell, IDisposable {
    private var input LibraryListInput
    private var generation int32
    private var opened string?
    private var password string = ""
    private var issue string = ""
    private let rowKey Func[LibraryWallet, string]
    private let rowBuilder Func[LibraryWallet, Blob]
    private let realized HashSet[LibraryWalletRow] = HashSet[LibraryWalletRow]()

    init() {
        rowKey = row -> row.Filename
        rowBuilder = row -> Cell.Mount[LibraryWalletRow](
            row.Filename,
            cell -> {
                cell.Accept(this, row)
                realized.Add(cell)
            }
        )
    }

    func Release(row LibraryWalletRow) {
        realized.Remove(row)
    }

    private func RefreshRows() {
        for row in realized {
            row.Rebuild()
        }
        Rebuild()
    }

    func Accept(next LibraryListInput) {
        if EqualityComparer[LibraryListInput].Default.Equals(input, next) {
            return
        }
        if input.Directory != next.Directory || input.Network != next.Network {
            opened = nil
            password = ""
            issue = ""
            generation++
        }
        input = next
        RefreshRows()
    }

    override func Build() Blob {
        let ui = input.Ui
        let card = Container{Gap: AppTheme.Space14, MinHeight: 0, FlexShrink: 1}
        let header = WalletParts.Header(
            Label(ui, ui.Strings.Get("wallets"), AppTheme.Type17, AppTheme.Ink, ""),
            trailing: Icon(
                ui,
                MaterialIcons.Create("settings", AppTheme.Icon16, input.Busy ? AppTheme.Dim: AppTheme.Body),
                ui.Strings.Get("Settings"),
                () -> input.OnNavigate(AppPage.Settings),
                input.Busy
            )
        )
        card.Add(header)
        card.Add(Label(ui, input.Directory, AppTheme.Type12, AppTheme.Dim, ""))
        if input.Wallets.Count == 0 {
            card.Add(
                Container{
                    Gap: AppTheme.Space10,
                    FlexShrink: 0,
                    Container{
                        FlexDirection: FlexDirection.Row,
                        Gap: AppTheme.Space10,
                        Tile(input, "add", "Create", true, () -> input.OnStart("Create")),
                        Tile(input, "replay", "Restore · 12 words", false, () -> input.OnStart("Phrase"))
                    },
                    Container{
                        FlexDirection: FlexDirection.Row,
                        Gap: AppTheme.Space10,
                        Tile(input, "key", "Import view keys", false, () -> input.OnStart("ViewOnly")),
                        Tile(input, "draft", "Open file", false, ImportFile)
                    }
                }
            )
        } else {
            header.Add(
                Cell.Mount[LibraryMenuInput, LibraryMenu](
                    "add-wallet",
                    LibraryMenuInput{
                        Ui: ui,
                        Busy: input.Busy,
                        Language: input.Language,
                        OnStart: input.OnStart,
                        OnImport: ImportFile
                    }
                )
            )
            let list = VirtualRows(input.Wallets, 48 + AppTheme.Space8, rowKey, rowBuilder, false)
            list.Height = input.Wallets.Count * (48 + AppTheme.Space8)
            list.MinHeight = 0
            list.MaxHeight = Percent(100)
            list.FlexShrink = 1
            card.Add(ListParts.Viewport(list, Style{FlexShrink: 1}, grow: false))
        }
        if input.Issue.Length > 0 {
            card.Add(MessageParts.Problem(ui, ui.Strings.Explain(input.Issue)))
        }
        if issue.Length > 0 && (opened ?? input.ActiveWallet).Length == 0 {
            card.Add(Issue(ui))
        }
        return card
    }

    private func ImportFile() {
        input.ChooseFile.Invoke(
            FileDialogKind.OpenFile,
            "Import wallet",
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            input.OnImport
        )
    }

    private func Issue(ui Presentation) Blob -> MessageParts.Problem(ui, ui.Strings.Explain(issue))

    private func Tile(input LibraryListInput, icon string, label string, primary bool, click Action) Blob {
        let ui = input.Ui
        let button = Goo
            .Button{
            BasedOn: AppTheme.TileStyle,
            BackdropBlur: AppTheme.Space0,
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Height: AppTheme.TileHeight,
            AlignItems: AlignItems.FlexStart,
            JustifyContent: JustifyContent.Center,
            Padding: Edges{
                Left: AppTheme.Space16,
                Right: AppTheme.Space16,
                Top: AppTheme.Space0,
                Bottom: AppTheme.Space0
            },
            BorderColor: primary ? AppTheme.Lime: AppTheme.Rule,
            BackgroundColor: AppTheme.Surface,
            Disabled: input.Busy,
            Hover: Style{BackgroundColor: AppTheme.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get(label)},
            OnClick: click,
            MaterialIcons.Create(icon, AppTheme.Icon20, AppTheme.Lime),
            Label(ui, ui.Strings.Get(label), AppTheme.Type14, AppTheme.Ink, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    func Row(wallet LibraryWallet) Blob {
        let input = this.input
        let filename = wallet.Filename
        let used = wallet.Used
        let loaded = input.State != WalletState.Unloaded
        let ui = input.Ui
        let active = loaded && filename == input.ActiveWallet
        let expanded = filename == (opened ?? input.ActiveWallet)
        let label = WalletName(filename)
        let colors = []Color{
            AppTheme.Lime,
            AppTheme.Blue,
            AppTheme.Orange,
            AppTheme.Mint,
            AppTheme.Violet,
            AppTheme.Pink
        }
        let button = Goo
            .Button{
            BasedOn: AppTheme.ListRowStyle,
            Height: 48,
            BorderWidth: AppTheme.Border0,
            Disabled: input.Busy,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label, Expanded: expanded},
            OnClick: () -> {
                if input.Busy {
                    return
                }
                opened = expanded ? "": filename
                password = ""
                issue = ""
                if loaded && !active {
                    Run(ct -> input.Session.Library.ChooseWalletAsync(filename, ct))
                }
                RefreshRows()
            },
            Container{
                Width: 10,
                Height: 10,
                BorderRadius: AppTheme.Radius3,
                FlexShrink: 0,
                BackgroundColor: colors[filename.Sum((c char) -> int32(c)) % colors.Length]
            },
            Grow(
                Label(
                    ui,
                    label,
                    AppTheme.Type14,
                    if active {
                        AppTheme.Mint
                    } else {
                        AppTheme.Ink
                    },
                    ""
                )
            ),
            Label(ui, Used(ui, used), AppTheme.Type13, AppTheme.Dim, ""),
            if active {
                Container{}
            } else {
                Container{
                    FlexShrink: 0,
                    MaterialIcons.Create(expanded ? "expand_more": "chevron_right", AppTheme.Icon16, AppTheme.Dim)
                }
            }
        }
        WidgetKeyBindings.BindActivation(button)
        let head = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            Height: 48,
            FlexShrink: 0,
            Grow(button)
        }
        if active {
            head.Add(
                Icon(
                    ui,
                    MaterialIcons.Create("download", AppTheme.Icon16, input.Busy ? AppTheme.Dim: AppTheme.Body),
                    ui.Strings.Get("Unload"),
                    () -> Run(ct -> input.Session.UnloadAsync(ct)),
                    input.Busy
                )
            )
        }
        let row = Container{
            Key: filename,
            BasedOn: AppTheme.TileStyle,
            BackdropBlur: AppTheme.Space0,
            Gap: AppTheme.Space0,
            Padding: Edges{
                Left: AppTheme.Space12,
                Right: AppTheme.Space12,
                Top: AppTheme.Space0,
                Bottom: AppTheme.Space0
            },
            BorderColor: expanded ? AppTheme.Edge: AppTheme.Rule,
            BackgroundColor: expanded ? AppTheme.Raised: AppTheme.Surface,
            FlexShrink: 0,
            Margin: Edges{Bottom: AppTheme.Space8},
            head
        }
        if !expanded {
            return row
        }
        let unlock = WalletForm(ui, !input.Busy, () -> Unlock(input, filename), []string{password})
        row.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space10,
                Padding: Edges{Bottom: issue.Length > 0 ? AppTheme.Space8: AppTheme.Space12},
                Grow(
                    Container{
                        MinWidth: 0,
                        unlock.Field(
                            "Password",
                            password,
                            value -> {
                                password = value
                                issue = ""
                                RefreshRows()
                            },
                            secret: true,
                            disabled: input.Busy,
                            labelled: false,
                            invalid: issue.Length > 0
                        )
                    }
                ),
                Button(ui, "Unlock", unlock.Submit, !unlock.CanSubmit, true)
            }
        )
        if issue.Length > 0 {
            row.Add(Container{Padding: Edges{Bottom: AppTheme.Space10}, Issue(ui)})
        }
        return row
    }

    private func Used(ui Presentation, time DateTime) string {
        if time == DateTime.MinValue {
            return ""
        }
        let days = (DateTime.Today - time.Date).Days
        return if days <= 0 {
            ui.Strings.Get("today")
        } else if days == 1 {
            ui.Strings.Get("yesterday")
        } else if days < 7 {
            ui.Strings.Get("{0} days").Replace("{0}", days.ToString())
        } else {
            time.ToString(ui.Strings.Get("MMM d"), CultureInfo.InvariantCulture)
        }
    }

    private func Unlock(input LibraryListInput, filename string) {
        let text = password
        let secret = text.ToCharArray()
        let session = input.Session
        let active = input.ActiveWallet
        let backup = input.OnBackup
        var message = ""
        password = ""
        issue = ""
        generation++
        let id = generation
        input
            .Ui
            .Actions
            .Run(
            async (ct) -> {
                message = await Complete(token -> OpenWallet(session, active, filename, secret, token), ct)
            },
            () -> {
                if message.Length == 0 && session.Snapshot.State == WalletState.Unlocked && session.Keys.BackupPending {
                    backup(text.ToCharArray())
                }
                if id == generation {
                    issue = message
                    RefreshRows()
                }
            },
            secret
        )
    }

    private async func OpenWallet(
        session WalletSession,
        active string,
        filename string,
        secret[]char,
        ct CancellationToken
    ) {
        if filename != active {
            await session.Library.ChooseWalletAsync(filename, ct)
        }
        await session.UnlockAsync(secret, ct)
    }

    private func Run(action Func[CancellationToken, Task]) {
        issue = ""
        generation++
        let id = generation
        var message = ""
        input
            .Ui
            .Actions
            .Run(
            async (ct) -> {
                message = await Complete(action, ct)
            },
            () -> {
                if id == generation {
                    issue = message
                    RefreshRows()
                }
            }
        )
    }

    private async func Complete(action Func[CancellationToken, Task], ct CancellationToken) string {
        try {
            await action(ct)
        } catch (failure WalletException) {
            return failure.Message
        } catch (failure IOException) {
            return failure.Message
        } catch (failure UnauthorizedAccessException) {
            return failure.Message
        } catch (failure Exception) {
            return "Operation failed"
        }
        return ""
    }

    func Dispose() {
        generation++
        password = ""
    }
}

class LibraryWalletRow : Cell, IDisposable {
    var Owner LibraryList
    var Wallet LibraryWallet

    func Accept(owner LibraryList, wallet LibraryWallet) {
        if Owner == owner && Wallet.Equals(wallet) {
            return
        }
        Owner = owner
        Wallet = wallet
        Rebuild()
    }

    override func Build() Blob -> Owner.Row(Wallet)

    func Dispose() {
        Owner.Release(this)
    }
}

data struct LibraryMenuInput {
    var Ui Presentation
    var Busy bool
    var Language string
    var OnStart Action[string]
    var OnImport Action
}

class LibraryMenu : Cell[LibraryMenuInput] {
    private let menuAnchor ElementHandle = ElementHandle()
    private var menu bool

    protected override func Build(input LibraryMenuInput) Blob ->
    Container{
        Handle: menuAnchor,
        FlexShrink: 0,
        Icon(
            input.Ui,
            MaterialIcons.Create(
                "add",
                AppTheme.Icon16,
                menu ? AppTheme.Lime: input.Busy ? AppTheme.Dim: AppTheme.Body
            ),
            input.Ui.Strings.Get("Add wallet"),
            () -> menu = !menu,
            input.Busy,
            menu
        ),
        Menu(input)
    }

    private func ImportFile(input LibraryMenuInput) {
        menu = false
        Rebuild()
        input.OnImport()
    }

    private func Menu(input LibraryMenuInput) Blob {
        let ui = input.Ui
        return Cell.Mount[PopoverInput, Popover](
            "menu",
            PopoverInput{
                Open: menu,
                Anchor: menuAnchor,
                Placement: PopoverPlacement.BottomEnd,
                Gap: AppTheme.Space8,
                Width: 250,
                Padding: AppTheme.Space6,
                BackgroundColor: AppTheme.Raised,
                BorderColor: AppTheme.Edge,
                Role: AccessibilityRole.Menu,
                AccessibilityName: ui.Strings.Get("Add wallet"),
                Content: Container{
                    MinWidth: 0,
                    Item(input, "add", "Create", () -> input.OnStart("Create")),
                    Item(input, "replay", "Restore · 12 words", () -> input.OnStart("Phrase")),
                    Item(input, "key", "Import view keys", () -> input.OnStart("ViewOnly")),
                    Item(input, "draft", "Open file", () -> ImportFile(input))
                },
                OnDismiss: reason -> {
                    menu = false
                    Rebuild()
                }
            }
        )
    }

    private func Item(input LibraryMenuInput, icon string, label string, click Action) Blob {
        let ui = input.Ui
        let button = Goo
            .Button{
            BasedOn: AppTheme.ButtonStyle,
            BorderWidth: AppTheme.Border0,
            BackgroundColor: Color.Transparent,
            JustifyContent: JustifyContent.FlexStart,
            Gap: AppTheme.Space10,
            Padding: Edges{Left: AppTheme.Space10, Right: AppTheme.Space10},
            Hover: Style{BackgroundColor: AppTheme.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.MenuItem, Name: ui.Strings.Get(label)},
            OnClick: click,
            MaterialIcons.Create(icon, AppTheme.Icon16, AppTheme.Lime),
            Label(ui, ui.Strings.Get(label), AppTheme.Type14, AppTheme.Body, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }
}

data struct LibraryFormInput {
    var Session WalletSession
    var Ui Presentation
    var Kind string
    var Path string
    var OnBackup Action[[]char]
    var Busy bool
    var Language string
    var OnBack Action
    var OnCreate Action[string, []char]
}

class LibraryForm : Cell[LibraryFormInput], IDisposable {
    private var generation int32
    private var issue string = ""
    private var name string = ""
    private var password string = ""
    private var confirmation string = ""
    private var phrase string = ""
    private var spendKey string = ""
    private var viewKey string = ""

    protected override func Build(input LibraryFormInput) Blob {
        let card = Container{Gap: AppTheme.Space14, MinHeight: 0}
        let form = input.Kind
        let disabled = input.Busy
        let ui = input.Ui
        let required = if form == "Phrase" {
            []string{name.Trim(), phrase.Trim()}
        } else if form == "ViewOnly" {
            []string{name.Trim(), spendKey, viewKey}
        } else if form == "File" {
            []string{password}
        } else {
            []string{name.Trim()}
        }
        let fields = WalletForm(ui, !disabled, () -> Submit(input), required)
        card.Add(
            WalletParts.Header(
                Label(
                    ui,
                    ui.Strings.Get(
                        switch form {
                            case "Phrase": "restore wallet"
                            case "ViewOnly": "import view keys"
                            case "File": "Import wallet"
                            default: "create wallet"
                        }
                    ),
                    AppTheme.Type17,
                    AppTheme.Ink,
                    ""
                ),
                leading: Icon(
                    ui,
                    MaterialIcons.Create("arrow_back", AppTheme.Icon16, disabled ? AppTheme.Dim: AppTheme.Body),
                    ui.Strings.Get("Back"),
                    input.OnBack,
                    input.Busy
                )
            )
        )
        if form == "File" {
            card.Add(Label(ui, System.IO.Path.GetFileName(input.Path), AppTheme.Type14, AppTheme.Ink, ""))
        } else {
            card.Add(
                fields.Row(
                    "Name",
                    name,
                    value -> {
                        name = value
                        Rebuild()
                    },
                    disabled: disabled
                )
            )
        }
        if form == "Phrase" {
            card.Add(
                fields.Row(
                    "Recovery phrase",
                    phrase,
                    value -> {
                        phrase = value
                        Rebuild()
                    },
                    true,
                    disabled: disabled
                )
            )
        }
        if form == "ViewOnly" {
            card.Add(
                fields.Row(
                    "Spend public key",
                    spendKey,
                    value -> {
                        spendKey = value.Trim()
                        Rebuild()
                    },
                    disabled: disabled
                )
            )
            card.Add(
                fields.Row(
                    "View private key",
                    viewKey,
                    value -> {
                        viewKey = value.Trim()
                        Rebuild()
                    },
                    true,
                    disabled: disabled
                )
            )
        }
        if form == "File" {
            card.Add(
                fields.Row(
                    "Password",
                    password,
                    value -> {
                        password = value
                        issue = ""
                        Rebuild()
                    },
                    true,
                    disabled: disabled
                )
            )
            if issue.Length > 0 {
                card.Add(MessageParts.Problem(ui, ui.Strings.Explain(issue)))
            }
        } else {
            fields.PasswordPair(
                card,
                password,
                confirmation,
                value -> password = value,
                value -> confirmation = value,
                ui.Strings.Explain(issue),
                value -> {
                    issue = value
                    Rebuild()
                },
                disabled
            )
        }
        card.Add(
            ActionRow([]Blob{Button(ui, form == "Create" ? "Create": "Import", fields.Submit, !fields.CanSubmit, true)})
        )
        return card
    }

    private func Submit(input LibraryFormInput) {
        let filename = WalletFile(name)
        let text = password
        let secret = text.ToCharArray()
        password = ""
        confirmation = ""
        if input.Kind == "Create" {
            input.OnCreate(filename, secret)
            return
        }
        let extra = (input.Kind == "Phrase" ? phrase: viewKey).ToCharArray()
        let publicKey = spendKey.ToCharArray()
        issue = ""
        generation++
        let id = generation
        var message = ""
        input
            .Ui
            .Actions
            .Run(
            async (ct) -> {
                message = await Import(input, filename, secret, extra, publicKey, ct)
            },
            () -> {
                if message.Length == 0 &&
                    input
                    .Session
                    .Snapshot
                    .State == WalletState.Unlocked &&
                    input
                    .Session
                    .Keys
                    .BackupPending {
                    input.OnBackup(text.ToCharArray())
                }
                if id != generation {
                    return
                }
                issue = message
                if message.Length == 0 {
                    input.OnBack()
                } else {
                    Rebuild()
                }
            },
            secret,
            extra
        )
    }

    private async func Import(
        input LibraryFormInput,
        filename string,
        secret[]char,
        extra[]char,
        publicKey[]char,
        ct CancellationToken
    ) string {
        try {
            if input.Kind == "File" {
                await input.Session.Library.ImportFileAsync(input.Path, secret, ct)
            } else if input.Kind == "Phrase" {
                await input.Session.ImportPhraseAsync(filename, extra, secret, ct)
            } else {
                await input.Session.ImportViewOnlyAsync(filename, publicKey, extra, secret, ct)
            }
        } catch (failure WalletException) {
            return failure.Message
        } catch (failure IOException) {
            return failure.Message
        } catch (failure UnauthorizedAccessException) {
            return failure.Message
        } catch (failure Exception) {
            return "Operation failed"
        }
        return ""
    }

    func Dispose() {
        generation++
        password = ""
        confirmation = ""
        phrase = ""
        viewKey = ""
    }
}
