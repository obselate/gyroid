package Gyroid.Services

import Microsoft.Win32.SafeHandles
import System
import System.IO
import System.Runtime.InteropServices
import System.Security.AccessControl
import System.Security.Principal
import System.Text
import System.Threading.Tasks

@DllImport("libc", EntryPoint: "open", SetLastError: true)
func OpenWalletFile(path string, flags int32) int32;

@DllImport("libc", EntryPoint: "fsync", SetLastError: true)
func FlushWalletDirectory(fd int32) int32;

@DllImport("libc", EntryPoint: "fstat", SetLastError: true)
func StatWalletFile(fd int32, buffer IntPtr) int32;

@DllImport("libc", EntryPoint: "fstat$$INODE64", SetLastError: true)
func StatWalletFileInode64(fd int32, buffer IntPtr) int32;

@DllImport("libc", EntryPoint: "geteuid")
func WalletUserId() uint32;

@DllImport("kernel32.dll", EntryPoint: "CreateFileW", CharSet: CharSet.Unicode, SetLastError: true)
func OpenWindowsWalletFile(
    path string,
    access uint32,
    share uint32,
    security IntPtr,
    disposition uint32,
    flags uint32,
    template IntPtr
) SafeFileHandle;

class PrivateFiles {
    shared {
        async func WriteAtomic(path string, write Func[FileStream, Task], overwrite bool, flushDirectory bool) {
            let temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp"
            try {
                using let stream = CreatePrivate(temporary)
                await write(stream)
                stream.Flush(true)
                stream.Dispose()
                File.Move(temporary, path, overwrite)
                if flushDirectory {
                    FlushDirectory(Path.GetDirectoryName(path) ?? "")
                }
            } finally {
                File.Delete(temporary)
            }
        }

        func ProtectDirectory(path string) {
            if OperatingSystem.IsWindows() {
                using let identity = WindowsIdentity.GetCurrent()
                let owner = identity.User ?? throw WalletException("File ownership could not be verified")
                let security = DirectorySecurity()
                security.SetOwner(owner)
                security.SetAccessRuleProtection(true, false)
                security.AddAccessRule(
                    FileSystemAccessRule(
                        owner,
                        FileSystemRights.FullControl,
                        InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                        PropagationFlags.None,
                        AccessControlType.Allow
                    )
                )
                FileSystemAclExtensions.SetAccessControl(DirectoryInfo(path), security)
            }
        }

        func FlushDirectory(path string) {
            if OperatingSystem.IsWindows() {
                return
            }
            let fd = OpenWalletFile(path, 0)
            using let handle = SafeFileHandle(IntPtr(fd), true)
            if fd < 0 || FlushWalletDirectory(fd) != 0 {
                throw WalletException("Pending send file could not be saved durably")
            }
        }

        func OpenRead(path string, privateFile bool = false) FileStream {
            var handle SafeFileHandle
            if OperatingSystem.IsWindows() {
                handle = OpenWindowsWalletFile(path, 2147483648, 1, IntPtr.Zero, 3, 35651584, IntPtr.Zero)
                if handle.IsInvalid {
                    let error = Marshal.GetLastPInvokeError()
                    handle.Dispose()
                    throw WalletException(
                        switch error {
                            case 2, 3: "File does not exist"
                            case 5: "File access was denied"
                            default: "File could not be opened"
                        }
                    )
                }
                let attributes = File.GetAttributes(handle)
                if (
                    attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory | FileAttributes.Device)
                ) != 0 {
                    handle.Dispose()
                    throw WalletException("File must be a regular no-follow file")
                }
                let stream = FileStream(handle, FileAccess.Read)
                try {
                    let security = FileSystemAclExtensions.GetAccessControl(stream)
                    using let identity = WindowsIdentity.GetCurrent()
                    let owner = identity.User ?? throw WalletException("File ownership could not be verified")
                    let tokenOwner = identity.Owner ?? owner
                    let fileOwner = security.GetOwner(typeof(SecurityIdentifier))
                    if !owner.Equals(fileOwner) && !tokenOwner.Equals(fileOwner) {
                        throw WalletException("File ownership or permissions are not private")
                    }
                    if privateFile {
                        for entry in security.GetAccessRules(true, true, typeof(SecurityIdentifier)) {
                            let rule = entry as FileSystemAccessRule
                            if rule != nil &&
                                rule.AccessControlType == AccessControlType.Allow &&
                                !rule
                                .IdentityReference
                                .Equals(owner) && !rule.IdentityReference.Equals(
                                SecurityIdentifier(WellKnownSidType.LocalSystemSid, nil)
                            ) &&
                                !rule
                                .IdentityReference
                                .Equals(SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, nil)) {
                                throw WalletException("File ownership or permissions are not private")
                            }
                        }
                    }
                    return stream
                } catch (error Exception) {
                    stream.Dispose()
                    throw error
                }
            } else {
                let flags = if OperatingSystem.IsMacOS() {
                    260
                } else if RuntimeInformation.ProcessArchitecture == Architecture.Arm64 {
                    34816
                } else {
                    133120
                }
                let fd = OpenWalletFile(path, flags)
                if fd < 0 {
                    let error = Marshal.GetLastPInvokeError()
                    throw WalletException(
                        switch error {
                            case 2, 20: "File does not exist"
                            case 1, 13: "File access was denied"
                            default: error == (OperatingSystem.IsMacOS() ? 62: 40) ?
                            "File must be a regular no-follow file": "File could not be opened"
                        }
                    )
                }
                handle = SafeFileHandle(IntPtr(fd), true)
                let status = Marshal.AllocHGlobal(256)
                try {
                    let mac = OperatingSystem.IsMacOS()
                    let arm = RuntimeInformation.ProcessArchitecture == Architecture.Arm64
                    let result = if mac && !arm {
                        StatWalletFileInode64(fd, status)
                    } else {
                        StatWalletFile(fd, status)
                    }
                    if result != 0 {
                        throw WalletException("File could not be inspected")
                    }
                    let mode = if mac {
                        int32(Marshal.ReadInt16(status, 4))
                    } else {
                        Marshal.ReadInt32(
                            status,
                            if arm {
                                16
                            } else {
                                24
                            }
                        )
                    }
                    let uid = uint32(
                        Marshal.ReadInt32(
                            status,
                            if mac {
                                16
                            } else if arm {
                                24
                            } else {
                                28
                            }
                        )
                    )
                    if (mode & 61440) != 32768 || uid != WalletUserId() || (privateFile && (mode & 63) != 0) {
                        throw WalletException("File ownership or permissions are not private")
                    }
                } catch (error Exception) {
                    handle.Dispose()
                    throw error
                } finally {
                    Marshal.FreeHGlobal(status)
                }
            }
            return FileStream(handle, FileAccess.Read)
        }

        func ReadText(path string, maximum int32, privateFile bool = false) string {
            using let stream = OpenRead(path, privateFile)
            if stream.Length > maximum {
                throw WalletException("File exceeds the supported size")
            }
            let buffer = [maximum + 1]uint8
            try {
                var count int32 = 0
                while count < buffer.Length {
                    let read = stream.Read(buffer, count, buffer.Length - count)
                    if read == 0 {
                        break
                    }
                    count = count + read
                }
                if count > maximum {
                    throw WalletException("File exceeds the supported size")
                }
                return UTF8Encoding(false, true).GetString(buffer, 0, count)
            } finally {
                Array.Clear(buffer)
            }
        }

        func CreatePrivate(path string) FileStream {
            if OperatingSystem.IsWindows() {
                using let identity = WindowsIdentity.GetCurrent()
                let owner = identity.User ?? throw WalletException("File ownership could not be verified")
                let security = FileSecurity()
                security.SetOwner(owner)
                security.SetAccessRuleProtection(true, false)
                security.AddAccessRule(
                    FileSystemAccessRule(owner, FileSystemRights.FullControl, AccessControlType.Allow)
                )
                return FileSystemAclExtensions.Create(
                    FileInfo(path),
                    FileMode.CreateNew,
                    FileSystemRights.Read | FileSystemRights.Write,
                    FileShare.None,
                    4096,
                    FileOptions.None,
                    security
                )
            }
            let options = FileStreamOptions{Mode: FileMode.CreateNew, Access: FileAccess.Write, Share: FileShare.None}
            if !OperatingSystem.IsWindows() {
                options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
            }
            return FileStream(path, options)
        }

        func Cookie(path string) string {
            let token = ReadText(path, 1024, true).Trim()
            if token.Length != 64 {
                throw WalletException("API cookie must contain exactly 64 hexadecimal characters")
            }
            for character in token {
                if !char.IsAsciiHexDigit(character) {
                    throw WalletException("API cookie must contain exactly 64 hexadecimal characters")
                }
            }
            return token
        }
    }
}
