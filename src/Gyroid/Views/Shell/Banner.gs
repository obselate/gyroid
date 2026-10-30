package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Models
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Linq
import System.Numerics
import System.Text
import System.Threading.Tasks

partial class App {
    private func Problem() Blob? {
        let snapshot = wallet.Snapshot
        let message = if error.Length > 0 {
            error
        } else if refreshError.Length > 0 {
            refreshError
        } else if wallet.BackgroundError.Length > 0 {
            wallet.BackgroundError
        } else if snapshot.State == WalletState.Unlocked && !snapshot.Connected {
            "Not connected"
        } else {
            ""
        }
        if message.Length == 0 {
            let problem = wallet.Settings.LoadError
            if problem.Length == 0 {
                return nil
            }
            return Banner{
                Tone: Tone.Warning,
                Content: ui.Strings.Get("Settings file not loaded") + ": " + ui.Strings.Explain(problem),
                FontFamily: ui.Font,
            }.Build()
        }
        return Banner{
            Tone: Tone.Danger,
            Content: ui.Strings.Explain(message),
            FontFamily: ui.Font,
            OnDismiss: () -> {
                error = ""
                refreshError = ""
                wallet.BackgroundError = ""
                Rebuild()
            }
        }.Build()
    }
}
