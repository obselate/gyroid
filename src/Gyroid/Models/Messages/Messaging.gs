package Gyroid.Models

import System
import System.Collections.Generic

enum MessengerMode {
    Disconnected,
    ReadOnly,
    Send
}

enum MessageState {
    InProgress,
    Pending,
    Confirmed,
    Failed
}

enum Verification {
    Checking,
    Verified,
    Unverified,
    Invalid
}

class Message {
    var Key string = ""
    var Txid string = ""
    var Outgoing bool
    var SenderName string = ""
    var SenderAddress string = ""
    var Text string = ""
    var SentAt DateTimeOffset
    var State MessageState
    var Confirmations int32
    var ArrivedAt DateTimeOffset?
    var EtaSeconds float64
    var Verification Verification
    var FeeAtomic int64
    var Outputs int32
}

class Conversation {
    var Id string = ""
    var Title string = ""
    var Handle string = ""
    var IsGroup bool
    var Members List[string] = List[string]()
    var Messages List[Message] = List[Message]()
    var Unread int32
}

data struct MessageReference(ConversationId string, MessageId string)

class MessageEstimate {
    var Outputs int32
    var BytesUsed int32
    var Capacity int32
    var FeeAtomic int64
    var AmountAtomic int64
    var BodyBytes int32
    var Fits bool = true
}
