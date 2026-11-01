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
        const Border1_2 float64 = 1.2
        const Border1_4 float64 = 1.4
        const Border1_5 float64 = 1.5
        const Border1_6 float64 = 1.6
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
        const Icon56 float64 = 56
        const LabelColumn float64 = 130
        const MarkerSize float64 = 8
        const Radius0 float64 = 0
        const Radius1 float64 = 1
        const Radius10 float64 = 10
        const Radius11 float64 = 11
        const Radius12 float64 = 12
        const Radius14 float64 = 14
        const Radius18 float64 = 18
        const Radius2 float64 = 2
        const Radius3 float64 = 3
        const Radius3_2 float64 = 3.2
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
        const Space44 float64 = 44
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
        let InfoFill Color = Color.Parse("#00111a")
        let DangerQuiet Color = Color.Parse("#1a0011")
        let RingTrack Color = Color.Parse("#1f1f1f")
        let UpgradeDangerFill Color = Color.Parse("#3a0026")
        let TransportBlueMuted Color = Color.Parse("#007caf")
        let WarningMuted Color = Color.Parse("#9e6900")
        let InfoMuted Color = Color.Parse("#00699e")
        let PrivateValue Color = Color.Parse("#1fae84")
        let RealMember Color = Color.Parse("#00bf80")
        let ChartMarkerMuted Color = Color.Parse("#858585")
        let MatureSlot Color = Color.Parse("#558000")
        let RowHover Color = Color.Parse("#0c0c0c")
        let ChartAccentGradientStart Color = Color.Parse("#202e07")
        let ChartAccentGradientEnd Color = Color.Parse("#060707")
        let PendingEdge Color = Color.Parse("#734d00")
        let SuccessHighlight Color = Color.Parse("#77b300")
        let PeerBlockedFill Color = Color.Parse("#40002b")
        let PeerRing Color = Color.Parse("#171717")
        let TransportBlueLine Color = Color.Parse("#003047")
        let TransportMintLine Color = Color.Parse("#004730")
        let BalanceFraction Color = Color.Parse("#588203")
        let MutedFraction Color = Color.Parse("#3f3f3f")
        let CopiedFill Color = Color.Parse("#00140d")
        let VerifiedSlot Color = Color.Parse("#048f5f")
        let VerifiedIndex Color = Color.Parse("#598304")
        let SwitchThumbColor Color = Color.Parse("#8c8c8c")
        let StalledFill Color = Color.Parse("#261c09")
        let CheckpointFill Color = Color.Parse("#253807")
        let ErrorStrong Color = Color.Parse("#ff3d6e")
        let ActiveOutline Color = Color.Parse("#141f00")
        let TileHover Color = Color.Parse("#121212")
        let CorrectAnswerFill Color = Color.Parse("#182400")
        let ErrorOutline Color = Color.Parse("#24090f")
        let MaskedText Color = Color.Parse("#6a6a6a")

        let Button ActionButton = ActionButton{
            Height: ControlRegular,
            BorderRadius: Radius8,
            BorderWidth: Border1,
            BorderColor: Edge,
            BackgroundColor: Control,
            TextColor: Ink,
            FontFamily: Font,
            FontSize: Type14,
            MinWidth: 64,
            PaddingHorizontal: Space14,
            ActiveTransform: PanelTransform{},
            HoverBackgroundColor: Rule,
            ActiveBackgroundColor: Selected,
            DisabledBackgroundColor: Control,
            DisabledTextColor: Dim
        }
        let PrimaryButton ActionButton = Button with{
            BackgroundColor = Lime,
            TextColor = Black,
            HoverBackgroundColor = LimeHover
        }
        let ButtonStyle Style = Style{
            Height: Button.Height!!,
            MinWidth: Button.MinWidth!!,
            Padding: Edges{Left: Button.PaddingHorizontal!!, Right: Button.PaddingHorizontal!!},
            BorderRadius: Button.BorderRadius!!,
            BorderWidth: Button.BorderWidth!!,
            BorderColor: Button.BorderColor!!,
            BackgroundColor: Button.BackgroundColor!!,
            Color: Button.TextColor!!,
            FontFamily: Button.FontFamily!!,
            FontSize: Button.FontSize,
            Gap: Space8,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center
        }
        let IconButtonStyle Style = Style{
            Width: ControlRegular,
            Height: ControlRegular,
            BorderRadius: Radius8,
            BorderWidth: Border1,
            BorderColor: Edge,
            BackgroundColor: Control,
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
        let SelectedTabStyle Style = Style{BasedOn: TabStyle, BackgroundColor: Selected, Color: Ink}
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
            ThumbColor: SwitchThumbColor,
            OnThumbColor: Surface
        }
        let FieldInput TextField = TextField{
            EntryHeight: ControlRegular,
            BorderRadius: Radius8,
            BorderWidth: Border1,
            BackgroundColor: Field,
            BorderColor: FieldEdge,
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
            BorderRadius: FieldInput.BorderRadius!!,
            BorderWidth: FieldInput.BorderWidth!!,
            BackgroundColor: FieldInput.BackgroundColor!!,
            BorderColor: FieldInput.BorderColor!!,
            FontFamily: FieldInput.FontFamily!!,
            FontSize: FieldInput.FontSize
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
