package Gyroid.Views

import Goo
import Goo.Widgets
import Gyroid.Services

class Presentation {
    let Pane float64 = 0.8
    let Actions UiService

    init(language string, privacy bool, actions UiService) {
        Strings = Gyroid.Views.Strings(language)
        Privacy = privacy
        Actions = actions
    }

    func Attach(owner Window) {
        Actions.window = owner
        FontSource("JetBrains Mono", 400, false, Resources.Resource("Gyroid.Font.Regular.ttf")).Register()
        FontSource("JetBrains Mono", 700, false, Resources.Resource("Gyroid.Font.Bold.ttf")).Register()
        let palette = (
            Theme.Ink with{
                Translate = key -> Strings.Get(key),
                FontFamily = Font,
                HeadingFontFamily = Font,
                MonoFontFamily = Font,
                FontSize = 14,
                PanelRadius = 6,
                ControlRadius = 4,
                CanvasColor = Black,
                PanelColor = Surface,
                RaisedColor = Raised,
                OverlayColor = Raised,
                FieldColor = Surface,
                SunkenColor = Black,
                HoverColor = Rule,
                PressedColor = Edge,
                ActiveColor = Edge,
                BorderColor = Edge,
                InputBorderColor = Edge,
                StrongBorderColor = Dim,
                TextColor = Ink,
                MutedTextColor = Body,
                SubtleTextColor = Body,
                PlaceholderColor = Dim,
                FaintTextColor = Body,
                DisabledTextColor = Dim,
                AccentColor = Lime,
                OnAccentColor = Black,
                AccentHoverColor = LimeHover,
                AccentPressedColor = Lime,
                FocusColor = Lime,
                LinkColor = Blue,
                InfoColor = Blue,
                SuccessColor = Lime,
                WarningColor = Orange,
                DangerColor = Pink,
                DangerFillColor = Pink,
                DangerHoverColor = Pink,
                InfoFillColor = Color.Parse("#00111a"),
                SuccessFillColor = Color.Parse("#111a00"),
                WarningFillColor = Color.Parse("#1a1100"),
                DangerQuietColor = Color.Parse("#1a0011")
            }
        ).WithGlass() with{
            GlassColor = Black.WithAlpha(Pane),
            HairlineColor = Edge,
            HighlightColor = Surface.WithAlpha(0)
        }
        Theme.Attach(owner, palette)
    }

    let Strings Strings
    var Operations int32
    var Privacy bool
    let Font string = "JetBrains Mono, Noto Sans CJK, msyh, PingFang"
    let Black Color = Color.Parse("#000000")
    let Surface Color = Color.Parse("#050505")
    let Raised Color = Color.Parse("#0a0a0a")
    let Rule Color = Color.Parse("#1d1d1d")
    let Edge Color = Color.Parse("#2e2e2e")
    let Ink Color = Color.Parse("#f2f2f2")
    let Body Color = Color.Parse("#c8c8c8")
    let Dim Color = Color.Parse("#7a7a7a")
    let Lime Color = Color.Parse("#aaff00")
    let LimeHover Color = Color.Parse("#ccff33")
    let Orange Color = Color.Parse("#ffaa00")
    let Pink Color = Color.Parse("#ff00aa")
    let Blue Color = Color.Parse("#00aaff")
    let Mint Color = Color.Parse("#00ffaa")
    let Violet Color = Color.Parse("#aa00ff")

    func Working() bool -> Operations > 0
}
