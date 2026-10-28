package Gyroid.Platform

import System
import System.Reflection

class Resources {
    shared {
        func Resource(name string)[]uint8 {
            using let stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
            if stream == nil {
                throw InvalidOperationException("Missing resource " + name)
            }
            let bytes = [int32(stream.Length)]uint8
            stream.ReadExactly(bytes, 0, bytes.Length)
            return bytes
        }
    }
}
