package Gyroid.Views

import Goo
import Goo.Widgets
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
import System.Globalization
import System.IO
import System.Linq

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
    var OnBackup Action[[]char]
}

class LibraryPage : Cell[LibraryInput], IDisposable {
    private let menuAnchor ElementHandle = ElementHandle()

    private let wallets SortedDictionary[string, DateTime] = SortedDictionary[string, DateTime](StringComparer.Ordinal)

    private var state WalletState? = nil

    private var activeWallet string = ""

    private var form string = ""

    private var opened string = ""

    private var menu bool

    private var issue string = ""

    private var name string = ""

    private var password string = ""

    private var confirmation string = ""

    private var phrase string = ""

    private var spendKey string = ""

    private var viewKey string = ""

    protected override func Build(input LibraryInput) Blob {
        let ui = input.Ui
        if input.State != state || input.ActiveWallet != activeWallet {
            state = input.State
            activeWallet = input.ActiveWallet
            Load(input)
        }
        let card = WalletParts.Card(ui, gap: 14, radius: 14)
        card.Width = Percent(100)
        card.MaxWidth = 560
        card.MaxHeight = Percent(100)
        if form.Length > 0 {
            return Form(input, card)
        }
        let loaded = input.State != WalletState.Unloaded
        let header = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            FlexShrink: 0,
            Grow(Label(ui, ui.Strings.Get("wallets"), 17, ui.Ink, "")),
            WalletParts.Square(
                ui,
                "settings",
                ui.Strings.Get("Settings"),
                false,
                input.Busy,
                () -> input.OnNavigate(AppPage.Settings)
            )
        }
        card.Add(header)
        card.Add(Label(ui, input.Session.Settings.WalletDirectory, 12, ui.Dim, ""))
        if wallets.Count == 0 {
            card.Add(
                Container{
                    Gap: 10,
                    FlexShrink: 0,
                    Container{
                        FlexDirection: FlexDirection.Row,
                        Gap: 10,
                        Tile(input, "add", "Create", true, () -> Start("Create")),
                        Tile(input, "replay", "Restore · 12 words", false, () -> Start("Phrase"))
                    },
                    Container{
                        FlexDirection: FlexDirection.Row,
                        Gap: 10,
                        Tile(input, "key", "Import view keys", false, () -> Start("ViewOnly")),
                        Tile(input, "draft", "Open file", false, () -> ImportFile(input))
                    }
                }
            )
        } else {
            header.Add(
                Container{
                    Handle: menuAnchor,
                    FlexShrink: 0,
                    WalletParts.Square(
                        ui,
                        "add",
                        ui.Strings.Get("Add wallet"),
                        menu,
                        input.Busy,
                        () -> {
                            menu = !menu
                            Rebuild()
                        }
                    ),
                    Menu(input)
                }
            )
            let list = Container{
                Gap: 8,
                MinHeight: 0,
                FlexShrink: 1,
                OverflowY: Overflow.Scroll,
                ScrollbarY: Theme.Read().Scrollbar
            }
            for (filename, used) in wallets {
                list.Add(Row(input, filename, used, loaded))
            }
            card.Add(list)
        }
        if issue.Length > 0 && opened.Length == 0 {
            card.Add(Issue(ui))
        }
        return card
    }

    private func Clear() {
        form = ""
        menu = false
        name = ""
        password = ""
        confirmation = ""
        phrase = ""
        spendKey = ""
        viewKey = ""
    }

    private func Load(input LibraryInput) {
        Clear()
        opened = input.ActiveWallet
        wallets.Clear()
        try {
            for filename in input.Session.Library.ListWallets() {
                wallets[filename] = File.GetLastWriteTime(input.Session.Library.WalletPath(filename))
            }
        } catch (failure WalletException) {
            issue = failure.Message
        }
    }

    private func Start(kind string) {
        Clear()
        issue = ""
        form = kind
        Rebuild()
    }

    private func ImportFile(input LibraryInput) {
        menu = false
        Rebuild()
        input.ChooseFile.Invoke(
            FileDialogKind.OpenFile,
            "Import wallet",
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            (path string) -> input.Ui.Actions.Run(ct -> input.Session.Library.ImportFileAsync(path, ct))
        )
    }

    private func Issue(ui Presentation) Blob -> Text{
        Content: ui.Strings.Explain(issue),
        FontFamily: ui.Font,
        FontSize: 12,
        Color: ui.Pink,
        TextWrap: TextWrap.Wrap,
        FlexShrink: 0,
        Accessibility: Accessibility{Role: AccessibilityRole.Alert, Name: ui.Strings.Explain(issue)}
    }

    private func Tile(input LibraryInput, icon string, label string, primary bool, click Action) Blob {
        let ui = input.Ui
        let button = Goo
            .Button{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Height: 84,
            AlignItems: AlignItems.FlexStart,
            JustifyContent: JustifyContent.Center,
            Gap: 8,
            Padding: Edges{Left: 16, Right: 16},
            BorderWidth: 1,
            BorderRadius: 10,
            BorderColor: primary ? ui.Lime: ui.Rule,
            BackgroundColor: ui.Surface,
            Disabled: input.Busy,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get(label)},
            OnClick: click,
            MaterialIcons.Create(icon, 20, ui.Lime),
            Label(ui, ui.Strings.Get(label), 14, ui.Ink, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Menu(input LibraryInput) Blob {
        let ui = input.Ui
        return Cell.Mount[PopoverInput, Popover](
            "menu",
            PopoverInput{
                Open: menu,
                Anchor: menuAnchor,
                Placement: PopoverPlacement.BottomEnd,
                Gap: 8,
                Width: 250,
                Padding: 6,
                BackgroundColor: ui.Control,
                BorderColor: ui.Edge,
                Role: AccessibilityRole.Menu,
                AccessibilityName: ui.Strings.Get("Add wallet"),
                Content: Container{
                    MinWidth: 0,
                    Item(input, "add", "Create", () -> Start("Create")),
                    Item(input, "replay", "Restore · 12 words", () -> Start("Phrase")),
                    Item(input, "key", "Import view keys", () -> Start("ViewOnly")),
                    Item(input, "draft", "Open file", () -> ImportFile(input))
                },
                OnDismiss: reason -> {
                    menu = false
                    Rebuild()
                }
            }
        )
    }

    private func Item(input LibraryInput, icon string, label string, click Action) Blob {
        let ui = input.Ui
        let button = Goo
            .Button{
            Height: 38,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.FlexStart,
            Gap: 10,
            Padding: Edges{Left: 10, Right: 10},
            BorderRadius: 7,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.MenuItem, Name: ui.Strings.Get(label)},
            OnClick: click,
            MaterialIcons.Create(icon, 16, ui.Lime),
            Label(ui, ui.Strings.Get(label), 14, ui.Body, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Row(input LibraryInput, filename string, used DateTime, loaded bool) Blob {
        let ui = input.Ui
        let active = loaded && filename == input.ActiveWallet
        let expanded = filename == opened
        let label = WalletName(filename)
        let colors = []Color{ui.Lime, ui.Blue, ui.Orange, ui.Mint, ui.Violet, ui.Pink}
        let button = Goo
            .Button{
            Height: 48,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Disabled: input.Busy,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label, Expanded: expanded},
            OnClick: () -> {
                if ui.Working() {
                    return
                }
                let chooseWallet = () -> {
                    state = input.Session.State
                    opened = expanded ? "": filename
                    password = ""
                    issue = ""
                    Rebuild()
                }
                if loaded && !active {
                    ui.Actions.Run(ct -> input.Session.Library.ChooseWalletAsync(filename, ct), chooseWallet)
                } else {
                    chooseWallet()
                }
            },
            Container{
                Width: 10,
                Height: 10,
                BorderRadius: 3,
                FlexShrink: 0,
                BackgroundColor: colors[filename.Sum((c char) -> int32(c)) % colors.Length]
            },
            Grow(
                Label(
                    ui,
                    label,
                    14,
                    if active {
                        ui.Mint
                    } else {
                        ui.Ink
                    },
                    ""
                )
            ),
            Label(ui, Used(ui, used), 13, ui.Dim, ""),
            if active {
                Container{}
            } else {
                Container{FlexShrink: 0, MaterialIcons.Create(expanded ? "expand_more": "chevron_right", 16, ui.Dim)}
            }
        }
        WidgetKeyBindings.BindActivation(button)
        let head = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            Height: 48,
            FlexShrink: 0,
            Grow(button)
        }
        if active {
            head.Add(
                WalletParts.Square(
                    ui,
                    "download",
                    ui.Strings.Get("Unload"),
                    false,
                    input.Busy,
                    () -> ui.Actions.Run(ct -> input.Session.UnloadAsync(ct))
                )
            )
        }
        let row = Container{
            Padding: Edges{Left: 12, Right: 12},
            BorderWidth: 1,
            BorderRadius: 10,
            BorderColor: expanded ? ui.Edge: ui.Rule,
            BackgroundColor: expanded ? ui.Raised: ui.Surface,
            FlexShrink: 0,
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
                Gap: 10,
                Padding: Edges{Bottom: issue.Length > 0 ? 8.0: 12.0},
                Grow(
                    Container{
                        MinWidth: 0,
                        unlock.Entry(
                            TextField{
                                AccessibilityName: ui.Strings.Get("Password"),
                                Value: password,
                                Controlled: true,
                                Password: true,
                                RevealButton: true,
                                Invalid: issue.Length > 0,
                                Disabled: input.Busy,
                                OnChange: value -> {
                                    password = value
                                    issue = ""
                                    Rebuild()
                                }
                            }
                        )
                    }
                ),
                Button(ui, "Unlock", unlock.Submit, !unlock.CanSubmit, true)
            }
        )
        if issue.Length > 0 {
            row.Add(Container{Padding: Edges{Bottom: 10}, Issue(ui)})
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

    private func Unlock(input LibraryInput, filename string) {
        let secret = password.ToCharArray()
        password = ""
        issue = ""
        input.Ui.Actions.Run(ct -> OpenWallet(input, filename, secret, ct), nil, secret)
    }

    private async func OpenWallet(
        input LibraryInput,
        filename string,
        secret[]char,
        ct System.Threading.CancellationToken
    ) {
        try {
            if filename != input.ActiveWallet {
                await input.Session.Library.ChooseWalletAsync(filename, ct)
            }
            await input.Session.UnlockAsync(secret, ct)
            if input.Session.Keys.BackupPending {
                input.OnBackup.Invoke(secret.ToArray())
            }
        } catch (failure WalletException) {
            if failure.Message != "Wrong wallet password" {
                throw failure
            }
            issue = failure.Message
        }
    }

    private func Form(input LibraryInput, card Container) Blob {
        let ui = input.Ui
        let required = if form == "Phrase" {
            []string{name.Trim(), phrase.Trim()}
        } else if form == "ViewOnly" {
            []string{name.Trim(), spendKey, viewKey}
        } else {
            []string{name.Trim()}
        }
        let fields = WalletForm(ui, !input.Busy, () -> Submit(input), required)
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 12,
                FlexShrink: 0,
                WalletParts.Square(
                    ui,
                    "arrow_back",
                    ui.Strings.Get("Back"),
                    false,
                    input.Busy,
                    () -> {
                        Clear()
                        issue = ""
                        Rebuild()
                    }
                ),
                Label(
                    ui,
                    ui.Strings.Get(
                        switch form {
                            case "Phrase": "restore wallet"
                            case "ViewOnly": "import view keys"
                            default: "create wallet"
                        }
                    ),
                    17,
                    ui.Ink,
                    ""
                )
            }
        )
        card.Add(
            fields.Row(
                "Name",
                name,
                value -> {
                    name = value
                    Rebuild()
                },
                disabled: input.Busy
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
                    disabled: input.Busy
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
                    disabled: input.Busy
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
                    disabled: input.Busy
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
            input.Busy
        )
        card.Add(
            ActionRow([]Blob{Button(ui, form == "Create" ? "Create": "Import", fields.Submit, !fields.CanSubmit, true)})
        )
        return card
    }

    private func Submit(input LibraryInput) {
        let filename = WalletFile(name)
        let secret = password.ToCharArray()
        let session = input.Session
        password = ""
        confirmation = ""
        if form == "Phrase" {
            let words = phrase.ToCharArray()
            input.Ui.Actions.Run(ct -> session.ImportPhraseAsync(filename, words, secret, ct), Clear, secret, words)
        } else if form == "ViewOnly" {
            let key = viewKey.ToCharArray()
            input
                .Ui
                .Actions
                .Run(
                ct -> session.ImportViewOnlyAsync(filename, spendKey.ToCharArray(), key, secret, ct),
                nil,
                secret,
                key
            )
        } else {
            input.OnCreate(filename, secret)
        }
    }

    func Dispose() {
        Clear()
    }
}
