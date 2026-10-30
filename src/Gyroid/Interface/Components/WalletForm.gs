package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Feedback
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.IO

class WalletForm {
    private let ui Presentation
    private let edited Action?
    private let submit Action?
    private var password string?
    private var confirmation string?
    private var passwordIssue Action[string]?
    var CanSubmit bool
    init(ui Presentation, enabled bool, submit Action?, required[]string, edited Action? = nil) {
        this.ui = ui
        this.edited = edited
        this.submit = submit
        var complete = enabled
        for value in required {
            complete = complete && value.Length > 0
        }
        CanSubmit = complete
    }

    func Submit() {
        if !CanSubmit {
            return
        }
        if let value = password {
            let secret = value.ToCharArray()
            let again = (confirmation ?? "").ToCharArray()
            let issue = WalletValidation.PasswordError(secret, again)
            Array.Clear(secret)
            Array.Clear(again)
            passwordIssue?.Invoke(issue)
            if issue.Length > 0 {
                return
            }
        }
        submit?.Invoke()
    }

    func Bind(field TextField) TextField -> field with{OnSubmit = _ -> Submit()}

    func Entry(field TextField) Blob -> ui.Entry(Bind(field))

    func Bind(entry TextEntry) TextEntry {
        entry.OnSubmit = _ -> Submit()
        return entry
    }

    func Field(
        label string,
        value string,
        changed Action[string],
        secret bool = false,
        issue string = "",
        disabled bool = false,
        labelled bool = true,
        hidden bool = false
    ) Blob -> Bind(
        TextField{
            Label: labelled ? ui.Strings.Get(label): nil,
            AccessibilityName: ui.Strings.Get(label),
            Value: value,
            Controlled: true,
            Password: secret || hidden,
            RevealButton: secret,
            IssueText: issue.Length > 0 ? ui.Strings.Explain(issue): nil,
            Invalid: issue.Length > 0,
            Disabled: disabled || ui.Working(),
            Width: Percent(100),
            FontFamily: ui.Font,
            ContentDirection: Direction.LeftToRight,
            OnChange: text -> {
                changed(text)
                edited?.Invoke()
            }
        }
    ).Build()

    func Row(
        label string,
        value string,
        changed Action[string],
        secret bool = false,
        issue string = "",
        disabled bool = false
    ) Blob -> FormField{
        Content: ui.Grow(
            Container{
                MinWidth: 0,
                ui.Entry(
                    Bind(
                        TextField{
                            AccessibilityName: ui.Strings.Get(label),
                            Value: value,
                            Controlled: true,
                            Password: secret,
                            RevealButton: secret,
                            Invalid: issue.Length > 0,
                            IssueText: issue.Length > 0 ? ui.Strings.Explain(issue): nil,
                            Disabled: disabled,
                            ContentDirection: Direction.LeftToRight,
                            OnChange: changed
                        }
                    )
                )
            }
        ),
        CreateRoot: (_, root) -> Container{
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
            root.Children[0]
        }
    }.Build()

    func PasswordPair(
        card Container,
        password string,
        confirmation string,
        changed Action[string],
        confirmed Action[string],
        issue string,
        setIssue Action[string],
        disabled bool
    ) {
        this.password = password
        this.confirmation = confirmation
        passwordIssue = setIssue
        CanSubmit = CanSubmit && password.Length > 0 && confirmation.Length > 0
        card.Add(
            Row(
                "Password",
                password,
                value -> {
                    changed(value)
                    setIssue("")
                },
                true,
                disabled: disabled
            )
        )
        card.Add(
            Row(
                "Confirm",
                confirmation,
                value -> {
                    confirmed(value)
                    setIssue("")
                },
                true,
                issue,
                disabled
            )
        )
    }

    func Labelled(label string, field Blob) Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.Center,
        Gap: 10,
        FlexShrink: 0,
        Container{Width: 130, FlexShrink: 0, ui.Label(label.Length > 0 ? ui.Strings.Get(label): "", 12.5, ui.Body, "")},
        ui.Grow(Container{MinWidth: 0, field})
    }

    func PathField(
        label string,
        current string,
        kind FileDialogKind,
        changed Action[string],
        disabled bool,
        choose Action[FileDialogKind, string, string, Action[string]],
        busy bool,
        issue string = ""
    ) Blob -> Container{
        Gap: Theme.Read().ControlGap,
        FlexShrink: 0,
        ui.Label(ui.Strings.Get(label), Theme.Read().LabelFontSize, ui.Body, ""),
        Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            Gap: 8,
            FlexShrink: 0,
            ui.Grow(
                Container{
                    MinWidth: 0,
                    Field(label, current, changed, issue: issue, disabled: disabled, labelled: false)
                }
            ),
            ui.Button(
                "Browse",
                () -> choose.Invoke(
                    kind,
                    label,
                    Path.IsPathFullyQualified(current) ? current: Environment.GetFolderPath(
                        Environment.SpecialFolder.UserProfile
                    ),
                    value -> {
                        changed(value)
                        edited?.Invoke()
                    }
                ),
                disabled || busy
            )
        }
    }

    shared {
        func Modal(
            ui Presentation,
            window Window?,
            availableWidth float64,
            key string,
            name string,
            width float64,
            header Blob,
            content Blob,
            footer Blob,
            close Action
        ) Blob -> Cell
            .Mount[ModalDialog, ModalDialogHost](
            key,
            ModalDialog{
                Open: true,
                CreateRoot: ui.DialogRoot,
                KeyBindings: WidgetKeyBindings.Editing(window?.PlatformInput),
                AccessibilityName: ui.Strings.Get(name),
                Width: Math.Min(availableWidth - 40, width),
                MaxHeight: Percent(100),
                Padding: 22,
                Gap: 14,
                BackgroundColor: ui.Raised,
                BorderRadius: 14,
                Header: header,
                Content: content,
                Footer: footer,
                OnCancel: close,
                OnClose: close
            }
        )
    }
}
