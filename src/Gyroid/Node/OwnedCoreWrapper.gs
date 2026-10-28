package Gyroid.Node

import Gyroid.Model
import System
import System.Diagnostics
import System.Globalization
import System.IO
import System.Runtime.InteropServices
import System.Threading.Tasks

@DllImport("kernel32.dll", EntryPoint: "AllocConsole")
func AllocateWalletConsole() bool;

@DllImport("kernel32.dll", EntryPoint: "FreeConsole")
func ReleaseWalletConsole() bool;

@DllImport("kernel32.dll", EntryPoint: "GetConsoleWindow")
func WalletConsoleWindow() IntPtr;

@DllImport("user32.dll", EntryPoint: "ShowWindow")
func ShowWalletConsole(window IntPtr, command int32) bool;

@UnmanagedFunctionPointer(CallingConvention.Winapi)
delegate WalletConsoleHandler(signal uint32) int32;

@DllImport("kernel32.dll", EntryPoint: "SetConsoleCtrlHandler")
func SetWalletConsoleHandler(handler WalletConsoleHandler, add bool) bool;

@DllImport("kernel32.dll", EntryPoint: "GenerateConsoleCtrlEvent")
func SignalWalletConsole(signal uint32, group uint32) bool;

class OwnedCoreWrapper {
    shared {
        func RunWindows(arguments[]string) int32 {
            using let input = Console.OpenStandardInput()
            let output = Console.Out
            ReleaseWalletConsole()
            if !AllocateWalletConsole() {
                throw WalletException("Could not allocate the owned core console")
            }
            ShowWalletConsole(WalletConsoleWindow(), 0)
            let handler WalletConsoleHandler = _ -> 1
            if !SetWalletConsoleHandler(handler, true) {
                throw WalletException("Could not register the owned core console handler")
            }
            let start = ProcessStartInfo{
                FileName: arguments[2],
                UseShellExecute: false,
                RedirectStandardOutput: true,
                RedirectStandardError: true,
                RedirectStandardInput: true
            }
            for index in 3 ... arguments.Length {
                start.ArgumentList.Add(arguments[index])
            }
            using let core = Process.Start(start) ??
                throw WalletException("Could not start the configured core executable")
            output.WriteLine(core.Id.ToString(CultureInfo.InvariantCulture))
            output.Flush()
            core.StandardInput.Close()
            core.StandardOutput.BaseStream.CopyToAsync(Stream.Null)
            core.StandardError.BaseStream.CopyToAsync(Stream.Null)
            let closed = input.ReadAsync([1]uint8, 0, 1)
            Task.WhenAny(closed, core.WaitForExitAsync()).GetAwaiter().GetResult()
            if !core.HasExited {
                SignalWalletConsole(1, 0)
                if !core.WaitForExit(5000) {
                    core.Kill(true)
                    core.WaitForExit(2000)
                }
            }
            GC.KeepAlive(handler)
            return core.ExitCode
        }
    }
}
