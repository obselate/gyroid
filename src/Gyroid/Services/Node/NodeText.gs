package Gyroid.Services

import System
import System.Globalization

class NodeText {
    shared {
        func FixedPoint(value float64, places int32) string -> value.ToString(
            "F" + (value > 0 ? Math.Max(places, 1 - int32(Math.Floor(Math.Log10(value)))): places).ToString(),
            CultureInfo.InvariantCulture
        )

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
