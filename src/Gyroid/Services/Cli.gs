package Gyroid.Services

import Gyroid.Model
import System
import System.Globalization
import System.IO
import System.Threading

class Cli {
    shared {
        func Run(arguments[]string) int32 {
            let command = arguments[1]
            var limit int32 = 20
            var memo = ""
            var dryRun = false
            if command == "node" {
                if arguments.Length != 3 ||
                    (arguments[2] != "status" && arguments[2] != "start" && arguments[2] != "stop") {
                    return Usage(Console.Error)
                }
            } else if command == "history" {
                if arguments.Length != 2 &&
                    (
                    arguments.Length != 4 || arguments[2] != "--limit" || !Int32.TryParse(
                        arguments[3],
                        NumberStyles.None,
                        CultureInfo.InvariantCulture,
                        out limit
                    ) ||
                        limit <= 0
                ) {
                    return Usage(Console.Error)
                }
            } else if command == "send" {
                if arguments.Length < 4 {
                    return Usage(Console.Error)
                }
                var hasMemo = false
                var index = 4
                while index < arguments.Length {
                    if arguments[index] == "--dry-run" && !dryRun {
                        dryRun = true
                    } else if arguments[index] == "--memo" && !hasMemo && index + 1 < arguments.Length {
                        index = index + 1
                        memo = arguments[index]
                        hasMemo = true
                    } else {
                        return Usage(Console.Error)
                    }
                    index = index + 1
                }
            } else if arguments.Length != 2 ||
                (
                command != "--help" &&
                    command != "--version" &&
                    command != "status" &&
                    command != "balance" &&
                    command != "address" &&
                    command != "unlock" &&
                    command != "lock"
            ) {
                return Usage(Console.Error)
            }
            if command == "--help" {
                Usage(Console.Out)
                return 0
            }
            if command == "--version" {
                Console.WriteLine("Gyroid 0.1.0")
                return 0
            }
            try {
                if command == "send" {
                    WalletController.ValidateSend(arguments[2], arguments[3], memo)
                }
                using let wallet = WalletController()
                let problem = wallet.Settings.LoadError
                if problem.Length > 0 {
                    Console.Error.WriteLine("Settings file not loaded: " + problem)
                    return 1
                }
                if command == "node" {
                    return RunNode(wallet, arguments[2])
                }
                using let status = wallet.OpenCliAsync().GetAwaiter().GetResult()
                if command == "status" {
                    let root = status.RootElement
                    Console.WriteLine("Node: reachable")
                    Console.WriteLine(
                        "Chain height: " + WalletJson.Number(root, "chain_height").ToString(
                            CultureInfo.InvariantCulture
                        )
                    )
                    Console.WriteLine("Syncing: " + WalletJson.Flag(root, "syncing").ToString())
                    if let height = WalletJson.OptionalNumber(root, "sync_progress") {
                        Console.WriteLine("Sync height: " + height.ToString(CultureInfo.InvariantCulture))
                    }
                    Console.WriteLine("Wallet: " + wallet.Snapshot.State)
                } else if command == "unlock" {
                    let password = ReadPassword()
                    try {
                        wallet.UnlockAsync(password).GetAwaiter().GetResult()
                    } finally {
                        Array.Clear(password)
                    }
                    Console.WriteLine("Wallet unlocked")
                } else if command == "lock" {
                    wallet.LockAsync().GetAwaiter().GetResult()
                    Console.WriteLine("Wallet locked")
                } else if command == "send" {
                    wallet.RefreshAsync().GetAwaiter().GetResult()
                    let estimate = wallet.EstimateAsync(arguments[2], arguments[3], memo).GetAwaiter().GetResult()
                    if estimate.Handle.Length > 0 {
                        Console.WriteLine("Blocknet ID: " + estimate.Handle)
                    }
                    Console.WriteLine("Recipient: " + estimate.Address)
                    Console.WriteLine("Amount: " + WalletAmount.Format(estimate.Amount) + " BNT")
                    Console.WriteLine("Fee: " + WalletAmount.Format(estimate.Fee) + " BNT")
                    Console.WriteLine("Total: " + WalletAmount.Format(estimate.Total) + " BNT")
                    if !dryRun {
                        RequireTerminal()
                        Console.Error.Write("Type send to submit: ")
                        if Console.ReadLine() != "send" {
                            throw WalletException("Send cancelled")
                        }
                        let result = wallet.SubmitAsync(estimate).GetAwaiter().GetResult()
                        Console.WriteLine("Submitted: " + result.TxId)
                    }
                } else {
                    wallet.RefreshAsync().GetAwaiter().GetResult()
                    let snapshot = wallet.Snapshot
                    if command == "address" {
                        Console.WriteLine(snapshot.Address)
                    } else if command == "balance" {
                        let balance = snapshot.Balance ?? throw WalletException("Wallet balance is unavailable")
                        Console.WriteLine("Balance: " + FormatAmount(balance.Balance) + " BNT")
                        Console.WriteLine("Spendable: " + FormatAmount(balance.Spendable) + " BNT")
                        Console.WriteLine("Pending: " + FormatAmount(balance.Pending) + " BNT")
                    } else {
                        var count = 0
                        for send in snapshot.Sends {
                            if count >= limit {
                                break
                            }
                            Console.WriteLine(
                                "Sent " + send.TxId + " " + WalletAmount.Format(send.Amount) + " BNT " + send.Status
                            )
                            count = count + 1
                        }
                        for output in snapshot.History {
                            if count >= limit {
                                break
                            }
                            Console.WriteLine(
                                "Received " + output.TxId + ":" + output.OutputIndex.ToString(
                                    CultureInfo.InvariantCulture
                                ) +
                                    " " +
                                    WalletAmount.Format(output.Amount) + " BNT height " + output.BlockHeight.ToString(
                                    CultureInfo.InvariantCulture
                                )
                            )
                            count = count + 1
                        }
                    }
                }
                return 0
            } catch (error Exception) {
                Console.Error.WriteLine(error.Message.Replace('\r', ' ').Replace('\n', ' '))
                return 1
            }
        }

        private func RunNode(wallet WalletController, action string) int32 {
            if action == "start" {
                wallet.StartNodeAsync().GetAwaiter().GetResult()
            } else {
                wallet.RefreshNodeAsync().GetAwaiter().GetResult()
                if action == "stop" {
                    wallet.StopNodeAsync().GetAwaiter().GetResult()
                }
            }
            let status = wallet.NodeStatus
            Console.WriteLine("Source: " + status.Source)
            Console.WriteLine("Owned: " + status.Owned.ToString())
            Console.WriteLine("Running: " + status.Running.ToString())
            Console.WriteLine("Version: " + status.Version)
            Console.WriteLine("Network: " + status.Network)
            Console.WriteLine("Height: " + status.Height.ToString(CultureInfo.InvariantCulture))
            Console.WriteLine("Chain height: " + status.ChainHeight.ToString(CultureInfo.InvariantCulture))
            Console.WriteLine("Syncing: " + status.Syncing.ToString())
            if let progress = status.SyncProgress {
                Console.WriteLine("Sync height: " + progress.ToString(CultureInfo.InvariantCulture))
            }
            Console.WriteLine("Peers: " + status.Peers.ToString(CultureInfo.InvariantCulture))
            Console.WriteLine("Endpoint: " + status.Endpoint)
            Console.WriteLine("Data directory: " + status.DataDirectory)
            Console.WriteLine("Executable: " + status.Executable)
            Console.WriteLine("Progress: " + status.Progress)
            if action == "start" && status.Owned {
                using let stopped = ManualResetEventSlim(false)
                let cancel ConsoleCancelEventHandler = (sender, event) -> {
                    event.Cancel = true
                    stopped.Set()
                }
                Console.CancelKeyPress += cancel
                try {
                    Console.Error.WriteLine("Node runs until this command exits. Press Ctrl+C to stop")
                    stopped.Wait()
                } finally {
                    Console.CancelKeyPress -= cancel
                }
            }
            return 0
        }

        private func FormatAmount(amount uint64?) string -> if let value = amount {
            WalletAmount.Format(value)
        } else {
            "unavailable"
        }

        private func RequireTerminal() {
            if Console.IsInputRedirected {
                throw WalletException("This command requires terminal input")
            }
        }

        private func ReadPassword()[]char {
            RequireTerminal()
            Console.Error.Write("Password: ")
            var buffer = [64]char
            var length = 0
            let previous = Console.TreatControlCAsInput
            Console.TreatControlCAsInput = true
            try {
                while true {
                    let key = Console.ReadKey(true)
                    if key.Key == ConsoleKey.Enter {
                        let password = [length]char
                        Array.Copy(buffer, password, length)
                        return password
                    }
                    if key.KeyChar == '\u0003' || key.KeyChar == '\u0004' {
                        throw WalletException("Password entry cancelled")
                    }
                    if key.Key == ConsoleKey.Backspace {
                        if length > 0 {
                            length = length - 1
                            buffer[length] = '\0'
                        }
                    } else if !char.IsControl(key.KeyChar) {
                        if length == buffer.Length {
                            let expanded = [buffer.Length * 2]char
                            Array.Copy(buffer, expanded, length)
                            Array.Clear(buffer)
                            buffer = expanded
                        }
                        buffer[length] = key.KeyChar
                        length = length + 1
                    }
                }
            } finally {
                Array.Clear(buffer)
                Console.TreatControlCAsInput = previous
                Console.Error.WriteLine()
            }
        }

        func Usage(writer TextWriter) int32 {
            writer.WriteLine("Usage: gyroid [--width N] [--height N] [--scale N]")
            writer.WriteLine("       gyroid --help | --version | status | balance | address | unlock | lock")
            writer.WriteLine("       gyroid node status | start | stop")
            writer.WriteLine("       gyroid history [--limit N]")
            writer.WriteLine("       gyroid send <address> <amount> [--memo TEXT] [--dry-run]")
            return 2
        }
    }
}
