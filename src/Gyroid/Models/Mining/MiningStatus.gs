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

data struct MiningSample {
    var Time DateTimeOffset
    var Hashes uint64
    var Rate float64
    var X float64
    var Y float64
    var Break bool
}

data struct MiningPollRequest {
    var Visible bool
    var Online bool
    var Revision int32
}

data struct MiningPollResult {
    var Request MiningPollRequest
    var Report MiningReport
    var Continuous bool
}

class MiningHistory {
    var Report MiningReport

    init() {
        Report = MiningReport{}
    }
}

data struct MiningReport {
    var Status MiningStatus
    var Available bool = true
    var Waiting bool
    var Samples[]MiningSample = []MiningSample{}
    var Top float64 = 0.16

    func Record(status MiningStatus, waiting bool, continuous bool, now DateTimeOffset) MiningReport {
        let result = MiningReport{... this, Status: status, Available: true, Waiting: waiting}
        if !status.Running || waiting || status.Hashes == 0 {
            return result
        }
        let count = Math.Min(Samples.Length, 719)
        let samples = [count + 1]MiningSample
        Array.Copy(Samples, Samples.Length - count, samples, 0, count)
        let interrupted = !continuous ||
            status.Started != Status.Started ||
            count == 0 ||
            (now - samples[count - 1].Time).TotalSeconds > 7.5 ||
            status.Hashes < samples[count - 1].Hashes
        var rate = 0.0
        if !interrupted {
            for index in 0 ... count {
                let sample = samples[count - index - 1]
                let seconds = (now - sample.Time).TotalSeconds
                if seconds >= 4 && seconds <= 30 && status.Hashes >= sample.Hashes {
                    rate = float64(status.Hashes - sample.Hashes) / seconds
                }
                if sample.Break || seconds >= 30 {
                    break
                }
            }
        }
        samples[count] = MiningSample{Time: now, Hashes: status.Hashes, Rate: rate, Break: interrupted}
        var peak = 0.0
        for sample in samples {
            peak = Math.Max(peak, sample.Rate)
        }
        let raw = Math.Max(peak, 0.1) * 1.3 / 4
        let magnitude = Math.Pow(10, Math.Floor(Math.Log10(raw)))
        let top = Math.Ceiling(raw / magnitude) * magnitude * 4
        let first = samples[0].Time
        let span = Math.Max(1.0, (now - first).TotalSeconds)
        for index in 0 ... samples.Length {
            samples[index] = MiningSample{
                ... samples[index],
                X: (samples[index].Time - first).TotalSeconds / span,
                Y: 1 - samples[index].Rate / top
            }
        }
        return MiningReport{... result, Samples: samples, Top: top}
    }
}
