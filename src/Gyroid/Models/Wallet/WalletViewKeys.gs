package Gyroid.Models

import System

class WalletViewKeys : IDisposable {
    var SpendPublic[]char = []char{}
    var ViewPrivate[]char = []char{}
    var ViewPublic[]char = []char{}

    func Dispose() {
        Array.Clear(SpendPublic)
        Array.Clear(ViewPrivate)
        Array.Clear(ViewPublic)
    }
}
