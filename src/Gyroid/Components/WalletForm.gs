package Gyroid.Components

import Goo
import Goo.Widgets
import Goo.Widgets.Inputs
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
import Gyroid.Components.TextParts
import Gyroid.Services
import Gyroid.Views
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
        hidden bool = false,
        leading Blob? = nil,
        trailing Blob? = nil
    ) Blob -> Bind(
        FieldInput(
            label,
            value,
            text -> {
                changed(text)
                edited?.Invoke()
            },
            secret,
            issue,
            disabled || ui.Working()
        ) with{
            Label = labelled ? ui.Strings.Get(label): nil,
            Password = secret || hidden,
            Leading = leading,
            Trailing = trailing
        }
    ).Build()

    private func FieldInput(
        label string,
        value string,
        changed Action[string],
        secret bool,
        issue string,
        disabled bool
    ) TextField -> AppTheme.FieldInput with{
        AccessibilityName = ui.Strings.Get(label),
        Value = value,
        Controlled = true,
        Password = secret,
        RevealButton = secret,
        IssueText = issue.Length > 0 ? ui.Strings.Explain(issue): nil,
        Invalid = issue.Length > 0,
        Disabled = disabled,
        Width = Percent(100),
        FontFamily = AppTheme.Font,
        ContentDirection = Direction.LeftToRight,
        OnChange = changed
    }

    func Row(
        label string,
        value string,
        changed Action[string],
        secret bool = false,
        issue string = "",
        disabled bool = false,
        leading Blob? = nil,
        trailing Blob? = nil
    ) Blob -> FormField{
        Content: Grow(
            Container{
                MinWidth: 0,
                Entry(
                    FieldInput(label, value, changed, secret, issue, disabled) with{
                        Leading = leading,
                        Trailing = trailing
                    }
                )
            }
        ),
        CreateRoot: (_, root) -> {
            root.FlexDirection = FlexDirection.Row
            root.Gap = AppTheme.Space12
            root.FlexShrink = 0
            root.Children.Insert(
                0,
                Container{
                    Width: AppTheme.LabelColumn,
                    Height: AppTheme.ControlRegular,
                    FlexShrink: 0,
                    JustifyContent: JustifyContent.Center,
                    Label(ui, ui.Strings.Get(label), AppTheme.Type13, AppTheme.Body, "")
                }
            )
            return root
        }
    }.Build()

    func Amount(field TextField) Blob -> Entry(
        field with{
            Controlled = true,
            ContentDirection = Direction.LeftToRight,
            Trailing = Label(ui, "BNT", AppTheme.Type12, AppTheme.Dim, "")
        }
    )

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
        Gap: AppTheme.Space12,
        FlexShrink: 0,
        Container{
            Width: AppTheme.LabelColumn,
            FlexShrink: 0,
            Label(ui, label.Length > 0 ? ui.Strings.Get(label): "", AppTheme.Type13, AppTheme.Body, "")
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
        Label(ui, ui.Strings.Get(label), Theme.Read().LabelFontSize, AppTheme.Body, ""),
        Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            Gap: AppTheme.Space8,
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
