package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Linq
import System.Numerics
import System.Text
import System.Threading.Tasks

partial class App {
    private var frameTimer WindowTimer?

    private var lastActivity int64 = Stopwatch.GetTimestamp()

    private let clock Stopwatch = Stopwatch.StartNew()

    private let background ShaderEffect

    private var sceneShift float64

    private var sceneCenter float32 = 0.62F

    private var reduceMotion bool

    private var backgroundMode string = "glyphs"

    private func ApplyPreferences() {
        let settings = wallet.Settings
        reduceMotion = settings.ReduceMotion
        backgroundMode = settings.Background
    }

    private func PlaybackActive() bool ->
    !reduceMotion && !hidden && window?.IsFocused == true && window?.IsVisible == true
    &&
        window?.State != WindowState.Minimized &&
        (ui.Operations > 0 || Stopwatch.GetElapsedTime(lastActivity).TotalSeconds < 10)

    private func UpdatePlayback() {
        let active = PlaybackActive()
        Motion.TimeScale = if active {
            1.0
        } else {
            0.0
        }
        if !active {
            clock.Stop()
            frameTimer?.Dispose()
            frameTimer = nil
            ui.DecodeTimer?.Dispose()
            ui.DecodeTimer = nil
            ui.Decoding.Clear()
        } else {
            clock.Start()
            frameTimer ??= window?.SetInterval(() -> Tick(), 50)
        }
    }

    private func ResumePlayback() {
        lastActivity = Stopwatch.GetTimestamp()
        if frameTimer == nil {
            UpdatePlayback()
            Rebuild()
        }
    }

    private func Tick() {
        if ui.Operations == 0 && Stopwatch.GetElapsedTime(lastActivity).TotalSeconds >= 10 {
            UpdatePlayback()
            Rebuild()
            return
        }
        let now = clock.Elapsed.TotalSeconds
        Scene((now - background.ElapsedSeconds) / 1.2)
        background.ElapsedSeconds = now
    }

    private func Scene(step float64) {
        sceneShift = if WalletAvailable() && backgroundMode == "glyphs" {
            Math.Min(1, sceneShift + step)
        } else {
            Math.Max(0, sceneShift - step)
        }
        background.SetParameter(
            3,
            Vector4(float32(sceneShift), float32(3 * (window?.UiScale ?? 1)), float32(ui.Pane), 0F)
        )
    }
}
