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
    var ConversationId string = ""
    var Txid string = ""
    var IdempotencyKey string = ""
    var SendPayload[]uint8 = Array.Empty[uint8]()
    var Outgoing bool
    var SenderName string = ""
    var SenderAddress string = ""
    var Text string = ""
    var InvitationName string = ""
    var SentAt DateTimeOffset
    var State MessageState
    var Confirmations int32
    var ArrivedAt DateTimeOffset?
    var Height int64
    var Verification Verification
    var FeeAtomic int64
    var Outputs int32
    var OutputIndices[]int32 = Array.Empty[int32]()
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

data struct DecodedMemo(Envelope Envelope, OutputIndices[]int32, BlockHeight int64)

class MessageEstimate {
    var Outputs int32
    var BytesUsed int32
    var Capacity int32
    var FeeAtomic int64
    var AmountAtomic int64
    var BodyBytes int32
    var Fits bool = true
}

data struct MessageView {
    var Key string
    var Txid string
    var Outgoing bool
    var SenderName string
    var Text string
    var InvitationName string
    var SentAt DateTimeOffset
    var ArrivedAt DateTimeOffset?
    var State MessageState
    var Confirmations int32
    var Height int64
    var Verification Verification
}

data struct ConversationView {
    var Id string
    var Title string
    var IsGroup bool
    var Unread int32
    var Text string
    var InvitationName string
    var Time string
    var Selected bool
    var Privacy bool
    var Language string
}

data struct MessageThreadRow {
    var Key string
    var Message MessageView
    var Header string
    var First bool
    var Last bool
}

data struct MessagesProjection {
    var Conversations[]ConversationView
    var Conversation Conversation?
    var Thread[]MessageThreadRow
    var Recipients int32
    var Contacts HashSet[string]
}

data struct MessageContactView {
    var Name string
    var Destination string
    var Chosen bool
    var Disabled bool
    var Privacy bool
    var Language string
}
