package Gyroid.Cli

import Gyroid.History
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Settings
import Gyroid.Wallet
import System
import System.Globalization
import System.IO
import System.Reflection
import System.Threading

class Cli {
    shared {
        func Run(input[]string, stopped ManualResetEventSlim, started Action[WalletSession]) int32 {
            var arguments = input
            let command = arguments[1]
            for index in 2 ... arguments.Length {
                if arguments[index] == "--" {
                    break
                }
                if arguments[index] == "--help" {
                    Usage(
                        Console.Out,
                        index > 2 && (command == "node" || command == "settings" || command == "view-only")
                        ? command + " " + arguments[2]: command
                    )
                    return 0
                }
            }
            if command == "sign" && arguments.Length == 4 && arguments[2] == "--" {
                arguments = []string{arguments[0], command, arguments[3]}
            }
            var limit int32 = 20
            var memo = ""
            var dryRun = false
            let resume = command == "send" && arguments.Length == 3 && arguments[2] == "--resume"
            if command == "node" {
                if arguments.Length != 3 ||
                    (
                    arguments[2] != "status" &&
                        arguments[2] != "start" &&
                        arguments[2] != "stop" &&
                        arguments[2] != "purge"
                ) {
                    return Usage(Console.Error)
                }
            } else if command == "settings" {
                if arguments.Length != 2 && arguments.Length != 4 {
                    return Usage(Console.Error)
                }
            } else if command == "sign" || command == "prove" || command == "load" {
                if arguments.Length != 3 {
                    return Usage(Console.Error)
                }
            } else if command == "verify" {
                if arguments.Length != 5 {
                    return Usage(Console.Error)
                }
            } else if command == "verify-proof" {
                if arguments.Length != 6 {
                    return Usage(Console.Error)
                }
            } else if command == "viewkeys" {
                if arguments.Length != 3 || arguments[2] != "--show" {
                    return Usage(Console.Error)
                }
            } else if command == "view-only" {
                if arguments.Length != 4 || (arguments[2] != "create" && arguments[2] != "import") {
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
                if arguments.Length < 4 && !resume {
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
                    command != "lock" &&
                    command != "unload" &&
                    command != "sync"
            ) {
                return Usage(Console.Error)
            }
            if command == "--help" {
                Usage(Console.Out)
                return 0
            }
            if command == "--version" {
                let version = Assembly.GetExecutingAssembly()
                    .GetCustomAttribute[AssemblyInformationalVersionAttribute]()
                Console.WriteLine("Gyroid " + (version?.InformationalVersion ?? "unknown").Split('+')[0])
                return 0
            }
            try {
                if command == "send" && !resume {
                    arguments[2] = ReadValue(arguments[2], "Recipient address: ")
                    memo = ReadValue(memo, "Memo: ")
                } else if command == "verify-proof" {
                    arguments[3] = ReadValue(arguments[3], "Transaction key: ")
                    arguments[4] = ReadValue(arguments[4], "Recipient address: ")
                } else if command == "verify" {
                    arguments[2] = ReadValue(arguments[2], "Wallet address: ")
                }
                if command == "send" && !resume {
                    WalletValidation.ValidateSend(arguments[2], arguments[3], memo)
                }
                using let wallet = WalletSession()
                started(wallet)
                let problem = wallet.Settings.LoadError
                if problem.Length > 0 && !(command == "settings" && arguments.Length == 4) {
                    Console.Error.WriteLine("Settings file not loaded: " + problem)
                    return 1
                }
                if command == "settings" {
                    return RunSettings(wallet, arguments)
                }
                if command == "node" {
                    return RunNode(wallet, arguments[2], stopped)
                }
                wallet.StartNodeAsync().GetAwaiter().GetResult()
                if command == "status" {
                    let status = wallet.Node.Status
                    Console.WriteLine("Node: reachable")
                    Console.WriteLine("Chain height: " + status.Height.ToString(CultureInfo.InvariantCulture))
                    Console.WriteLine("Syncing: " + status.Syncing.ToString())
                    if let height = status.SyncProgress {
                        Console.WriteLine("Sync height: " + height.ToString(CultureInfo.InvariantCulture))
                    }
                    Console.WriteLine("Wallet: " + wallet.Snapshot.State)
                    if let pending = wallet.Send.Pending {
                        Console.WriteLine("Pending send: " + pending.State)
                    }
                    if wallet.Send.Outcome.Text.Length > 0 {
                        Console.WriteLine(wallet.Send.Outcome.Text)
                    }
                } else if command == "unlock" || command == "load" {
                    if command == "load" {
                        wallet.Library.ChooseWalletAsync(arguments[2]).GetAwaiter().GetResult()
                    }
                    {
                        let password = ReadPassword()
                        defer Array.Clear(password)
                        wallet.UnlockAsync(password, scheduleLock: true).GetAwaiter().GetResult()
                    }
                    Console.WriteLine("Wallet unlocked")
                } else if command == "lock" {
                    wallet.LockAsync().GetAwaiter().GetResult()
                    Console.WriteLine("Wallet locked")
                } else if command == "unload" {
                    wallet.UnloadAsync().GetAwaiter().GetResult()
                    Console.WriteLine("Wallet unloaded")
                } else if command == "sync" {
                    wallet.SyncAsync().GetAwaiter().GetResult()
                    Console.WriteLine("Wallet sync complete")
                } else if command == "sign" {
                    Console.WriteLine(wallet.Proofs.SignAsync(arguments[2]).GetAwaiter().GetResult())
                } else if command == "verify" {
                    let valid = wallet
                        .Proofs
                        .VerifyAsync(arguments[2], arguments[3], arguments[4])
                        .GetAwaiter()
                        .GetResult()
                    Console.WriteLine(
                        if valid {
                            "Signature valid"
                        } else {
                            "Signature invalid"
                        }
                    )
                    return if valid {
                        0
                    } else {
                        1
                    }
                } else if command == "prove" {
                    Console.WriteLine(wallet.Proofs.ProveAsync(arguments[2]).GetAwaiter().GetResult())
                } else if command == "verify-proof" {
                    let valid = wallet
                        .Proofs
                        .VerifyProofAsync(arguments[2], arguments[3], arguments[4], arguments[5])
                        .GetAwaiter()
                        .GetResult()
                    Console.WriteLine(
                        if valid {
                            "Payment proof valid"
                        } else {
                            "Payment proof invalid"
                        }
                    )
                    return if valid {
                        0
                    } else {
                        1
                    }
                } else if command == "viewkeys" || command == "view-only" {
                    return RunViewOnly(wallet, arguments)
                } else if command == "send" {
                    if resume {
                        if wallet.Send.Pending == nil {
                            if wallet.Send.Outcome.TxId.Length > 0 {
                                Console.WriteLine(wallet.Send.Outcome.Text)
                                return 0
                            }
                            throw WalletException(
                                if wallet.Send.Outcome.Text.Length > 0 {
                                    wallet.Send.Outcome.Text
                                } else {
                                    "No pending send"
                                }
                            )
                        }
                        if wallet.Send.Pending?.Retryable != true {
                            throw WalletException("Send outcome unknown. Resubmission is not available")
                        }
                        RequireTerminal()
                        Console.Error.WriteLine(
                            "Resubmitting an unknown send can pay twice if the node forgot its record"
                        )
                        Console.Error.Write("Type resubmit to submit the same request: ")
                        if Console.ReadLine() != "resubmit" {
                            throw WalletException("Send cancelled")
                        }
                        let result = wallet.Send.ResumeAsync().GetAwaiter().GetResult()
                        Console.WriteLine("Submitted: " + result.TxId)
                        return 0
                    }
                    wallet.RefreshAsync().GetAwaiter().GetResult()
                    let estimate = wallet
                        .Send
                        .EstimateAsync(
                        []WalletRecipient{WalletValidation.ValidateSend(arguments[2], arguments[3], memo)}
                    )
                        .GetAwaiter()
                        .GetResult()
                    if estimate.Handles[0].Length > 0 {
                        Console.WriteLine("Blocknet ID: " + estimate.Handles[0])
                    }
                    Console.WriteLine("Recipient: " + estimate.Recipients[0].Address)
                    Console.WriteLine("Amount: " + WalletAmount.Format(estimate.Amount) + " BNT")
                    Console.WriteLine("Fee: " + WalletAmount.Format(estimate.Fee) + " BNT")
                    Console.WriteLine("Total: " + WalletAmount.Format(estimate.Total) + " BNT")
                    if !dryRun {
                        RequireTerminal()
                        Console.Error.Write("Type send to submit: ")
                        if Console.ReadLine() != "send" {
                            throw WalletException("Send cancelled")
                        }
                        let result = wallet.Send.SubmitAsync(estimate).GetAwaiter().GetResult()
                        Console.WriteLine("Submitted: " + result.TxId)
                    }
                } else {
                    wallet.RefreshAsync().GetAwaiter().GetResult()
                    var snapshot = wallet.Snapshot
                    if command == "address" || command == "history" {
                        wallet.RequireUnlocked()
                    }
                    while command == "history" && snapshot.HistoryMore && snapshot.History.Length < limit {
                        wallet.History.LoadMoreAsync().GetAwaiter().GetResult()
                        snapshot = wallet.Snapshot
                    }
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
                if (command == "status" || command == "balance") && wallet.Send.Error.Length > 0 {
                    Console.WriteLine(wallet.Send.Error)
                }
                return 0
            } catch (error Exception) {
                Console.Error.WriteLine(error.Message.Replace('\r', ' ').Replace('\n', ' '))
                return 1
            }
        }

        private func RunViewOnly(wallet WalletSession, arguments[]string) int32 {
            if arguments[1] == "viewkeys" {
                RequireTerminal()
                if Console.IsOutputRedirected {
                    throw WalletException("View keys can only be shown on a terminal")
                }
                let password = ReadPassword()
                defer Array.Clear(password)
                using let keys = wallet.Keys.ExportViewKeysAsync(password).GetAwaiter().GetResult()
                Console.Write("Spend public key: ")
                Console.WriteLine(keys.SpendPublic)
                Console.Write("View private key: ")
                Console.WriteLine(keys.ViewPrivate)
                Console.Write("View public key: ")
                Console.WriteLine(keys.ViewPublic)
            } else if arguments[2] == "create" {
                {
                    let password = ReadPassword()
                    defer Array.Clear(password)
                    let filePassword = ReadPassword("View-only file password: ")
                    defer Array.Clear(filePassword)
                    wallet.Keys.CreateViewOnlyAsync(arguments[3], password, filePassword).GetAwaiter().GetResult()
                }
                Console.WriteLine("View-only wallet file created")
            } else {
                {
                    let spendPublic = ReadPassword("Spend public key: ")
                    defer Array.Clear(spendPublic)
                    let viewPrivate = ReadPassword("View private key: ")
                    defer Array.Clear(viewPrivate)
                    let password = ReadPassword("View-only file password: ")
                    defer Array.Clear(password)
                    wallet
                        .ImportViewOnlyAsync(arguments[3], spendPublic, viewPrivate, password)
                        .GetAwaiter()
                        .GetResult()
                }
                Console.WriteLine("View-only wallet imported")
            }
            return 0
        }

        private func RunSettings(wallet WalletSession, arguments[]string) int32 {
            if arguments.Length == 4 {
                if arguments[2] != "auto-lock" {
                    return Usage(Console.Error)
                }
                if !Int32.TryParse(arguments[3], NumberStyles.None, CultureInfo.InvariantCulture, out let minutes) {
                    throw WalletException("Auto-lock minutes must be zero or greater")
                }
                wallet.SaveAutoLockAsync(minutes, scheduleLock: true).GetAwaiter().GetResult()
            }
            Console.WriteLine(
                "Auto-lock minutes: " + wallet.Settings.AutoLockMinutes.ToString(CultureInfo.InvariantCulture)
            )
            return 0
        }

        private func RunNode(wallet WalletSession, action string, stopped ManualResetEventSlim) int32 {
            if action == "purge" {
                RequireTerminal()
                Console.Error.Write("Purge blockchain data? Wallet files will be kept. Type purge to confirm: ")
                if Console.ReadLine() != "purge" {
                    throw WalletException("Purge cancelled")
                }
                wallet.PurgeDataAsync().GetAwaiter().GetResult()
                Console.WriteLine("Blockchain data purged. Wallet files were kept")
            } else if action == "start" {
                wallet.StartNodeAsync().GetAwaiter().GetResult()
            } else {
                wallet.RefreshNodeAsync().GetAwaiter().GetResult()
                if action == "stop" {
                    wallet.StopNodeAsync().GetAwaiter().GetResult()
                }
            }
            let status = wallet.Node.Status
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
                Console.Error.WriteLine("Node runs until this command exits. Press Ctrl+C to stop")
                stopped.Wait()
            }
            return 0
        }

        private func FormatAmount(amount uint64?) string -> if let value = amount {
            WalletAmount.Format(value)
        } else {
            "unavailable"
        }

        private func ReadValue(value string, prompt string) string {
            if value != "-" {
                return value
            }
            if !Console.IsInputRedirected {
                Console.Error.Write(prompt)
            }
            return Console.ReadLine() ?? throw WalletException("Input ended before a value was provided")
        }

        private func RequireTerminal() {
            if Console.IsInputRedirected {
                throw WalletException("This command requires terminal input")
            }
        }

        private func ReadPassword(prompt string = "Password: ")[]char {
            RequireTerminal()
            Console.Error.Write(prompt)
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

        func Usage(writer TextWriter, command string = "") int32 {
            if command.Length > 0 {
                let syntax = switch command {
                    case "node": "node status | start | stop | purge"
                    case "settings": "settings [auto-lock <minutes>]"
                    case "settings auto-lock": "settings auto-lock <minutes>"
                    case "view-only create": "view-only create <filename.wallet.dat>"
                    case "view-only import": "view-only import <filename.dat>"
                    case "history": "history [--limit N]"
                    case "send": "send <address> <amount> [--memo TEXT] [--dry-run] | send --resume"
                    case "load": "load <filename.dat>"
                    case "sign": "sign [--] <message>"
                    case "verify": "verify <address> <message> <signature>"
                    case "prove": "prove <txid>"
                    case "verify-proof": "verify-proof <txid> <tx-key> <address> <amount>"
                    case "viewkeys": "viewkeys --show"
                    case "view-only": "view-only create <filename.wallet.dat> | view-only import <filename.dat>"
                    default: command
                }
                writer.WriteLine("Usage: gyroid " + syntax)
                return 2
            }
            writer.WriteLine("Usage: gyroid [--width N] [--height N] [--scale N]")
            writer.WriteLine("       gyroid --help | --version | status | balance | address | unlock | lock")
            writer.WriteLine("       gyroid node status | start | stop | purge")
            writer.WriteLine("       gyroid history [--limit N]")
            writer.WriteLine("       gyroid send <address> <amount> [--memo TEXT] [--dry-run]")
            writer.WriteLine("       gyroid send --resume")
            writer.WriteLine("       gyroid sync | unload | load <filename.dat>")
            writer.WriteLine("       gyroid sign [--] <message> | verify <address> <message> <signature>")
            writer.WriteLine("       gyroid prove <txid> | verify-proof <txid> <tx-key> <address> <amount>")
            writer.WriteLine(
                "       Use - for an address, transaction key or memo to read one line from stdin or a terminal"
            )
            writer.WriteLine("       gyroid viewkeys --show")
            writer.WriteLine("       gyroid view-only create <filename.wallet.dat> | import <filename.dat>")
            writer.WriteLine("       gyroid settings [auto-lock <minutes>]")
            return 2
        }
    }
}
