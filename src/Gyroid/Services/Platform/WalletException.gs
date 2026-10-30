package Gyroid.Services

import System

class WalletException : Exception {
    let StatusCode int32
    let OutcomeUnknown bool

    init(message string, statusCode int32 = 0, outcomeUnknown bool = false) : base(message) {
        StatusCode = statusCode
        OutcomeUnknown = outcomeUnknown
    }
}
