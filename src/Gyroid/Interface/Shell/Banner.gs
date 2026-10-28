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

partial class WalletView {
    private func Problem() Blob? {
        let snapshot = wallet.Snapshot
        let message = if error.Length > 0 {
            error
        } else if refreshError.Length > 0 {
            refreshError
        } else if snapshot.Page == "Wallet" && !snapshot.Connected {
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
                Content: strings.Get("Settings file not loaded") + ": " + Explain(problem),
                FontFamily: font,
            }.Build()
        }
        return Banner{
            Tone: Tone.Danger,
            Content: Explain(message),
            FontFamily: font,
            OnDismiss: () -> {
                error = ""
                refreshError = ""
                Rebuild()
            }
        }.Build()
    }
}
