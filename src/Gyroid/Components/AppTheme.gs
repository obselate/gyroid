package Gyroid.Components

import Goo
import Goo.Widgets.Actions
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import System

class AppTheme {
    shared {
        const Font string = "JetBrains Mono, Noto Sans CJK, msyh, PingFang"
        const FontFace string = "JetBrains Mono"
        const WeightNormal int32 = 400
        const Pane float64 = 0.8
        const BadgeHeight float64 = 20
        const Border0 float64 = 0
        const Border1 float64 = 1
        const Border2 float64 = 2
        const Border3 float64 = 3
        const CheckboxSize float64 = 14
        const ControlCompact float64 = 28
        const ControlRegular float64 = 38
        const Icon12 float64 = 12
        const Icon14 float64 = 14
        const Icon16 float64 = 16
        const Icon18 float64 = 18
        const Icon20 float64 = 20
        const Icon22 float64 = 22
        const Icon32 float64 = 32
        const LabelColumn float64 = 130
        const MarkerSize float64 = 8
        const Radius0 float64 = 0
        const Radius1 float64 = 1
        const Radius10 float64 = 10
        const Radius12 float64 = 12
        const Radius14 float64 = 14
        const Radius18 float64 = 18
        const Radius2 float64 = 2
        const Radius3 float64 = 3
        const Radius4 float64 = 4
        const Radius6 float64 = 6
        const Radius8 float64 = 8
        const Space0 float64 = 0
        const Space10 float64 = 10
        const Space12 float64 = 12
        const Space14 float64 = 14
        const Space16 float64 = 16
        const Space2 float64 = 2
        const Space20 float64 = 20
        const Space22 float64 = 22
        const Space24 float64 = 24
        const Space28 float64 = 28
        const Space4 float64 = 4
        const Space6 float64 = 6
        const Space8 float64 = 8
        const Stroke2 float64 = 2
        const Stroke3 float64 = 3
        const SwitchHeight float64 = 20
        const SwitchThumb float64 = 14
        const SwitchWidth float64 = 36
        const TileHeight float64 = 84
        const Track10 float64 = 10
        const Track8 float64 = 8
        const Type10 float64 = 10
        const Type11 float64 = 11
        const Type12 float64 = 12
        const Type13 float64 = 13
        const Type14 float64 = 14
        const Type16 float64 = 16
        const Type17 float64 = 17
        const Type18 float64 = 18
        const Type20 float64 = 20
        const Type24 float64 = 24
        const WeightBold int32 = 700

        let Black Color = Color.Parse("#000000")
        let Surface Color = Color.Parse("#050505")
        let Raised Color = Color.Parse("#0a0a0a")
        let FaintRule Color = Color.Parse("#141414")
        let Rule Color = Color.Parse("#1d1d1d")
        let Edge Color = Color.Parse("#2e2e2e")
        let StrongRule Color = Color.Parse("#3a3a3a")
        let StrongEdge Color = Color.Parse("#4a4a4a")
        let Thumb Color = Color.Parse("#8c8c8c")
        let Ink Color = Color.Parse("#f2f2f2")
        let Body Color = Color.Parse("#c8c8c8")
        let Dim Color = Color.Parse("#7a7a7a")
        let Lime Color = Color.Parse("#aaff00")
        let Orange Color = Color.Parse("#ffaa00")
        let Pink Color = Color.Parse("#ff00aa")
        let Blue Color = Color.Parse("#00aaff")
        let Mint Color = Color.Parse("#00ffaa")
        let Violet Color = Color.Parse("#aa00ff")
        let LimeQuiet Color = Shade(Lime, 0.1)
        let OrangeQuiet Color = Shade(Orange, 0.1)
        let OrangeStrong Color = Shade(Orange, 0.7)
        let LimeMuted Color = Shade(Lime, 0.45)
        let BlueQuiet Color = Shade(Blue, 0.1)
        let PinkQuiet Color = Shade(Pink, 0.1)
        let PinkSoft Color = Shade(Pink, 0.25)
        let BlueStrong Color = Shade(Blue, 0.7)
        let MintStrong Color = Shade(Mint, 0.7)
        let LimeSoft Color = Shade(Lime, 0.25)
        let OrangeMuted Color = Shade(Orange, 0.45)
        let LimeStrong Color = Shade(Lime, 0.7)
        let BlueSoft Color = Shade(Blue, 0.25)
        let MintSoft Color = Shade(Mint, 0.25)
        let MintQuiet Color = Shade(Mint, 0.1)
        let MintMuted Color = Shade(Mint, 0.45)

        func Shade(color Color, strength float64) Color ->
        Color.FromNormalized(color.R * float32(strength), color.G * float32(strength), color.B * float32(strength), 1)

        let Button ActionButton = ActionButton{
            Height: ControlRegular,
            BorderRadius: Radius8,
            BorderWidth: Border1,
            BorderColor: Edge,
            BackgroundColor: Raised,
            TextColor: Ink,
            FontFamily: Font,
            FontSize: Type14,
            MinWidth: 64,
            PaddingHorizontal: Space14,
            ActiveTransform: PanelTransform{},
            HoverBackgroundColor: Rule,
            ActiveBackgroundColor: Rule,
            DisabledBackgroundColor: Raised,
            DisabledTextColor: Dim
        }
        let PrimaryButton ActionButton = Button with{
            BackgroundColor = Lime,
            TextColor = Black,
            HoverBackgroundColor = LimeStrong
        }
        let DangerButton ActionButton = Button with{BackgroundColor = PinkQuiet, BorderColor = Pink, TextColor = Pink}
        let ButtonStyle Style = Style{
            Height: ControlRegular,
            MinWidth: 64,
            Padding: Edges{Left: Space14, Right: Space14},
            BorderRadius: Radius8,
            BorderWidth: Border1,
            BorderColor: Edge,
            BackgroundColor: Raised,
            Color: Ink,
            FontFamily: Font,
            FontSize: Type14,
            FlexDirection: FlexDirection.Row,
            Gap: Space8,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center
        }
        let CompactButton ActionButton = Button with{
            Height = ControlCompact,
            FontSize = Type12,
            PaddingHorizontal = Space10
        }
        let IconButtonStyle Style = Style{
            Width: ControlRegular,
            Height: ControlRegular,
            BorderRadius: Radius8,
            BorderWidth: Border1,
            BorderColor: Edge,
            BackgroundColor: Raised,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center
        }
        let DisclosureStyle Style = Style{
            BasedOn: IconButtonStyle,
            Width: ControlCompact,
            Height: ControlCompact,
            BackgroundColor: Color.Transparent,
            BorderWidth: Border0
        }
        let IconButton IconButton = IconButton{RootStyle: IconButtonStyle, HoverBackgroundColor: Rule}
        let TabStyle Style = Style{
            Height: ControlCompact,
            BorderRadius: Radius4,
            BackgroundColor: Color.Transparent,
            Color: Body,
            FontFamily: Font,
            FontSize: Type13,
            Padding: Edges{Left: Space12, Right: Space12}
        }
        let SelectedTabStyle Style = Style{BasedOn: TabStyle, BackgroundColor: Rule, Color: Ink}
        let SegmentStyle Style = Style{BasedOn: TabStyle, FontSize: Type12}
        let SegmentGroupStyle Style = Style{
            FlexDirection: FlexDirection.Row,
            BackgroundColor: Black,
            BorderColor: Rule,
            BorderWidth: Border1,
            BorderRadius: Radius10,
            Padding: Space4
        }
        let Switch ToggleSwitch = ToggleSwitch{
            Width: SwitchWidth,
            Height: SwitchHeight,
            ThumbSize: SwitchThumb,
            OffTrackColor: Edge,
            OnTrackColor: Lime,
            ThumbColor: Thumb,
            OnThumbColor: Surface
        }
        let FlushSegmentGroupStyle Style = Style{BasedOn: SegmentGroupStyle, Padding: Space0, BorderWidth: Border0}
        let Checkbox Checkbox = Checkbox{
            Size: CheckboxSize,
            BorderRadius: Radius2,
            BorderWidth: Border1,
            BackgroundColor: Raised,
            BorderColor: Edge,
            CheckedBackgroundColor: Lime,
            CheckedBorderColor: Lime,
            MarkColor: Black,
            HitSize: ControlRegular,
            LabelFontSize: Type14
        }
        let FieldInput TextField = TextField{
            EntryHeight: ControlRegular,
            BorderRadius: Radius8,
            BorderWidth: Border1,
            BackgroundColor: Raised,
            BorderColor: Edge,
            TextColor: Ink,
            MutedTextColor: Body,
            InvalidColor: Pink,
            DisabledTextColor: Dim,
            FontFamily: Font,
            FontSize: Type14,
            LabelFontSize: Type13,
            LabelFontWeight: WeightNormal,
            LabelTextTransform: TextTransform.None,
            Gap: Space6,
            PaddingHorizontal: Space12
        }
        let FieldStyle Style = Style{
            BorderRadius: Radius8,
            BorderWidth: Border1,
            BackgroundColor: Raised,
            BorderColor: Edge,
            FontFamily: Font,
            FontSize: Type14
        }
        let Dialog ModalDialog = ModalDialog{
            BackgroundColor: Raised,
            BorderColor: Edge,
            BorderWidth: Border1,
            BorderRadius: Radius14,
            Padding: Space22,
            Gap: Space14
        }
        let CardStyle Style = Style{
            BackgroundColor: Surface.WithAlpha(Pane),
            BackdropBlur: Space16,
            BorderWidth: Border1,
            BorderColor: Edge,
            BorderRadius: Radius6,
            Padding: Space20,
            Gap: Space16,
            MinWidth: 0,
            MinHeight: 0
        }
        let TileStyle Style = Style{BasedOn: CardStyle, BorderRadius: Radius10, Gap: Space8}
        let TooltipStyle Style = Style{
            BackgroundColor: Raised,
            BorderColor: Edge,
            BorderWidth: Border1,
            BorderRadius: Radius8,
            FontFamily: Font,
            FontSize: Type12
        }
        let InformationCardStyle Style = Style{BasedOn: TooltipStyle, Padding: Space14, Gap: Space8}
        let PassiveTooltipStyle Style = Style{
            BasedOn: TooltipStyle,
            Padding: Edges{Top: Space10, Bottom: Space10, Left: Space12, Right: Space12},
            Gap: Space4
        }
        let MarkerStyle Style = Style{Width: MarkerSize, Height: MarkerSize, BorderRadius: Radius2, Gap: Space8}
        let PresenceStyle Style = Style{BasedOn: MarkerStyle, Width: Space6, Height: Space6, BorderRadius: Radius3}
        let TrackStyle Style = Style{Height: Track8, BorderRadius: Radius2, BackgroundColor: FaintRule}
        let BadgeStyle Style = Style{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Height: BadgeHeight,
            BorderRadius: Radius3,
            BorderWidth: Border1,
            Padding: Edges{Left: Space6, Right: Space6},
            Gap: Space6,
            FontFamily: Font,
            FontSize: Type12
        }
        let ListRowStyle Style = Style{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: Space10,
            BorderWidth: Edges{Bottom: Border1},
            BorderColor: Rule
        }
        let BubbleStyle Style = Style{
            FlexDirection: FlexDirection.Column,
            AlignItems: AlignItems.Stretch,
            Padding: Edges{Left: Space14, Right: Space14, Top: Space10, Bottom: Space10},
            BorderRadius: Radius18,
            Gap: Space4
        }
        let ComposerStyle Style = Style{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexEnd,
            Padding: Space6,
            Gap: Space6,
            BorderWidth: Border1,
            BorderRadius: Radius12,
            BackgroundColor: Black
        }

        func GetPagePadding(width float64, height float64) float64 ->
        width < 1100 ? 16.0: Math.Clamp(height * 0.025, 20.0, 32.0)

        func GetPageGap(height float64) float64 -> Math.Clamp(14 + Math.Max(0, height - 640) * 0.025, 14.0, 24.0)

        func GetColumnPadding(width float64) float64 -> width < 1100 ? 10.0: 14.0

        func GetMajorFigureSize(height float64) float64 -> Math.Clamp(height * 0.08, 40.0, 72.0)

        func GetFigureSize(height float64) float64 -> Math.Clamp(height * 0.027, 20, 24)

        func GetSecondaryFigureSize(height float64) float64 -> Math.Clamp(height * 0.032, 20, 30)

        func GetBalanceSize(masked bool, height float64, inner float64, length int32) float64 -> if masked {
            34.0
        } else {
            Math.Clamp(Math.Min(height * 0.12, inner * 1.53 / length), 34, 150)
        }

        func GetLegendFigureSize(wide bool, height float64) float64 -> wide ? Math.Clamp(height * 0.024, 16, 26): 16

        func GetTotalSize(height float64) float64 -> Math.Clamp(height * 0.05, 28.0, 64.0)

        func GetAmountSize(height float64) float64 -> Math.Clamp(height * 0.07, 36.0, 100.0)

        func GetReviewAmountSize(height float64) float64 -> Math.Clamp(height * 0.05, 28.0, 40.0)

        func GetHeroPadding(height float64) float64 -> Math.Clamp(height * 0.032, 4.0, 60.0)

        func GetAmountPadding(height float64) float64 -> Math.Clamp(height * 0.01, 0.0, 10.0)

        func GetInstrumentSize(height float64) float64 -> Math.Clamp(height * 0.065, 26.0, 64.0)

        func GetVerdictSize(height float64) float64 -> Math.Clamp(height * 0.05, 22.0, 48.0)

        func GetDetailGap(height float64) float64 -> Math.Clamp(height * 0.01, 4.0, 8.0)

        func GetPanelPadding(width float64) float64 -> Math.Clamp(width * 0.03, 20, 32)

        func GetPanelBlockPadding(height float64) float64 -> Math.Clamp(height * 0.034, 18, 30)

        func GetPanelGap(height float64) float64 -> Math.Clamp(height * 0.032, 16, 28)

        func GetStatusFigureSize(height float64, fill bool) float64 -> Math.Clamp(
            height * (fill ? 0.18: 0.11),
            48,
            fill ? 240: 92
        )

        func GetFigureGap(width float64) float64 -> Math.Clamp(width * 0.04, 20, 52)

        func GetInsetTextSize(size float64) float64 -> Math.Round(size * 0.36)
    }
}
