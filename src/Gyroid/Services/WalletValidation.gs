package Gyroid.Services

import Gyroid.Model
import System
import System.Globalization
import System.IO
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
