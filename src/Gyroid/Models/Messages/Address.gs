package Gyroid.Models

import System
import System.Numerics
import System.Security.Cryptography
import System.Text

class Address {
    shared {
        private let Alphabet string = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

        func Decode(text string, network string)[]uint8 {
            if text.Length < 68 || text.Length > 94 {
                throw ArgumentException("Invalid address length")
            }
            let result = DecodeBytes(text)
            if result.Length != 68 || Encode(result) != text || !Checksummed(result, network) {
                throw ArgumentException("Address checksum or network is invalid")
            }
            return result
        }

        func DecodeBytes(text string)[]uint8 {
            var value = BigInteger.Zero
            for character in text {
                let digit = Alphabet.IndexOf(character)
                if digit < 0 {
                    throw ArgumentException("Invalid Base58 address")
                }
                value = value * 58 + digit
            }
            let digits = value.ToByteArray(true, true)
            let decoded = [text.Length - text.TrimStart('1').Length + digits.Length]uint8
            digits.CopyTo(decoded, decoded.Length - digits.Length)
            return decoded
        }

        func Checksummed(decoded[]uint8, network string) bool {
            let domain = Encoding.ASCII.GetBytes("blocknet_stealth_address_checksumblocknet_" + network)
            let input = [domain.Length + 64]uint8
            domain.CopyTo(input, 0)
            Array.Copy(decoded, 0, input, domain.Length, 64)
            let sum = SHA3_256.HashData(input)
            return sum[0] == decoded[64] && sum[1] == decoded[65] && sum[2] == decoded[66] && sum[3] == decoded[67]
        }

        func Encode(payload[]uint8) string {
            let number = [payload.Length]uint8
            Array.Copy(payload, number, payload.Length)
            var zeros = 0
            while zeros < number.Length && number[zeros] == 0 {
                zeros++
            }
            let output = StringBuilder()
            var start = zeros
            while start < number.Length {
                var carry = 0
                for i in start ... number.Length {
                    carry = carry * 256 + int32(number[i])
                    number[i] = uint8(carry / 58)
                    carry %= 58
                }
                output.Append(Alphabet[carry])
                while start < number.Length && number[start] == 0 {
                    start++
                }
            }
            for i in 0 ... zeros {
                output.Append('1')
            }
            let characters = output.ToString().ToCharArray()
            Array.Reverse(characters)
            return System.String(characters)
        }

        func Short(text string) string -> if text.Length > 14 {
            text.Substring(0, 4) + "..." + text.Substring(text.Length - 7)
        } else {
            text
        }

        func Tag(payload[]uint8)[]uint8 {
            let digest = SHA3_256.HashData(payload)
            let tag = [4]uint8
            Array.Copy(digest, tag, 4)
            return tag
        }
    }
}
