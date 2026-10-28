package Gyroid.Node

import Gyroid.Model
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.IO
import System.Runtime.InteropServices
import System.Text

@DllImport("iphlpapi.dll", EntryPoint: "GetExtendedTcpTable")
func WalletTcpTable(table IntPtr, ref size int32, order bool, family int32, kind int32, reserved uint32) uint32;

@DllImport("kernel32.dll", EntryPoint: "OpenProcess", SetLastError: true)
func OpenWalletProcess(access uint32, inherit bool, pid int32) IntPtr;

@DllImport("kernel32.dll", EntryPoint: "QueryFullProcessImageNameW", CharSet: CharSet.Unicode, SetLastError: true)
func WalletProcessPath(process IntPtr, flags uint32, path IntPtr, ref size int32) bool;

@DllImport("kernel32.dll", EntryPoint: "CloseHandle")
func CloseWalletHandle(handle IntPtr) bool;

@DllImport("libproc", EntryPoint: "proc_pidpath")
func WalletMacProcessPath(pid int32, path[]uint8, size uint32) int32;

@DllImport("ntdll.dll", EntryPoint: "NtQueryInformationProcess")
func WalletProcessInformation(process IntPtr, kind uint32, buffer IntPtr, size int32, out length int32) int32;

@DllImport("shell32.dll", EntryPoint: "CommandLineToArgvW", CharSet: CharSet.Unicode)
func WalletCommandArguments(command string, out count int32) IntPtr;

@DllImport("kernel32.dll", EntryPoint: "LocalFree")
func FreeWalletMemory(memory IntPtr) IntPtr;

class CoreProcess {
    shared {
        func Arguments(pid int32)[]string {
            if OperatingSystem.IsLinux() {
                return File.ReadAllText("/proc/" + pid.ToString() + "/cmdline").Split('\0')
            }
            let process = OpenWalletProcess(4096, false, pid)
            let buffer = Marshal.AllocHGlobal(65536)
            try {
                if process == IntPtr.Zero || WalletProcessInformation(process, 60, buffer, 65536, out _) != 0 {
                    throw WalletException("Core process arguments could not be verified")
                }
                let command = Marshal.PtrToStringUni(
                    Marshal.ReadIntPtr(buffer, 8),
                    int32(uint16(Marshal.ReadInt16(buffer))) / 2
                ) ??
                    throw WalletException("Core process arguments could not be verified")
                let arguments = WalletCommandArguments(command, out let count)
                if arguments == IntPtr.Zero {
                    throw WalletException("Core process arguments could not be verified")
                }
                try {
                    let values = [count]string
                    for index in 0 ... count {
                        values[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(arguments, index * IntPtr.Size)) ?? ""
                    }
                    return values
                } finally {
                    FreeWalletMemory(arguments)
                }
            } finally {
                Marshal.FreeHGlobal(buffer)
                CloseWalletHandle(process)
            }
        }

        func VerifyNetwork(pid int32, network string) {
            if OperatingSystem.IsLinux() || OperatingSystem.IsWindows() {
                let arguments = Arguments(pid)
                var testnet = false
                for argument in arguments {
                    if argument == "--testnet" ||
                        argument == "-testnet" ||
                        argument == "--testnet=true" ||
                        argument == "-testnet=true" {
                        testnet = true
                    }
                }
                if testnet != (network == "testnet") {
                    throw WalletException("Running core network does not match the configured network")
                }
            }
        }

        func Listener(endpoint Uri) int32 {
            try {
                let pids = HashSet[int32]()
                if OperatingSystem.IsLinux() {
                    let inodes = HashSet[string]()
                    for table in[]string{"/proc/net/tcp", "/proc/net/tcp6"} {
                        if !File.Exists(table) {
                            continue
                        }
                        for line in File.ReadLines(table) {
                            let fields = line.Split(default([]char), StringSplitOptions.RemoveEmptyEntries)
                            if fields.Length < 10 || fields[3] != "0A" {
                                continue
                            }
                            let local = fields[1].Split(':')
                            if Convert.ToInt32(local[1], 16) != endpoint.Port {
                                continue
                            }
                            let address = local[0]
                            let expected = if endpoint.Host.Contains(':') {
                                "00000000000000000000000001000000"
                            } else {
                                "0100007F"
                            }
                            if address == expected ||
                                address == "00000000" ||
                                address == "00000000000000000000000000000000" {
                                inodes.Add(fields[9])
                            }
                        }
                    }
                    for directory in Directory.EnumerateDirectories("/proc") {
                        if !int32.TryParse(Path.GetFileName(directory), out let pid) {
                            continue
                        }
                        try {
                            for descriptor in Directory.EnumerateFiles(Path.Combine(directory, "fd")) {
                                let target = FileInfo(descriptor).LinkTarget ?? ""
                                if target.StartsWith("socket:[", StringComparison.Ordinal) && target.EndsWith(
                                    "]",
                                    StringComparison.Ordinal
                                ) &&
                                    inodes.Contains(target.Substring(8, target.Length - 9)) {
                                    pids.Add(pid)
                                }
                            }
                        } catch (error IOException) { } catch (error UnauthorizedAccessException) { }
                    }
                } else if OperatingSystem.IsWindows() {
                    for family in[]int32{2, 23} {
                        var size int32 = 0
                        WalletTcpTable(IntPtr.Zero, ref size, false, family, 3, 0)
                        if size <= 0 || size > 16777216 {
                            continue
                        }
                        let table = Marshal.AllocHGlobal(size)
                        try {
                            if WalletTcpTable(table, ref size, false, family, 3, 0) != 0 {
                                continue
                            }
                            let stride = if family == 2 {
                                24
                            } else {
                                56
                            }
                            let count = Marshal.ReadInt32(table)
                            if count < 0 || int64(count) * int64(stride) + 4 > int64(size) {
                                continue
                            }
                            for index in 0 ... count {
                                let row = IntPtr.Add(table, 4 + index * stride)
                                let offset = if family == 2 {
                                    8
                                } else {
                                    20
                                }
                                let port = int32(Marshal.ReadByte(row, offset)) * 256 +
                                    int32(Marshal.ReadByte(row, offset + 1))
                                if port == endpoint.Port {
                                    pids.Add(Marshal.ReadInt32(row, stride - 4))
                                }
                            }
                        } finally {
                            Marshal.FreeHGlobal(table)
                        }
                    }
                } else if OperatingSystem.IsMacOS() {
                    let start = ProcessStartInfo{
                        FileName: "/usr/sbin/lsof",
                        UseShellExecute: false,
                        CreateNoWindow: true,
                        RedirectStandardOutput: true,
                        RedirectStandardError: true
                    }
                    for argument in[]string{"-nP", "-iTCP:" + endpoint.Port.ToString(), "-sTCP:LISTEN", "-Fp"} {
                        start.ArgumentList.Add(argument)
                    }
                    using let process = Process.Start(start) ??
                        throw WalletException("API listener identity could not be verified")
                    if !process.WaitForExit(2000) {
                        process.Kill()
                        throw WalletException("API listener identity could not be verified")
                    }
                    let text = process.StandardOutput.ReadToEnd()
                    if text.Length > 65536 {
                        throw WalletException("API listener identity could not be verified")
                    }
                    for line in text.Split('\n') {
                        if line.StartsWith("p", StringComparison.Ordinal) && int32.TryParse(
                            line.Substring(1),
                            out let pid
                        ) {
                            pids.Add(pid)
                        }
                    }
                }
                if pids.Count == 1 {
                    for pid in pids {
                        return pid
                    }
                }
            } catch (error Exception) {
                if error is WalletException {
                    throw error
                }
            }
            throw WalletException("API listener identity could not be verified")
        }

        func ProcessExecutable(pid int32) string {
            if OperatingSystem.IsLinux() {
                return "/proc/" + pid.ToString() + "/exe"
            }
            if OperatingSystem.IsWindows() {
                let process = OpenWalletProcess(4096, false, pid)
                if process == IntPtr.Zero {
                    throw WalletException("API listener identity could not be verified")
                }
                let path = Marshal.AllocHGlobal(65536)
                try {
                    var size int32 = 32768
                    if !WalletProcessPath(process, 0, path, ref size) {
                        throw WalletException("API listener identity could not be verified")
                    }
                    return Marshal.PtrToStringUni(path, size) ??
                        throw WalletException("API listener identity could not be verified")
                } finally {
                    Marshal.FreeHGlobal(path)
                    CloseWalletHandle(process)
                }
            }
            let buffer = [4096]uint8
            let length = WalletMacProcessPath(pid, buffer, uint32(buffer.Length))
            if length <= 0 {
                throw WalletException("API listener identity could not be verified")
            }
            return Encoding.UTF8.GetString(buffer, 0, length).TrimEnd('\0')
        }
    }
}
