package Gyroid.Views

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.LayoutParts
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
    private let retryConnection Action
    private let dismissProblem Action

    private func Problem() Blob? {
        let snapshot = wallet.Snapshot
        let message = if error.Length > 0 {
            error
        } else if wallet.NodeError.Length > 0 {
            wallet.NodeError
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
            return Cell.Mount[ShellBannerInput, ShellBannerRegion](
                "problem-banner",
                ShellBannerInput{
                    Ui: ui,
                    Message: ui.Strings.Get("Settings file not loaded") + ": " + ui.Strings.Explain(problem),
                    Warning: true,
                    Language: ui.Strings.Language
                }
            )
        }
        return Cell.Mount[ShellBannerInput, ShellBannerRegion](
            "problem-banner",
            ShellBannerInput{
                Ui: ui,
                Revision: problemRevision,
                Message: ui.Strings.Explain(message),
                NodeError: wallet.NodeError.Length > 0,
                RestartStopped: wallet.NodeRestartStopped,
                Busy: ui.Working() || wallet.Busy || Preparing(),
                Language: ui.Strings.Language,
                Retry: retryConnection,
                Dismiss: dismissProblem
            }
        )
    }
}

data struct ShellBannerInput {
    var Ui Presentation
    var Revision int32
    var Message string
    var Warning bool
    var NodeError bool
    var RestartStopped bool
    var Busy bool
    var Language string
    var Retry Action?
    var Dismiss Action?
}

class ShellBannerRegion : Cell[ShellBannerInput] {
    private var message string = ""
    private var dismissed bool
    private var revision int32

    protected override func Build(input ShellBannerInput) Blob {
        if message != input.Message || revision != input.Revision {
            message = input.Message
            revision = input.Revision
            dismissed = false
        }
        if dismissed {
            return Container{Display: Display.None}
        }
        return Banner{
            Tone: input.Warning ? Tone.Warning: Tone.Danger,
            Content: input.Message,
            FontFamily: AppTheme.Font,
            Title: input.RestartStopped ? input.Ui.Strings.Get("Automatic node restart stopped"): nil,
            Actions: input.NodeError ? ActionRow(
                []Blob{Button(input.Ui, "Retry", () -> input.Retry?.Invoke(), input.Busy)}
            ): nil,
            OnDismiss: input.Warning || input.NodeError ? nil: () -> {
                dismissed = true
                input.Dismiss?.Invoke()
            }
        }.Build()
    }
}
