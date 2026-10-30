package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Inputs
import Gyroid.Interface.ControlParts
import Gyroid.Interface.LayoutParts
import Gyroid.Interface.TextParts
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
            let issue = WalletValidation.PasswordError(value.AsSpan(), (confirmation ?? "").AsSpan())
            passwordIssue?.Invoke(issue)
            if issue.Length > 0 {
                return
            }
        }
        submit?.Invoke()
    }

    func Bind(field TextField) TextField -> field with{OnSubmit = _ -> Submit()}

    func Entry(field TextField) Blob -> ControlParts.Entry(ui, Bind(field))

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
        Content: Grow(
            Container{
                MinWidth: 0,
                ControlParts.Entry(
                    ui,
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
        CreateRoot: (_, root) -> {
            root.FlexDirection = FlexDirection.Row
            root.Gap = 12
            root.FlexShrink = 0
            root.Children.Insert(
                0,
                Container{
                    Width: 136,
                    Height: 38,
                    FlexShrink: 0,
                    JustifyContent: JustifyContent.Center,
                    Label(ui, ui.Strings.Get(label), 13, ui.Body, "")
                }
            )
            return root
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
        Container{
            Width: 130,
            FlexShrink: 0,
            Label(ui, label.Length > 0 ? ui.Strings.Get(label): "", 12.5, ui.Body, "")
        },
        Grow(Container{MinWidth: 0, field})
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
        Label(ui, ui.Strings.Get(label), Theme.Read().LabelFontSize, ui.Body, ""),
        Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            Gap: 8,
            FlexShrink: 0,
            Grow(
                Container{
                    MinWidth: 0,
                    Field(label, current, changed, issue: issue, disabled: disabled, labelled: false)
                }
            ),
            Button(
                ui,
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
}
