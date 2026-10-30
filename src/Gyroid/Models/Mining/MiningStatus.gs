package Gyroid.Models

import System

data struct MiningStatus {
    var Running bool
    var Threads int32
    var Hashrate float64
    var Hashes uint64
    var Blocks uint64
    var Started DateTimeOffset
}
