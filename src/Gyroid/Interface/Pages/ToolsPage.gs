package Gyroid.Interface

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Feedback
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import Goo.Widgets.Navigation
import Gyroid.Contacts
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.Collections.Generic
import System.Threading.Tasks

partial class WalletView {
    private var toolsTab string = "sign"

    private var message string = ""

    private var signature string = ""

    private var signer string = ""

    private var verdict bool?

    private var verdictRun int32

    private func ClearTools() {
        message = ""
        signature = ""
        signer = ""
        proofTx = ""
        proofKey = ""
        proofAddress = ""
        proofAmount = ""
        ResetVerdict()
    }

    private func ResetVerdict() {
        verdict = nil
        verdictRun += 1
    }

    private func ToolsPage() Blob {
        let viewOnly = wallet.Snapshot.ViewOnly
        let tab = if viewOnly && toolsTab == "sign" {
            "verify"
        } else {
            toolsTab
        }
        let items = List[NavigationItem]()
        if !viewOnly {
            items.Add(NavigationItem{Id: "sign", Label: strings.Get("Sign")})
        }
        items.Add(NavigationItem{Id: "verify", Label: strings.Get("Verify")})
        items.Add(NavigationItem{Id: "proof", Label: strings.Get("Proof")})
        let panel = PageContent(
            strings.Get("tools"),
            640,
            Tabs(
                "tools-tabs",
                "tools",
                items.ToArray(),
                tab,
                id -> {
                    toolsTab = id
                    ResetVerdict()
                    Rebuild()
                }
            )
        )
        let verify Action = () -> Verify(tab)
        panel.Add(
            switch tab {
                case "sign": Explainer(
                    "About signing",
                    "Prove you own this wallet's address",
                    []string{
                        "Signs your message with this wallet's key",
                        "Share the message, signature and address",
                        "Nothing is sent and no coins move",
                        "Anyone can check it in Verify"
                    }
                )
                case "verify": Explainer(
                    "About verifying",
                    "Check that an address owner signed a message",
                    []string{
                        "Paste the address, message and signature",
                        "Valid means the address owner signed it",
                        "Any change to the message makes it invalid"
                    }
                )
                default: Explainer(
                    "About payment proofs",
                    "Prove you paid someone, or check a proof",
                    []string{
                        "Open a confirmed send in History, then Prove",
                        "Share the four fields below with them",
                        "Valid means that address got that amount",
                        "Anyone can check it. Your keys stay private"
                    }
                )
            }
        )
        if tab == "sign" {
            panel.Add(
                Field(
                    "Message",
                    message,
                    value -> {
                        message = value
                        signature = ""
                        Rebuild()
                    },
                    () -> Sign()
                )
            )
            if signature.Length > 0 {
                panel.Add(Copyable("Signature", signature, Grouped(signature)))
            }
            panel.Add(ActionRow([]Blob{Button("Sign", () -> Sign(), Working() || message.Length == 0, true)}))
            return panel
        }
        if tab == "proof" {
            panel.Add(ToolField("Transaction", proofTx, value -> proofTx = value.Trim(), verify))
            panel.Add(ToolField("Proof key", proofKey, value -> proofKey = value.Trim(), verify))
            panel.Add(ToolField("Address", proofAddress, value -> proofAddress = value.Trim(), verify))
            panel.Add(ToolField("Amount", proofAmount, value -> proofAmount = value.Trim(), verify))
        } else {
            panel.Add(ToolField("Address", signer, value -> signer = value.Trim(), verify))
            panel.Add(ToolField("Message", message, value -> message = value, verify))
            panel.Add(ToolField("Signature", signature, value -> signature = value.Trim(), verify))
        }
        let blank = if tab == "proof" {
            proofTx.Length == 0 || proofKey.Length == 0 || proofAddress.Length == 0 || proofAmount.Length == 0
        } else {
            signer.Length == 0 || message.Length == 0 || signature.Length == 0
        }
        let result = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, FlexGrow: 1}
        if let valid = verdict {
            let color = valid ? lime: pink
            result.Add(MaterialIcons.Create(valid ? "check_circle": "cancel", 18, color))
            result.Add(Label(strings.Get(valid ? "Valid": "Invalid"), 14, color, ""))
        }
        panel.Add(ActionRow([]Blob{result, Button("Verify", verify, Working() || blank, true)}))
        return panel
    }

    private func Sign() {
        if Working() || message.Length == 0 {
            return
        }
        let task = wallet.Proofs.SignAsync(message)
        Run(
            task,
            () -> {
                signature = task.Result
            }
        )
    }

    private func Verify(tab string) {
        if Working() {
            return
        }
        ResetVerdict()
        let run = verdictRun
        let task = if tab == "proof" {
            wallet.Proofs.VerifyProofAsync(proofTx, proofKey, proofAddress, proofAmount)
        } else {
            wallet.Proofs.VerifyAsync(signer, message, signature)
        }
        Run(
            task,
            () -> {
                if run == verdictRun {
                    verdict = task.Result
                }
            }
        )
    }
}
