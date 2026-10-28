package Gyroid.Wallet

import Gyroid.History
import Gyroid.Platform
import Gyroid.Send
import System
import System.Globalization
import System.IO
import System.Numerics
import System.Security.Cryptography
import System.Text

class WalletAmount {
    shared {
        func Parse(text string) uint64 {
            if text.Length == 0 || text.Length > 30 || text[0] < '0' || text[0] > '9' {
                throw WalletException("Enter a positive decimal BNT amount")
            }
            var value uint64 = 0
            var decimals int32 = -1
            var digits int32 = 0
            for character in text {
                if character == '.' && decimals == -1 {
                    decimals = 0
                    continue
                }
                if character < '0' || character > '9' {
                    throw WalletException("Amount must use decimal digits and a decimal point")
                }
                if decimals >= 0 {
                    decimals = decimals + 1
                    if decimals > 8 {
                        throw WalletException("Amount supports at most 8 decimal places")
                    }
                }
                let digit = uint64(character - '0')
                if value > (uint64.MaxValue - digit) / uint64(10) {
                    throw WalletException("Amount exceeds the supported range")
                }
                value = value * 10 + digit
                digits = digits + 1
            }
            if digits == 0 || decimals == 0 {
                throw WalletException("Enter a complete positive BNT amount")
            }
            var places = if decimals < 0 {
                8
            } else {
                8 - decimals
            }
            while places > 0 {
                if value > uint64.MaxValue / uint64(10) {
                    throw WalletException("Amount exceeds the supported range")
                }
                value = value * 10
                places = places - 1
            }
            if value == 0 {
                throw WalletException("Amount must be greater than zero")
            }
            return value
        }

        func Format(amount uint64) string {
            let whole = (amount / uint64(100000000)).ToString(CultureInfo.InvariantCulture)
            let fraction = amount % uint64(100000000)
            if fraction == 0 {
                return whole
            }
            return whole + "." + fraction.ToString("D8", CultureInfo.InvariantCulture).TrimEnd('0')
        }
    }
}

class WalletValidation {
    shared {
        let MemoLimit int32 = 124
        private let memoEncoding UTF8Encoding = UTF8Encoding(false, true)
        func ValidateMessage(message string) {
            if message.Length == 0 || Encoding.UTF8.GetByteCount(message) > 1024 {
                throw WalletException("Message must contain 1 to 1024 UTF-8 bytes")
            }
        }

        func ValidateAddress(address string) string {
            let recipient = address.Trim()
            if recipient.Length < 64 || recipient.Length > 93 {
                throw WalletException("Address must contain 64 to 93 Base58 characters")
            }
            for character in recipient {
                if !"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".Contains(character) {
                    throw WalletException("Address contains an invalid character")
                }
            }
            return recipient
        }

        func AddressIssue(address string, network string) string {
            let alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
            var value = BigInteger.Zero
            for character in address {
                value = value * 58 + alphabet.IndexOf(character)
            }
            let digits = value.ToByteArray(true, true)
            let decoded = [address.Length - address.TrimStart('1').Length + digits.Length]uint8
            digits.CopyTo(decoded, decoded.Length - digits.Length)
            if decoded.Length != 68 || !SHA3_256.IsSupported {
                return ""
            }
            let other = network == "testnet" ? "mainnet": "testnet"
            return if Checksummed(decoded, network) {
                ""
            } else if !Checksummed(decoded, other) {
                "Checksum does not match. Check for a typo"
            } else if other == "testnet" {
                "Testnet address. This wallet is on mainnet"
            } else {
                "Mainnet address. This wallet is on testnet"
            }
        }

        private func Checksummed(decoded[]uint8, network string) bool {
            let tag = Encoding.ASCII.GetBytes("blocknet_stealth_address_checksumblocknet_" + network)
            let input = [tag.Length + 64]uint8
            tag.CopyTo(input, 0)
            Array.Copy(decoded, 0, input, tag.Length, 64)
            let sum = SHA3_256.HashData(input)
            return sum[0] == decoded[64] && sum[1] == decoded[65] && sum[2] == decoded[66] && sum[3] == decoded[67]
        }

        func MemoBytes(memo string) int32 {
            for character in memo {
                if char.IsControl(character) {
                    throw WalletException("Memo cannot contain control characters")
                }
            }
            try {
                let count = memoEncoding.GetByteCount(memo)
                if count > MemoLimit {
                    throw WalletException("Memo must not exceed 124 UTF-8 bytes")
                }
                return count
            } catch (error EncoderFallbackException) {
                throw WalletException("Memo must contain valid Unicode text")
            }
        }

        func ValidateDestination(address string) string {
            let recipient = address.Trim()
            return if recipient.StartsWith("$", StringComparison.Ordinal) {
                "$" + BlocknetId.Normalize(recipient)
            } else {
                ValidateAddress(recipient)
            }
        }

        func ValidateSend(address string, amount string, memo string, spendable uint64? = nil) WalletRecipient {
            let destination = ValidateDestination(address)
            let atoms = WalletAmount.Parse(amount)
            MemoBytes(memo)
            if let available = spendable {
                if atoms > available {
                    throw WalletException("Amount exceeds spendable balance")
                }
            }
            return WalletRecipient{Address: destination, Amount: atoms, Memo: memo}
        }

        func PasswordError(password[]char, confirmation[]char) string {
            if password.Length < 3 {
                return "Password must contain at least 3 characters"
            }
            var nonWhitespace = false
            for character in password {
                if !char.IsWhiteSpace(character) {
                    nonWhitespace = true
                }
            }
            if !nonWhitespace {
                return "Password must not contain only whitespace"
            }
            if password.Length != confirmation.Length {
                return "Passwords do not match"
            }
            var difference int32 = 0
            for index in 0 ... password.Length {
                difference = difference | (int32(password[index]) ^ int32(confirmation[index]))
            }
            return if difference == 0 {
                ""
            } else {
                "Passwords do not match"
            }
        }

        func ValidateFilename(filename string) {
            if string.IsNullOrWhiteSpace(filename) || filename.Length > 180 || !filename.EndsWith(
                ".dat",
                StringComparison.Ordinal
            ) ||
                filename.Contains('/') || filename.Contains('\\') || filename.Contains("..") ||
                filename != Path.GetFileName(filename) || filename.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 {
                throw WalletException("Wallet name must be a basename ending in .dat")
            }
        }

        func NormalizePhrase(input[]char)[]char {
            let buffer = [input.Length]char
            var length int32 = 0
            var wordStart int32 = 0
            var count int32 = 0
            try {
                for character in input {
                    if char.IsWhiteSpace(character) {
                        if length > wordStart {
                            ValidateWord(buffer, wordStart, length - wordStart)
                            count = count + 1
                            buffer[length] = ' '
                            length = length + 1
                            wordStart = length
                        }
                    } else {
                        let lower = char.ToLowerInvariant(character)
                        if lower < 'a' || lower > 'z' {
                            throw WalletException("Recovery phrase must contain English BIP39 words")
                        }
                        buffer[length] = lower
                        length = length + 1
                    }
                }
                if length > wordStart {
                    ValidateWord(buffer, wordStart, length - wordStart)
                    count = count + 1
                } else if length > 0 {
                    length = length - 1
                }
                if count != 12 {
                    throw WalletException("Recovery phrase must contain 12 words")
                }
                let normalized = [length]char
                Array.Copy(buffer, normalized, length)
                return normalized
            } finally {
                Array.Clear(buffer)
            }
        }

        func ValidateWord(buffer[]char, start int32, length int32) {
            for word in Bip39Wordlist.Words {
                if word.Length != length {
                    continue
                }
                var matches = true
                for index in 0 ... length {
                    if buffer[start + index] != word[index] {
                        matches = false
                        break
                    }
                }
                if matches {
                    return
                }
            }
            throw WalletException("Recovery phrase contains a word outside the English BIP39 wordlist")
        }
    }
}
