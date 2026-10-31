package Gyroid.Models

import System
import System.IO
import System.Reflection
import System.Text

class TextCodec {
    shared {
        private let Model[]uint8 = Load()

        func Encode(text string)[]uint8 {
            let raw = Encoding.UTF8.GetBytes(text)
            if raw.Length > 30000 {
                throw ArgumentException("Message is too long")
            }
            let buffer = [raw.Length + 6]uint8
            var cursor = buffer.Length
            var state uint32 = 8388608
            for index in 0 ... (raw.Length + 1) {
                let i = raw.Length - index
                let value = if i == raw.Length {
                    256
                } else {
                    int32(raw[i])
                }
                let row = Row(Class(raw, i - 3), Class(raw, i - 2), Class(raw, i - 1))
                var start uint32
                var frequency uint32
                for j in 0 ... 16 {
                    let entry = Entry(row + j)
                    if (entry & 255) == value && (entry >> 8) > 0 {
                        frequency = uint32(entry >> 8)
                        break
                    }
                    start += uint32(entry >> 8)
                }
                if frequency == 0 {
                    if !Write(buffer, ref cursor, ref state, uint32(value), 1, 9) {
                        break
                    }
                    frequency = 4096 - start
                }
                if !Write(buffer, ref cursor, ref state, start, frequency, 12) {
                    break
                }
            }
            let length = buffer.Length - cursor + 5
            if length < raw.Length + 1 {
                buffer[cursor - 5] = 1
                for i in 0 ... 4 {
                    buffer[cursor - 4 + i] = uint8((state >> (i * 8)) & 255)
                }
                let result = [length]uint8
                Array.Copy(buffer, cursor - 5, result, 0, length)
                return result
            }
            let result = [raw.Length + 1]uint8
            Array.Copy(raw, 0, result, 1, raw.Length)
            return result
        }

        func Decode(body[]uint8) string {
            if body.Length == 0 {
                throw FormatException("Missing text codec")
            }
            if body.Length > 30001 {
                throw FormatException("Text exceeds message limit")
            }
            let utf8 = UTF8Encoding(false, true)
            if body[0] == 0 {
                return utf8.GetString(body, 1, body.Length - 1)
            }
            if body[0] != 1 || body.Length < 5 {
                throw FormatException("Unsupported text codec")
            }
            var state uint32 = 0
            for i in 0 ... 4 {
                state |= uint32(body[i + 1]) << (i * 8)
            }
            if state < 8388608 {
                throw FormatException("Invalid compressed state")
            }
            using let output = MemoryStream()
            var cursor = 5
            var a = 26
            var b = 26
            var c = 26
            while true {
                let row = Row(a, b, c)
                let slot = state & 4095
                var start uint32
                var frequency uint32
                var value = 256
                for j in 0 ... 16 {
                    let entry = Entry(row + j)
                    frequency = uint32(entry >> 8)
                    if slot < start + frequency {
                        value = entry & 255
                        break
                    }
                    start += frequency
                }
                if value == 256 {
                    Read(body, ref cursor, ref state, start, 4096 - start, 12)
                    value = int32(state & 511)
                    if value > 256 {
                        throw FormatException("Invalid compressed byte")
                    }
                    Read(body, ref cursor, ref state, uint32(value), 1, 9)
                } else {
                    Read(body, ref cursor, ref state, start, frequency, 12)
                }
                if value == 256 {
                    if cursor != body.Length || state != 8388608 {
                        throw FormatException("Invalid compressed length")
                    }
                    return utf8.GetString(output.GetBuffer(), 0, int32(output.Length))
                }
                if output.Length == 30000 {
                    throw FormatException("Text exceeds message limit")
                }
                output.WriteByte(uint8(value))
                a = b
                b = c
                c = Context(uint8(value))
            }
        }

        private func Load()[]uint8 {
            using let stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Gyroid.TextModel.bin")
            if stream == nil {
                throw InvalidOperationException("Missing text model")
            }
            let bytes = [int32(stream.Length)]uint8
            stream.ReadExactly(bytes, 0, bytes.Length)
            return bytes
        }

        private func Row(a int32, b int32, c int32) int32 ->
        int32(((uint64(a * 1024 + b * 32 + c) * 2654435761) & 4294967295) >> 19) * 16

        private func Entry(index int32) int32 ->
        int32(Model[index * 3]) | (int32(Model[index * 3 + 1]) << 8) | (int32(Model[index * 3 + 2]) << 16)

        private func Class(raw[]uint8, index int32) int32 -> if index >= 0 {
            Context(raw[index])
        } else {
            26
        }

        private func Context(value uint8) int32 {
            let lower = int32(value) | 32
            return if lower >= 97 && lower <= 122 {
                lower - 97
            } else {
                if lower == 32 {
                    26
                } else {
                    27
                }
            }
        }

        private func Write(
            buffer[]uint8,
            ref cursor int32,
            ref state uint32,
            start uint32,
            frequency uint32,
            bits int32
        ) bool {
            while state >= frequency << (31 - bits) {
                if cursor <= 5 {
                    return false
                }
                cursor--
                buffer[cursor] = uint8(state & 255)
                state >>= 8
            }
            state = ((state / frequency) << bits) + state % frequency + start
            return true
        }

        private func Read(body[]uint8, ref cursor int32, ref state uint32, start uint32, frequency uint32, bits int32) {
            state = frequency * (state >> bits) + (state & ((uint32(1) << bits) - 1)) - start
            while state < 8388608 {
                if cursor == body.Length {
                    throw FormatException("Truncated compressed text")
                }
                state = (state << 8) | uint32(body[cursor])
                cursor++
            }
        }
    }
}
