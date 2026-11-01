package Gyroid.Views

import Goo
import Gyroid.Components
import System
import System.Diagnostics
import System.Linq
import System.Numerics

partial class App {
    private var frameTimer WindowTimer?

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
        UpdateScale()
    }

    private func PlaybackActive() bool ->
    !reduceMotion && !hidden && window?.IsFocused == true && window?.IsVisible == true
    && window?.State != WindowState.Minimized && window?.Occlusion != WindowOcclusion.Occluded

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
            ui.Actions.Decoding.Clear()
        } else {
            if backgroundMode != "off" {
                clock.Start()
                frameTimer ??= window?.SetInterval(() -> Tick(), 50)
            } else {
                clock.Stop()
                frameTimer?.Dispose()
                frameTimer = nil
            }
        }
    }

    private func Tick() {
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
            Vector4(float32(sceneShift), float32(3 * (window?.UiScale ?? 1)), float32(AppTheme.Pane), 0F)
        )
    }
}
