package Gyroid.Models

import System
import System.Collections.Generic
import System.IO
import System.Text

class Envelope {
    var Kind uint8
    var Tag[]uint8 = [4]uint8
    var SentAt uint32
    var GroupId[]uint8 = []uint8{}
    var Sender[]uint8 = []uint8{}
    var Signature[]uint8 = [64]uint8
    var Body[]uint8 = []uint8{}
    var Text string = ""
    var GroupName string = ""
    var Members List[string] = List[string]()

    func Header()[]uint8 {
        using let stream = MemoryStream()
        using let writer = BinaryWriter(stream)
        writer.Write(uint8(16 | Kind))
        writer.Write(Tag)
        writer.Write(SentAt)
        if Kind == 2 || Kind == 3 {
            writer.Write(GroupId)
        }
        if Kind == 1 || Kind == 3 {
            writer.Write(Sender)
        }
        return stream.ToArray()
    }

    func SigningString(recipient[]uint8) string {
        using let stream = MemoryStream()
        if Kind < 2 {
            stream.Write(recipient)
        }
        stream.Write(Header())
        stream.Write(Body)
        return Convert.ToHexStringLower(stream.ToArray())
    }

    func Encode()[]uint8 {
        using let stream = MemoryStream()
        stream.Write(Header())
        stream.Write(Signature)
        stream.Write(Body)
        return stream.ToArray()
    }

    func Split() List[string] {
        let bytes = Encode()
        let output = List[string]()
        for offset in 0 ... ((bytes.Length + 123) / 124) {
            let start = offset * 124
            output.Add(Convert.ToHexStringLower(bytes.AsSpan(start, Math.Min(124, bytes.Length - start))))
        }
        return output
    }
}

class Wire {
    shared {
        func Decode(bytes[]uint8, network string) Envelope {
            if bytes.Length < 74 || bytes.Length > 31620 || (bytes[0] >> 4) != 1 || (bytes[0] & 15) > 3 {
                throw FormatException("Not a Whisper v1 message")
            }
            using let stream = MemoryStream(bytes, false)
            using let reader = BinaryReader(stream)
            let result = Envelope{
                Kind: uint8(reader.ReadByte() & 15),
                Tag: reader.ReadBytes(4),
                SentAt: reader.ReadUInt32()
            }
            if result.Kind >= 2 {
                result.GroupId = reader.ReadBytes(8)
            }
            if result.Kind == 1 || result.Kind == 3 {
                result.Sender = reader.ReadBytes(68)
                Address.Decode(Address.Encode(result.Sender), network)
                if !System.Linq.Enumerable.SequenceEqual(Address.Tag(result.Sender), result.Tag) {
                    throw FormatException("Sender tag does not match")
                }
            }
            result.Signature = reader.ReadBytes(64)
            if result.Signature.Length != 64 {
                throw FormatException("Truncated signature")
            }
            result.Body = reader.ReadBytes(int32(stream.Length - stream.Position))
            if result.Kind != 3 {
                result.Text = TextCodec.Decode(result.Body)
            } else {
                using let body = MemoryStream(result.Body, false)
                using let fields = BinaryReader(body)
                let nameLength = int32(fields.ReadUInt16())
                let name = fields.ReadBytes(nameLength)
                if name.Length != nameLength {
                    throw FormatException("Truncated group name")
                }
                result.GroupName = UTF8Encoding(false, true).GetString(name)
                let count = int32(fields.ReadByte())
                if count < 2 || body.Length - body.Position != int64(count * 68) {
                    throw FormatException("Invalid group member list")
                }
                for i in 0 ... count {
                    let address = Address.Encode(fields.ReadBytes(68))
                    Address.Decode(address, network)
                    if result.Members.Contains(address) {
                        throw FormatException("Duplicate group member")
                    }
                    result.Members.Add(address)
                }
            }
            return result
        }

        func InviteBody(name string, members List[string], network string)[]uint8 {
            let title = Encoding.UTF8.GetBytes(name)
            if title.Length == 0 || members.Count < 2 || members.Count > MaxMembers(name) {
                throw ArgumentException("Invalid group name or member count")
            }
            using let stream = MemoryStream()
            using let writer = BinaryWriter(stream)
            writer.Write(uint16(title.Length))
            writer.Write(title)
            writer.Write(uint8(members.Count))
            for member in members {
                writer.Write(Address.Decode(member, network))
            }
            return stream.ToArray()
        }

        func MaxMembers(name string) int32 -> (424 - Encoding.UTF8.GetByteCount(name)) / 68

        func Eta(chainState string, average float64) float64 -> if chainState == "mempool" {
            if average > 0 {
                average
            } else {
                300.0
            }
        } else {
            0.0
        }
    }
}
