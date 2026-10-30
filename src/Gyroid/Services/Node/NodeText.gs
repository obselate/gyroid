package Gyroid.Services

import Gyroid.Models

class NodeText {
    shared {
        func Progress(status NodeStatus) string {
            let label = switch status.Phase {
                case NodePhase.None, NodePhase.ChainSync: ""
                case NodePhase.Detecting: "Detecting"
                case NodePhase.Core: "Core"
                case NodePhase.Checkpoints: "Checkpoints"
                case NodePhase.Starting: "Starting"
                case NodePhase.Connecting: "Connecting"
            }
            return if status.DownloadPercent != nil {
                label + " " + status.DownloadPercent.ToString() + "%"
            } else {
                label
            }
        }
    }
}
