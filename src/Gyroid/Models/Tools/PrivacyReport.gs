package Gyroid.Models

import System
import System.IO

struct PrivacyCheckResult {
    var PhraseChecked DateTime?
    var WalletFileMode UnixFileMode?
}

class StaleOutput {
    var Height uint64
    var Output string = ""
    var Reason string = ""
    var Amount uint64
}

class OutputReport {
    var Total uint64
    var Stale[]StaleOutput = []StaleOutput{}
    var StaleAmount uint64
    var Duplicates uint64
    var Unspendable uint64
    var Synced uint64
    var Checked DateTime
}

class ObserverView {
    var Rings[]int32 = []int32{}
    var RingSize int32
    var OutputKeys[]string = []string{}
    var Commitment string = ""
    var MemoBytes int32
    var Fee uint64
    var Height uint64
}
