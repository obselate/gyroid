package Gyroid.Services

import Microsoft.Win32
import System
import System.ComponentModel
import System.Diagnostics
import System.IO
import System.Security

class PaymentLinkRegistration {
    shared {
        func Register() {
            guard let executable = Environment.ProcessPath else {
                return
            }
            try {
                if OperatingSystem.IsLinux() {
                    let data = Environment.GetEnvironmentVariable("XDG_DATA_HOME")
                    let applications = Path.Combine(
                        String.IsNullOrEmpty(data) ? Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                            ".local",
                            "share"
                        ): data,
                        "applications"
                    )
                    let entry = Path.Combine(applications, "dev.gyroid.wallet.desktop")
                    let escaped = executable
                        .Replace("\\", "\\\\")
                        .Replace("\"", "\\\"")
                        .Replace("`", "\\`")
                        .Replace("$", "\\$")
                        .Replace("%", "%%")
                    let content = "[Desktop Entry]\nType=Application\nName=Gyroid\nExec=\"" +
                        escaped +
                        "\" %u\nTerminal=false\nStartupWMClass=dev.gyroid.wallet\nCategories=Finance;\nMimeType=x-scheme-handler/blocknet;\n"
                    if !File.Exists(entry) || File.ReadAllText(entry) != content {
                        Directory.CreateDirectory(applications)
                        File.WriteAllText(entry, content)
                        Run("update-desktop-database", []string{applications})
                    }
                    let handler = Run("xdg-mime", []string{"query", "default", "x-scheme-handler/blocknet"})
                    if handler != nil && (handler.Length == 0 || handler == "dev.gyroid.wallet.desktop") {
                        Run("xdg-mime", []string{"default", "dev.gyroid.wallet.desktop", "x-scheme-handler/blocknet"})
                    }
                } else if OperatingSystem.IsWindows() {
                    using let existing = Registry.CurrentUser.OpenSubKey("Software\\Classes\\blocknet")
                    if existing != nil {
                        using let command = existing.OpenSubKey("shell\\open\\command")
                        let value = command?.GetValue("") as string ?? ""
                        if value == "\"" + executable + "\" \"%1\"" {
                            return
                        }
                        let end = value.StartsWith("\"", StringComparison.Ordinal) ? value.IndexOf(
                            '"',
                            1
                        ): value.IndexOf(' ')
                        let path = value.StartsWith("\"", StringComparison.Ordinal) && end > 0 ? value.Substring(
                            1,
                            end - 1
                        ): end > 0 ? value.Substring(0, end): value
                        if !String.Equals(Path.GetFileName(path), "Gyroid.exe", StringComparison.OrdinalIgnoreCase) {
                            return
                        }
                    }
                    using let scheme = Registry.CurrentUser.CreateSubKey("Software\\Classes\\blocknet")
                    scheme.SetValue("", "URL:Blocknet")
                    scheme.SetValue("URL Protocol", "")
                    using let icon = scheme.CreateSubKey("DefaultIcon")
                    icon.SetValue("", "\"" + executable + "\",0")
                    using let command = scheme.CreateSubKey("shell\\open\\command")
                    command.SetValue("", "\"" + executable + "\" \"%1\"")
                }
            } catch (error IOException) {
                Console.Error.WriteLine("Could not register the Blocknet URL handler: " + error.GetType().Name)
            } catch (error UnauthorizedAccessException) {
                Console.Error.WriteLine("Could not register the Blocknet URL handler: " + error.GetType().Name)
            } catch (error SecurityException) {
                Console.Error.WriteLine("Could not register the Blocknet URL handler: " + error.GetType().Name)
            }
        }

        private func Run(name string, arguments[]string) string? {
            try {
                let start = ProcessStartInfo{
                    FileName: name,
                    UseShellExecute: false,
                    CreateNoWindow: true,
                    RedirectStandardOutput: true,
                    RedirectStandardError: true
                }
                for argument in arguments {
                    start.ArgumentList.Add(argument)
                }
                using let process = Process.Start(start)
                if process == nil {
                    return nil
                }
                let output = process.StandardOutput.ReadToEndAsync()
                let errors = process.StandardError.ReadToEndAsync()
                if !process.WaitForExit(3000) {
                    process.Kill(true)
                    process.WaitForExit()
                    return nil
                }
                errors.GetAwaiter().GetResult()
                return process.ExitCode == 0 ? output.GetAwaiter().GetResult().Trim(): nil
            } catch (error Win32Exception) {
                return nil
            }
        }
    }
}
