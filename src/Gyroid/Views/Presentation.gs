package Gyroid.Views

import Goo
import Goo.Widgets
import Gyroid.Components
import Gyroid.Services

class Presentation {
    let Actions UiService

    init(language string, privacy bool, actions UiService) {
        Strings = Gyroid.Views.Strings(language)
        Privacy = privacy
        Actions = actions
    }

    func Attach(owner Window) {
        Actions.window = owner
        FontSource(
            AppTheme.FontFace,
            AppTheme.WeightNormal,
            false,
            Resources.Resource("Gyroid.Font.Regular.ttf")
        ).Register()
        FontSource(AppTheme.FontFace, AppTheme.WeightBold, false, Resources.Resource("Gyroid.Font.Bold.ttf")).Register()
        let palette = (
            Theme.Ink with{
                Translate = key -> Strings.Get(key),
                FontFamily = AppTheme.Font,
                HeadingFontFamily = AppTheme.Font,
                MonoFontFamily = AppTheme.Font,
                FontSize = AppTheme.Type14,
                PanelRadius = AppTheme.Radius6,
                ControlRadius = AppTheme.Radius4,
                CanvasColor = AppTheme.Black,
                PanelColor = AppTheme.Surface,
                RaisedColor = AppTheme.Raised,
                OverlayColor = AppTheme.Raised,
                FieldColor = AppTheme.Field,
                SunkenColor = AppTheme.Black,
                HoverColor = AppTheme.Rule,
                PressedColor = AppTheme.Edge,
                ActiveColor = AppTheme.Edge,
                BorderColor = AppTheme.Edge,
                InputBorderColor = AppTheme.FieldEdge,
                StrongBorderColor = AppTheme.Dim,
                TextColor = AppTheme.Ink,
                MutedTextColor = AppTheme.Body,
                SubtleTextColor = AppTheme.Body,
                PlaceholderColor = AppTheme.Dim,
                FaintTextColor = AppTheme.Body,
                DisabledTextColor = AppTheme.Dim,
                AccentColor = AppTheme.Lime,
                OnAccentColor = AppTheme.Black,
                AccentHoverColor = AppTheme.LimeHover,
                AccentPressedColor = AppTheme.Lime,
                FocusColor = AppTheme.Lime,
                LinkColor = AppTheme.Blue,
                InfoColor = AppTheme.Blue,
                SuccessColor = AppTheme.Lime,
                WarningColor = AppTheme.Orange,
                DangerColor = AppTheme.Pink,
                DangerFillColor = AppTheme.Pink,
                DangerHoverColor = AppTheme.Pink,
                InfoFillColor = AppTheme.InfoFill,
                SuccessFillColor = AppTheme.SuccessFill,
                WarningFillColor = AppTheme.WarningFill,
                DangerQuietColor = AppTheme.DangerQuiet
            }
        ).WithGlass() with{
            GlassColor = AppTheme.Black.WithAlpha(AppTheme.Pane),
            HairlineColor = AppTheme.Edge,
            HighlightColor = AppTheme.Surface.WithAlpha(AppTheme.Space0)
        }
        Theme.Attach(owner, palette)
    }

    let Strings Strings
    var Operations int32
    var Privacy bool

    func Working() bool -> Operations > 0
}
