package Gyroid.Cli

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
        func Run(arguments[]string) int32 {
            let command = arguments[1]
            var limit int32 = 20
            var memo = ""
            var dryRun = false
            let resume = command == "send" && arguments.Length == 3 && arguments[2] == "--resume"
            if command == "node" {
                if arguments.Length != 3 ||
                    (arguments[2] != "status" && arguments[2] != "start" && arguments[2] != "stop") {
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
                    command != "rescan"
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
                    WalletValidation.ValidateSend(arguments[2], arguments[3], memo)
                }
                using let wallet = WalletSession()
                let problem = wallet.Settings.LoadError
                if problem.Length > 0 {
                    Console.Error.WriteLine("Settings file not loaded: " + problem)
                    return 1
                }
                if command == "settings" {
                    return RunSettings(wallet.Settings, arguments)
                }
                if command == "node" {
                    return RunNode(wallet, arguments[2])
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
                } else if command == "unload" {
                    wallet.UnloadAsync().GetAwaiter().GetResult()
                    Console.WriteLine("Wallet unloaded")
                } else if command == "rescan" {
                    wallet.RescanAsync().GetAwaiter().GetResult()
                    Console.WriteLine("Wallet rescan complete")
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
                    let estimate = wallet.Send.EstimateAsync(arguments[2], arguments[3], memo).GetAwaiter().GetResult()
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
                        let result = wallet.Send.SubmitAsync(estimate).GetAwaiter().GetResult()
                        Console.WriteLine("Submitted: " + result.TxId)
                    }
                } else {
                    wallet.RefreshAsync().GetAwaiter().GetResult()
                    var snapshot = wallet.Snapshot
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
                try {
                    using let keys = wallet.Keys.ExportViewKeysAsync(password).GetAwaiter().GetResult()
                    Console.Write("Spend public key: ")
                    Console.WriteLine(keys.SpendPublic)
                    Console.Write("View private key: ")
                    Console.WriteLine(keys.ViewPrivate)
                    Console.Write("View public key: ")
                    Console.WriteLine(keys.ViewPublic)
                } finally {
                    Array.Clear(password)
                }
            } else if arguments[2] == "create" {
                let password = ReadPassword()
                try {
                    let filePassword = ReadPassword("View-only file password: ")
                    try {
                        wallet.Keys.CreateViewOnlyAsync(arguments[3], password, filePassword).GetAwaiter().GetResult()
                    } finally {
                        Array.Clear(filePassword)
                    }
                } finally {
                    Array.Clear(password)
                }
                Console.WriteLine("View-only wallet file created")
            } else {
                let spendPublic = ReadPassword("Spend public key: ")
                try {
                    let viewPrivate = ReadPassword("View private key: ")
                    try {
                        let password = ReadPassword("View-only file password: ")
                        try {
                            wallet
                                .ImportViewOnlyAsync(arguments[3], spendPublic, viewPrivate, password)
                                .GetAwaiter()
                                .GetResult()
                        } finally {
                            Array.Clear(password)
                        }
                    } finally {
                        Array.Clear(viewPrivate)
                    }
                } finally {
                    Array.Clear(spendPublic)
                }
                Console.WriteLine("View-only wallet imported")
            }
            return 0
        }

        private func RunSettings(settings WalletSettings, arguments[]string) int32 {
            if arguments.Length == 4 {
                if arguments[2] != "auto-lock" {
                    return Usage(Console.Error)
                }
                if !Int32.TryParse(arguments[3], NumberStyles.None, CultureInfo.InvariantCulture, out let minutes) {
                    throw WalletException("Auto-lock minutes must be zero or greater")
                }
                settings.AutoLockMinutes = minutes
                WalletSettings.SaveAsync(settings, default(CancellationToken)).GetAwaiter().GetResult()
            }
            Console.WriteLine("Auto-lock minutes: " + settings.AutoLockMinutes.ToString(CultureInfo.InvariantCulture))
            return 0
        }

        private func RunNode(wallet WalletSession, action string) int32 {
            if action == "start" {
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

        func Usage(writer TextWriter) int32 {
            writer.WriteLine("Usage: gyroid [--width N] [--height N] [--scale N]")
            writer.WriteLine("       gyroid --help | --version | status | balance | address | unlock | lock")
            writer.WriteLine("       gyroid node status | start | stop")
            writer.WriteLine("       gyroid history [--limit N]")
            writer.WriteLine("       gyroid send <address> <amount> [--memo TEXT] [--dry-run]")
            writer.WriteLine("       gyroid send --resume")
            writer.WriteLine("       gyroid rescan | unload | load <filename.dat>")
            writer.WriteLine("       gyroid sign <message> | verify <address> <message> <signature>")
            writer.WriteLine("       gyroid prove <txid> | verify-proof <txid> <tx-key> <address> <amount>")
            writer.WriteLine("       gyroid viewkeys --show")
            writer.WriteLine("       gyroid view-only create <filename.wallet.dat> | import <filename.dat>")
            writer.WriteLine("       gyroid settings [auto-lock <minutes>]")
            return 2
        }
    }
}
