package Gyroid.Services

import System
import System.Collections.Generic
import System.Globalization
import System.IO
import System.Net.Http
import System.Text
import System.Threading
import System.Threading.Tasks

class Checkpoints {
    shared {
        async func FetchAsync(
            progress Action[int64, int64],
            cancellation CancellationToken,
            ct CancellationToken
        )[]?uint8 {
            try {
                using let http = HttpClient(SocketsHttpHandler{AllowAutoRedirect: false, UseProxy: false})
                using let response = await http.GetAsync(
                    "https://longhornpool.net/checkpoints.dat",
                    HttpCompletionOption.ResponseHeadersRead,
                    ct
                )
                if int32(response.StatusCode) != 200 {
                    return nil
                }
                let length = response.Content.Headers.ContentLength ?? 0
                if length > 1048576 {
                    return nil
                }
                progress.Invoke(0, length)
                using let input = await response.Content.ReadAsStreamAsync(ct)
                using let output = MemoryStream()
                let buffer = [8192]uint8
                while true {
                    let count = await input.ReadAsync(buffer, 0, buffer.Length, ct)
                    if count == 0 {
                        break
                    }
                    if output.Length + count > 1048576 {
                        return nil
                    }
                    output.Write(buffer, 0, count)
                    progress.Invoke(output.Length, length)
                }
                return output.ToArray()
            } catch (error OperationCanceledException) {
                cancellation.ThrowIfCancellationRequested()
                return nil
            } catch (error HttpRequestException) {
                return nil
            } catch (error IOException) {
                return nil
            }
        }

        func Parse(contents[]?uint8) Dictionary[uint64, string] {
            let entries = Dictionary[uint64, string]()
            if contents == nil {
                return entries
            }
            let text = Encoding.UTF8.GetString(contents)
            var offset = 0
            while offset < text.Length {
                let end = text.IndexOf('\n', offset)
                let count = if end < 0 {
                    text.Length - offset
                } else {
                    end - offset
                }
                let line = text.Substring(offset, count).Trim()
                offset = offset + count + 1
                if line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal) {
                    continue
                }
                let separator = line.IndexOf(':')
                if separator < 0 || !uint64.TryParse(
                    line.Substring(0, separator).Trim(),
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out let height
                ) ||
                    height == 0 {
                    continue
                }
                var hash = line.Substring(separator + 1).Trim()
                if hash.StartsWith("0x", StringComparison.Ordinal) {
                    hash = hash.Substring(2)
                }
                if hash.Length != 64 {
                    continue
                }
                var valid = true
                for character in hash {
                    if !char.IsAsciiHexDigit(character) {
                        valid = false
                        break
                    }
                }
                if valid {
                    entries[height] = hash
                }
            }
            return entries
        }

        func Extends(baseline Dictionary[uint64, string], candidate Dictionary[uint64, string]) bool {
            for entry in baseline {
                if !candidate.TryGetValue(entry.Key, out let hash) || !string.Equals(
                    entry.Value,
                    hash,
                    StringComparison.OrdinalIgnoreCase
                ) {
                    return false
                }
            }
            return true
        }

        func Height(entries Dictionary[uint64, string]) uint64 {
            var height uint64 = 0
            for entry in entries {
                height = Math.Max(height, entry.Key)
            }
            return height
        }

        func Select(baseline[]uint8, downloaded[]?uint8)[]uint8 {
            let trusted = Parse(baseline)
            let fetched = Parse(downloaded)
            if Height(fetched) >= Height(trusted) && Extends(trusted, fetched) {
                return downloaded ?? baseline
            }
            return baseline
        }
    }
}
