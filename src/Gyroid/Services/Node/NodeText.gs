package Gyroid.Services

import Gyroid.Models
import System
import System.Collections.Generic
import System.Globalization
import System.Threading

class NodeText {
    shared {
        func Rows(
            peers[]NetworkPeer,
            bans[]BannedPeer,
            language string,
            width float64,
            hovered string,
            banned bool,
            token CancellationToken
        )[]NetworkRow {
            let rows = [banned ? bans.Length: peers.Length]NetworkRow
            for index in 0 ... rows.Length {
                token.ThrowIfCancellationRequested()
                rows[index] = if banned {
                    NetworkRow{Key: "ban:" + bans[index].Id, Ban: bans[index], Language: language}
                } else {
                    NetworkRow{
                        Key: "peer:" + peers[index].Id,
                        Peer: peers[index],
                        Language: language,
                        Width: width,
                        Hovered: peers[index].Id == hovered
                    }
                }
            }
            return rows
        }

        func Positive(value float64) string -> value > 0 && value < 0.01 ?
        value.ToString("0.##E+0", CultureInfo.InvariantCulture): value.ToString("0.00", CultureInfo.InvariantCulture)

        func Prepare(report NetworkReport, history[]WalletOutput, sends[]WalletSend, age string) NetworkReport {
            let own = Dictionary[uint64, int32]()
            let blocks = report.Blocks
            let tip = blocks.Length > 0 ? blocks[blocks.Length - 1].Height: 0
            for send in sends {
                if send.Confirmations > 0 && send.Confirmations <= tip + 1 {
                    own[tip + 1 - send.Confirmations] = 2
                }
            }
            for output in history {
                own[output.BlockHeight] = 1
            }
            let prepared = [blocks.Length]NetworkBlock
            var maximum = 6.0
            for index in 0 ... blocks.Length {
                let block = blocks[index]
                let elapsed = blocks[blocks.Length - 1].Timestamp - block.Timestamp
                prepared[index] = NetworkBlock{
                    ... block,
                    Seconds: index > 0 ? Math.Max(0L, block.Timestamp - blocks[index - 1].Timestamp): 0,
                    Age: elapsed,
                    Own: own.TryGetValue(block.Height, out let kind) ? kind: 0
                }
                if elapsed < 7200 {
                    maximum = Math.Max(maximum, float64(block.Transactions))
                }
            }
            var hours = 0
            let separator = age.IndexOf('h')
            if separator > 0 {
                int32.TryParse(
                    age.Substring(0, separator),
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out hours
                )
            }
            return NetworkReport{
                ... report,
                Blocks: prepared,
                Average: blocks.Length > 1 ? float64(blocks[blocks.Length - 1].Timestamp - blocks[0].Timestamp) / (
                    blocks.Length - 1
                ): 0,
                MaximumTransactions: maximum,
                IdentityHours: hours
            }
        }

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
