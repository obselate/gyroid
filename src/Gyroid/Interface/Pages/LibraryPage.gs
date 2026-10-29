package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Globalization
import System.IO
import System.Linq

data struct LibraryInput {
    var Session WalletSession
    var Ui Presentation
    var State string
    var ActiveWallet string
    var Busy bool
    var Language string
    var ChooseFile Action[FileDialogKind, string, string, Action[string]]
    var OnNavigate Action[string]
    var OnCreate Action[string, []char]
}

class LibraryPage : Cell[LibraryInput], IDisposable {
    private let menuAnchor ElementHandle = ElementHandle()

    private let wallets SortedDictionary[string, DateTime] = SortedDictionary[string, DateTime](StringComparer.Ordinal)

    private var state string = ""

    private var activeWallet string = ""

    private var form string = ""

    private var opened string = ""

    private var menu bool

    private var reveal bool

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
        let card = ui.Glass()
        card.Width = Percent(100)
        card.MaxWidth = 560
        card.MaxHeight = Percent(100)
        card.BorderRadius = 14
        card.Gap = 14
        if form.Length > 0 {
            return Form(input, card)
        }
        let loaded = input.State != "Unloaded"
        let header = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            FlexShrink: 0,
            ui.Grow(ui.Label(ui.Strings.Get("wallets"), 17, ui.Ink, "")),
            Square(input, "settings", "Settings", false, false, () -> input.OnNavigate("Settings"))
        }
        card.Add(header)
        card.Add(ui.Label(input.Session.Settings.WalletDirectory, 12, ui.Dim, ""))
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
                    Square(
                        input,
                        "add",
                        "Add wallet",
                        menu,
                        loaded,
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
        reveal = false
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
        if opened.Length > 0 && !wallets.ContainsKey(opened) {
            wallets[opened] = DateTime.MinValue
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
            (path string) -> input.Ui.Run(input.Session.Library.ImportFileAsync(path))
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

    private func Square(input LibraryInput, icon string, label string, active bool, disabled bool, click Action) Blob {
        let ui = input.Ui
        let off = disabled || input.Busy
        let button = Goo
            .Button{
            Width: 38,
            Height: 38,
            FlexShrink: 0,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            BorderWidth: 1,
            BorderRadius: 8,
            BorderColor: active ? ui.Lime: ui.Edge,
            BackgroundColor: Color.Parse("#0b0b0b"),
            Disabled: off,
            Hover: Style{BackgroundColor: ui.Rule},
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: ui.Strings.Get(label)},
            OnClick: click,
            MaterialIcons.Create(
                icon,
                16,
                if active {
                    ui.Lime
                } else if off {
                    ui.Dim
                } else {
                    ui.Body
                }
            )
        }
        WidgetKeyBindings.BindActivation(button)
        return button
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
            ui.Label(ui.Strings.Get(label), 14, ui.Ink, "")
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
                BackgroundColor: Color.Parse("#0b0b0b"),
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
            ui.Label(ui.Strings.Get(label), 14, ui.Body, "")
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Row(input LibraryInput, filename string, used DateTime, loaded bool) Blob {
        let ui = input.Ui
        let active = loaded && filename == input.ActiveWallet
        let expanded = filename == opened
        let label = ui.WalletName(filename)
        let colors = []Color{ui.Lime, ui.Blue, ui.Orange, ui.Mint, ui.Violet, ui.Pink}
        let button = Goo
            .Button{
            Height: 48,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            Disabled: input.Busy || loaded && !active,
            Focus: Theme.Read().FocusStyle,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label, Expanded: expanded},
            OnClick: () -> {
                opened = expanded ? "": filename
                password = ""
                reveal = false
                issue = ""
                Rebuild()
            },
            Container{
                Width: 10,
                Height: 10,
                BorderRadius: 3,
                FlexShrink: 0,
                BackgroundColor: colors[filename.Sum((c char) -> int32(c)) % colors.Length]
            },
            ui.Grow(
                ui.Label(
                    label,
                    14,
                    if active {
                        ui.Mint
                    } else if loaded {
                        ui.Dim
                    } else {
                        ui.Ink
                    },
                    ""
                )
            ),
            ui.Label(Used(ui, used), 13, ui.Dim, ""),
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
            ui.Grow(button)
        }
        if active {
            head.Add(Square(input, "download", "Unload", false, false, () -> ui.Run(input.Session.UnloadAsync())))
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
        row.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 10,
                Padding: Edges{Bottom: issue.Length > 0 ? 8.0: 12.0},
                ui.Grow(
                    Container{
                        MinWidth: 0,
                        ui.Entry(
                            TextField{
                                AccessibilityName: ui.Strings.Get("Password"),
                                Value: password,
                                Controlled: true,
                                Password: !reveal,
                                Invalid: issue.Length > 0,
                                Disabled: input.Busy,
                                OnChange: value -> {
                                    password = value
                                    issue = ""
                                    Rebuild()
                                },
                                OnSubmit: _ -> Unlock(input, filename)
                            }
                        )
                    }
                ),
                Square(
                    input,
                    reveal ? "visibility_off": "visibility",
                    "Show password",
                    reveal,
                    false,
                    () -> {
                        reveal = !reveal
                        Rebuild()
                    }
                ),
                ui.Button("Unlock", () -> Unlock(input, filename), input.Busy || password.Length == 0, true)
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
        if input.Busy || password.Length == 0 {
            return
        }
        let secret = password.ToCharArray()
        password = ""
        issue = ""
        input.Ui.Run(OpenWallet(input, filename, secret), nil, secret)
    }

    private async func OpenWallet(input LibraryInput, filename string, secret[]char) {
        try {
            if filename != input.ActiveWallet {
                await input.Session.Library.ChooseWalletAsync(filename)
            }
            await input.Session.UnlockAsync(secret)
        } catch (failure WalletException) {
            if failure.Message != "Wrong wallet password" {
                throw failure
            }
            issue = failure.Message
        }
    }

    private func Form(input LibraryInput, card Container) Blob {
        let ui = input.Ui
        card.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 12,
                FlexShrink: 0,
                Square(
                    input,
                    "arrow_back",
                    "Back",
                    false,
                    false,
                    () -> {
                        Clear()
                        issue = ""
                        Rebuild()
                    }
                ),
                ui.Label(
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
        card.Add(Line(input, "Name", name, value -> name = value, false, ""))
        if form == "Phrase" {
            card.Add(Line(input, "Recovery phrase", phrase, value -> phrase = value, true, ""))
        }
        if form == "ViewOnly" {
            card.Add(Line(input, "Spend public key", spendKey, value -> spendKey = value.Trim(), false, ""))
            card.Add(Line(input, "View private key", viewKey, value -> viewKey = value.Trim(), true, ""))
        }
        card.Add(
            Line(
                input,
                "Password",
                password,
                value -> {
                    password = value
                    issue = ""
                },
                true,
                ""
            )
        )
        card.Add(
            Line(
                input,
                "Confirm",
                confirmation,
                value -> {
                    confirmation = value
                    issue = ""
                },
                true,
                issue
            )
        )
        card.Add(
            ui.ActionRow(
                []Blob{
                    ui.Button(
                        form == "Create" ? "Create": "Import",
                        () -> Submit(input),
                        input.Busy || Incomplete(),
                        true
                    )
                }
            )
        )
        return card
    }

    private func Line(
        input LibraryInput,
        label string,
        value string,
        changed Action[string],
        secret bool,
        problem string
    ) Blob {
        let ui = input.Ui
        return Container{
            FlexDirection: FlexDirection.Row,
            Gap: 12,
            FlexShrink: 0,
            Container{
                Width: 136,
                Height: 38,
                FlexShrink: 0,
                JustifyContent: JustifyContent.Center,
                ui.Label(ui.Strings.Get(label), 13, ui.Body, "")
            },
            ui.Grow(
                Container{
                    MinWidth: 0,
                    ui.Entry(
                        TextField{
                            AccessibilityName: ui.Strings.Get(label),
                            Value: value,
                            Controlled: true,
                            Password: secret,
                            RevealButton: secret,
                            Invalid: problem.Length > 0,
                            IssueText: if problem.Length > 0 {
                                ui.Strings.Explain(problem)
                            } else {
                                nil
                            },
                            Disabled: input.Busy,
                            ContentDirection: Direction.LeftToRight,
                            OnChange: text -> {
                                changed(text)
                                Rebuild()
                            },
                            OnSubmit: _ -> Submit(input)
                        }
                    )
                }
            )
        }
    }

    private func Incomplete() bool -> name.Trim()
        .Length == 0 ||
        password.Length == 0 ||
        form == "Phrase" &&
        phrase
        .Trim().Length == 0 || form == "ViewOnly" && (spendKey.Length == 0 || viewKey.Length == 0)

    private func Submit(input LibraryInput) {
        if input.Busy || Incomplete() {
            return
        }
        let filename = input.Ui.WalletFile(name)
        let secret = password.ToCharArray()
        let again = confirmation.ToCharArray()
        issue = WalletValidation.PasswordError(secret, again)
        Array.Clear(again)
        if issue.Length > 0 {
            Array.Clear(secret)
            Rebuild()
            return
        }
        let session = input.Session
        password = ""
        confirmation = ""
        if form == "Phrase" {
            let words = phrase.ToCharArray()
            phrase = ""
            input.Ui.Run(session.ImportPhraseAsync(filename, words, secret), nil, secret, words)
        } else if form == "ViewOnly" {
            let key = viewKey.ToCharArray()
            input.Ui.Run(session.ImportViewOnlyAsync(filename, spendKey.ToCharArray(), key, secret), nil, secret, key)
        } else {
            input.OnCreate(filename, secret)
        }
    }

    func Dispose() {
        Clear()
    }
}
