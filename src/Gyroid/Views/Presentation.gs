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
                SuccessFillColor = SuccessFill,
                WarningFillColor = WarningFill,
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
    let Field Color = Color.Parse("#080808")
    let FieldEdge Color = Color.Parse("#2a2a2a")
    let Control Color = Color.Parse("#0b0b0b")
    let Selected Color = Color.Parse("#1a1a1a")
    let Active Color = Color.Parse("#121906")
    let FaintRule Color = Color.Parse("#141414")
    let StrongRule Color = Color.Parse("#3a3a3a")
    let PopoverEdge Color = Color.Parse("#333333")
    let SuccessFill Color = Color.Parse("#111a00")
    let WarningFill Color = Color.Parse("#1a1100")
    let Expanded Color = Color.Parse("#0f0f0f")
    let ExportEdge Color = Color.Parse("#4a4a4a")
    let Unallocated Color = Color.Parse("#262626")
    let ActionFill Color = Color.Parse("#0b1203")
    let PendingStroke Color = Color.Parse("#b37700")
    let SyncFill Color = Color.Parse("#1b2609")
    let SuccessStroke Color = Color.Parse("#4d7300")

    func Working() bool -> Operations > 0
}
