package Gyroid.Views

import Goo
import Gyroid.Components
import Gyroid.Components.ControlParts
import Gyroid.Components.TextParts
import Gyroid.Models
import Gyroid.Services
import Gyroid.Views.SettingsParts

class SettingsMining : Cell[SettingsPageInput] {
    private var context SettingsPageInput
    private var mode string = "solo"
    private var pool string = ""
    private var savedMode string = ""
    private var savedPool string = ""
    private var issue string = ""
    private var savedGpu bool = true

    protected override func InputChanged(input SettingsPageInput) {
        let settings = input.Settings
        let changed = savedMode != settings.MiningMode || savedPool != settings.PoolUrl
        let refresh = changed ||
            savedGpu != settings.UseGpu ||
            context.Busy != input.Busy ||
            context.Language != input.Language
        context = input
        savedGpu = settings.UseGpu
        if changed {
            mode = settings.MiningMode
            pool = settings.PoolUrl
            savedMode = mode
            savedPool = pool
            issue = pool.Length == 0 ? "": SettingsValidation.PoolUrlError(pool)
        }
        if refresh {
            Rebuild()
        }
    }

    override func Build() Blob {
        let input = context
        let ui = input.Ui
        let selectedPool = mode == "pool" ? pool: savedPool
        let form = WalletForm(
            ui,
            !input.Busy &&
                (mode != "pool" || issue.Length == 0 && pool.Length > 0) &&
                (mode != savedMode || selectedPool != savedPool),
            () -> ui.Actions.Run(ct -> input.Session.SaveMiningAsync(mode, selectedPool, ct)),
            []string{}
        )
        let content = Container{
            Gap: AppTheme.Space16,
            MinHeight: 0,
            Segment(
                ui,
                "Mining mode",
                []string{"solo", "pool"},
                []string{"Solo (built-in)", "Pool (Seine)"},
                mode,
                input.Busy,
                value -> {
                    mode = value
                    Rebuild()
                }
            )
        }
        if mode == "pool" {
            content.Add(
                form.Field(
                    "Pool URL",
                    pool,
                    value -> {
                        pool = value
                        issue = SettingsValidation.PoolUrlError(value)
                        Rebuild()
                    },
                    issue: issue,
                    placeholder: "stratum+tcp://bntpool.com:3333"
                )
            )
            content.Add(
                WalletParts.Line(
                    ui,
                    RowHeight(input.Height),
                    "Use GPU",
                    []Blob{
                        Toggle(
                            input,
                            "Use GPU",
                            savedGpu,
                            () -> {
                                let value = !savedGpu
                                ui.Actions.Run(ct -> input.Session.SaveMiningGpuAsync(value, ct))
                            },
                            input.Busy
                        )
                    }
                )
            )
            content.Add(
                Label(
                    ui,
                    ui.Strings.Get("Seine takes 2% of mining time as a developer fee"),
                    AppTheme.Type12,
                    AppTheme.Dim,
                    ""
                )
            )
        }
        content.Add(Button(ui, "Save", form.Submit, !form.CanSubmit, true))
        return content
    }
}
