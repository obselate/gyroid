package Gyroid.Views

import Gyroid.Models
import System

partial class App {
    private func Phase() NodePhase {
        let status = wallet.Node.Status
        return if status.Phase == NodePhase.None && status.Running && (status.Peers == 0 || status.Height == 0) {
            NodePhase.Connecting
        } else {
            status.Phase
        }
    }

    private func Preparing() bool {
        let status = wallet.Node.Status
        return Phase() != NodePhase.None || status.Running && status.Syncing
    }

    private func PhaseName() string -> ui.Strings.Get(
        switch Phase() {
            case NodePhase.None: ""
            case NodePhase.Detecting: "Detecting"
            case NodePhase.Core: "Core download"
            case NodePhase.Checkpoints: "Checkpoints"
            case NodePhase.Starting: "Starting"
            case NodePhase.Connecting: "Connecting"
            case NodePhase.ChainSync: "Syncing"
        }
    )

    private func PhasePercent() int32? {
        let status = wallet.Node.Status
        if status.Phase != NodePhase.ChainSync {
            return status.DownloadPercent
        }
        if status.ChainHeight == 0 {
            return nil
        }
        return Math.Min(100, int32(100 * (status.SyncProgress ?? status.Height) / status.ChainHeight))
    }

    private func PhaseText() string -> if let value = PhasePercent() {
        PhaseName() + " " + value.ToString() + "%"
    } else {
        PhaseName()
    }
}
