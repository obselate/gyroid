package Gyroid.Views

import Goo
import Goo.Widgets
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
    var Busy bool
    var Language string
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnNavigate Action[AppPage]
    var OnCreate Action[string, []char]
    var OnUnlock Action[string, Func[CancellationToken, Task], Action]
}

class LibraryPage : Cell, IDisposable {
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var request CancellationTokenSource?
    private var generation int32
    private var input LibraryInput
    private var directory string = ""
    private var network string = ""
    private var state WalletState?
    private var activeWallet string = ""
    private var form string = ""
    private var issue string = ""
    private var wallets SortedDictionary[string, DateTime] = SortedDictionary[string, DateTime](StringComparer.Ordinal)
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
                Directory: directory,
                Busy: input.Busy,
                Language: input.Language,
                Wallets: wallets,
                Issue: issue,
                ChooseFile: input.ChooseFile,
                OnNavigate: input.OnNavigate,
                OnUnlock: input.OnUnlock,
                OnStart: start
            }
        )
    }

    func Accept(next LibraryInput) {
        let changed = !EqualityComparer[LibraryInput].Default.Equals(input, next)
        input = next
        let settings = next.Session.Settings
        if directory == settings.WalletDirectory && network == settings.Network.ToString() &&
            state == next.State &&
            activeWallet == next.ActiveWallet {
            if changed {
                Rebuild()
            }
            return
        }
        directory = settings.WalletDirectory
        network = settings.Network.ToString()
        state = next.State
        activeWallet = next.ActiveWallet
        Rebuild()
        request?.Cancel()
        request?.Dispose()
        guard let owner = next.Ui.Actions.window else {
            return
        }
        let current = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, owner.Closed)
        request = current
        generation++
        let id = generation
        let token = current.Token
        go Load(next.Session.Library, owner, id, token)
    }

    private func Load(library WalletLibrary, owner Window, id int32, token CancellationToken) {
        let found = SortedDictionary[string, DateTime](StringComparer.Ordinal)
        var message = ""
        try {
            for filename in library.ListWallets() {
                token.ThrowIfCancellationRequested()
                found[filename] = File.GetLastWriteTime(library.WalletPath(filename))
            }
        } catch (failure OperationCanceledException) {
            return
        } catch (failure Exception) {
            message = failure.Message
        }
        owner.TryPost(
            () -> {
                if id != generation || token.IsCancellationRequested {
                    return
                }
                wallets = found
                issue = message
                Rebuild()
            }
        )
    }

    override func Build() Blob {
        let card = WalletParts.PageCard(input.Ui, maxWidth: 560, fill: true)
        if form.Length > 0 {
            card.Add(
                Cell.Mount[LibraryFormInput, LibraryForm](
                    network + directory + form,
                    LibraryFormInput{
                        Session: input.Session,
                        Ui: input.Ui,
                        Kind: form,
                        Busy: input.Busy,
                        Language: input.Language,
                        OnBack: back,
                        OnCreate: input.OnCreate
                    }
                )
            )
        } else {
            card.Add(Cell.Mount[LibraryList](network + directory + input.ActiveWallet, configureList))
        }
        return card
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        request?.Cancel()
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
    var Wallets IReadOnlyDictionary[string, DateTime]
    var Issue string
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnNavigate Action[AppPage]
    var OnUnlock Action[string, Func[CancellationToken, Task], Action]
    var OnStart Action[string]
}

class LibraryList : Cell, IDisposable {
    private var input LibraryListInput
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var generation int32
    private var opened string?
    private var password string = ""
    private var issue string = ""
    private var busy bool

    func Accept(next LibraryListInput) {
        if EqualityComparer[LibraryListInput].Default.Equals(input, next) {
            return
        }
        input = next
        Rebuild()
    }

    override func Build() Blob {
        let ui = input.Ui
        let card = Container{Gap: AppTheme.Space14, MinHeight: 0}
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
                        Tile(input, "draft", "Open file", false, () -> ImportFile(input))
                    }
                }
            )
        } else {
            header.Add(
                Cell.Mount[LibraryMenuInput, LibraryMenu](
                    "add-wallet",
                    LibraryMenuInput{
                        Ui: ui,
                        Busy: input.Busy || busy,
                        Language: input.Language,
                        OnStart: input.OnStart,
                        OnImport: ImportCurrent
                    }
                )
            )
            let list = Container{
                Gap: AppTheme.Space8,
                MinHeight: 0,
                FlexShrink: 1,
                OverflowY: Overflow.Scroll,
                ScrollbarY: Theme.Read().Scrollbar
            }
            for (filename, used) in input.Wallets {
                list.Add(Row(input, filename, used, input.State != WalletState.Unloaded))
            }
            card.Add(ListParts.Viewport(list, grow: false))
        }
        if input.Issue.Length > 0 {
            card.Add(MessageParts.Problem(ui, input.Issue))
        }
        if issue.Length > 0 && (opened ?? input.ActiveWallet).Length == 0 {
            card.Add(Issue(ui))
        }
        return card
    }

    private func ImportCurrent() -> ImportFile(input)

    private func ImportFile(input LibraryListInput) {
        input.ChooseFile.Invoke(
            FileDialogKind.OpenFile,
            "Import wallet",
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            path -> {
                Run(ct -> input.Session.Library.ImportFileAsync(path, ct))
                Rebuild()
            }
        )
    }

    private func Issue(ui Presentation) Blob -> MessageParts.Problem(ui, issue)

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
            Disabled: input.Busy || busy,
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

    private func Row(input LibraryListInput, filename string, used DateTime, loaded bool) Blob {
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
            Disabled: input.Busy || busy,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label, Expanded: expanded},
            OnClick: () -> {
                if busy || input.Busy {
                    return
                }
                opened = expanded ? "": filename
                password = ""
                issue = ""
                if loaded && !active {
                    Run(ct -> input.Session.Library.ChooseWalletAsync(filename, ct), expectedWallet: filename)
                }
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
                    input.Busy || busy
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
            head
        }
        if !expanded {
            return row
        }
        let unlock = WalletForm(ui, !input.Busy && !busy, () -> Unlock(input, filename), []string{password})
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
                                Rebuild()
                            },
                            secret: true,
                            disabled: input.Busy || busy,
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
        var message = ""
        password = ""
        issue = ""
        busy = true
        generation++
        let id = generation
        input.OnUnlock.Invoke(
            text,
            (ct CancellationToken) -> OpenWallet(session, active, filename, secret, value -> message = value, ct),
            () -> {
                if id != generation || lifetime.IsCancellationRequested {
                    return
                }
                let current = this.input
                if session != current.Session || current.ActiveWallet != filename {
                    return
                }
                busy = false
                issue = message
                Rebuild()
            }
        )
    }

    private async func OpenWallet(
        session WalletSession,
        active string,
        filename string,
        secret[]char,
        report Action[string],
        ct CancellationToken
    ) {
        try {
            if filename != active {
                await session.Library.ChooseWalletAsync(filename, ct)
            }
            await session.UnlockAsync(secret, ct)
        } catch (failure Exception) {
            report(failure.Message)
        } finally {
            Array.Clear(secret)
        }
    }

    private func Run(action Func[CancellationToken, Task], expectedWallet string = "") {
        let source = input
        guard let owner = source.Ui.Actions.window else {
            return
        }
        if busy {
            return
        }
        busy = true
        issue = ""
        generation++
        let id = generation
        let token = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, owner.Closed)
        go Complete(action, source, owner, id, token, expectedWallet)
    }

    private async func Complete(
        action Func[CancellationToken, Task],
        source LibraryListInput,
        owner Window,
        id int32,
        token CancellationTokenSource,
        expectedWallet string
    ) {
        var message = ""
        try {
            await action(token.Token)
        } catch (failure OperationCanceledException) when token.IsCancellationRequested {
            return
        } catch (failure Exception) {
            message = failure.Message
        } finally {
            token.Dispose()
        }
        owner.TryPost(
            () -> {
                let current = input
                if id != generation ||
                    lifetime.IsCancellationRequested ||
                    source.Session != current.Session ||
                    source.Directory != current.Directory ||
                    (source.ActiveWallet != current.ActiveWallet && expectedWallet != current.ActiveWallet) {
                    return
                }
                busy = false
                issue = message
                Rebuild()
            }
        )
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        lifetime.Dispose()
        password = ""
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

    private func Start(input LibraryMenuInput, kind string) {
        menu = false
        input.OnStart(kind)
    }

    private func ImportFile(input LibraryMenuInput) {
        menu = false
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
                    Item(input, "add", "Create", () -> Start(input, "Create")),
                    Item(input, "replay", "Restore · 12 words", () -> Start(input, "Phrase")),
                    Item(input, "key", "Import view keys", () -> Start(input, "ViewOnly")),
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
    var Busy bool
    var Language string
    var OnBack Action
    var OnCreate Action[string, []char]
}

class LibraryForm : Cell[LibraryFormInput], IDisposable {
    private let lifetime CancellationTokenSource = CancellationTokenSource()
    private var generation int32
    private var busy bool
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
        let disabled = input.Busy || busy
        let ui = input.Ui
        let required = if form == "Phrase" {
            []string{name.Trim(), phrase.Trim()}
        } else if form == "ViewOnly" {
            []string{name.Trim(), spendKey, viewKey}
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
        fields.PasswordPair(
            card,
            password,
            confirmation,
            value -> password = value,
            value -> confirmation = value,
            issue,
            value -> {
                issue = value
                Rebuild()
            },
            disabled
        )
        card.Add(
            ActionRow([]Blob{Button(ui, form == "Create" ? "Create": "Import", fields.Submit, !fields.CanSubmit, true)})
        )
        return card
    }

    private func Submit(input LibraryFormInput) {
        let filename = WalletFile(name)
        let secret = password.ToCharArray()
        let session = input.Session
        password = ""
        confirmation = ""
        if input.Kind == "Create" {
            input.OnCreate(filename, secret)
            return
        }
        guard let owner = input.Ui.Actions.window else {
            Array.Clear(secret)
            return
        }
        let extra = (input.Kind == "Phrase" ? phrase: viewKey).ToCharArray()
        let publicKey = spendKey.ToCharArray()
        let directory = session.Settings.WalletDirectory
        let network = session.Settings.Network
        let token = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, owner.Closed)
        busy = true
        issue = ""
        generation++
        let id = generation
        go Import(input, filename, secret, extra, publicKey, directory, network.ToString(), owner, id, token)
    }

    private async func Import(
        source LibraryFormInput,
        filename string,
        secret[]char,
        extra[]char,
        publicKey[]char,
        directory string,
        network string,
        owner Window,
        id int32,
        token CancellationTokenSource
    ) {
        var message = ""
        try {
            if source.Kind == "Phrase" {
                await source.Session.ImportPhraseAsync(filename, extra, secret, token.Token)
            } else {
                await source.Session.ImportViewOnlyAsync(filename, publicKey, extra, secret, token.Token)
            }
        } catch (failure OperationCanceledException) when token.IsCancellationRequested {
            return
        } catch (failure Exception) {
            message = failure.Message
        } finally {
            Array.Clear(secret)
            Array.Clear(extra)
            Array.Clear(publicKey)
            token.Dispose()
        }
        owner.TryPost(
            () -> {
                if id != generation ||
                    lifetime.IsCancellationRequested ||
                    directory != source
                    .Session
                    .Settings
                    .WalletDirectory ||
                    network != source
                    .Session
                    .Settings
                    .Network
                    .ToString() {
                    return
                }
                busy = false
                issue = message
                if message.Length == 0 {
                    source.OnBack()
                } else {
                    Rebuild()
                }
            }
        )
    }

    func Dispose() {
        generation++
        lifetime.Cancel()
        lifetime.Dispose()
        password = ""
        confirmation = ""
        phrase = ""
        viewKey = ""
    }
}
