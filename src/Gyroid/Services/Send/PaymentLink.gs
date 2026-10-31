package Gyroid.Services

import System

data class PaymentLink(Address string, Amount string, Memo string) {
    shared {
        func Parse(value string) PaymentLink? {
            let text = value.Trim()
            if text.Length > 2048 || !text.StartsWith("blocknet://", StringComparison.OrdinalIgnoreCase) {
                return nil
            }
            let query = text.IndexOf('?')
            let address = query < 0 ? text.Substring(11): text.Substring(11, query - 11)
            var amount = ""
            var memo = ""
            if query >= 0 {
                for part in text.Substring(query + 1).Split('&') {
                    let separator = part.IndexOf('=')
                    if separator < 0 {
                        continue
                    }
                    let name = part.Substring(0, separator)
                    if name == "amount" || name == "memo" {
                        let decoded = Uri.UnescapeDataString(part.Substring(separator + 1))
                        if name == "amount" {
                            amount = decoded
                        } else {
                            memo = decoded
                        }
                    }
                }
            }
            return PaymentLink(address, amount, memo)
        }
    }
}
