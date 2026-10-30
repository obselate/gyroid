package Gyroid

import Goo
import Goo.Widgets.Layout
import Gyroid.Cli
import Gyroid.Interface
import Gyroid.Node
import Gyroid.Platform
import Gyroid.Wallet
import System
import System.Globalization
import System.Reflection
import System.Runtime.InteropServices
import System.Threading

@DllImport("kernel32.dll")
func GetConsoleProcessList(processes[]uint32, count uint32) uint32;

@DllImport("kernel32.dll")
func FreeConsole() int32;

func Main() {
    let arguments = Environment.GetCommandLineArgs()
    if OperatingSystem.IsWindows() && arguments.Length >= 3 && arguments[1] == "--owned-core" {
        Environment.ExitCode = OwnedCoreWrapper.RunWindows(arguments)
        return
    }
    if arguments.Length == 2 && arguments[1] == "--lock-wallet" {
        Environment.ExitCode = WalletLockScheduler.Run()
        return
    }
    if arguments.Length > 1 && arguments[1] != "--width" && arguments[1] != "--height" && arguments[1] != "--scale" {
        using let stopped = ManualResetEventSlim(false)
        var wallet WalletSession? = nil
        let nodeStart = arguments.Length == 3 && arguments[1] == "node" && arguments[2] == "start"
        let exit EventHandler = (sender, event) -> wallet?.Dispose()
        let cancel ConsoleCancelEventHandler = (sender, event) -> {
            if nodeStart {
                event.Cancel = true
                stopped.Set()
            }
        }
        AppDomain.CurrentDomain.ProcessExit += exit
        Console.CancelKeyPress += cancel
        using let termination PosixSignalRegistration? = if OperatingSystem.IsWindows() {
            nil
        } else {
            PosixSignalRegistration.Create(
                PosixSignal.SIGTERM,
                signal -> {
                    if nodeStart {
                        signal.Cancel = true
                        stopped.Set()
                    } else {
                        wallet?.Dispose()
                    }
                }
            )
        }
        try {
            Environment.ExitCode = Cli.Run(arguments, stopped, value -> wallet = value)
        } finally {
            Console.CancelKeyPress -= cancel
            AppDomain.CurrentDomain.ProcessExit -= exit
        }
        return
    }
    var index = 1
    while index < arguments.Length {
        let name = arguments[index]
        if (name != "--width" && name != "--height" && name != "--scale") ||
            index +
            1 >= arguments.Length ||
            !Double.TryParse(arguments[index + 1], NumberStyles.Float, CultureInfo.InvariantCulture, out let value) ||
            !Double.IsFinite(value) ||
            value <= 0 ||
            (name == "--scale" ? value > float32.MaxValue: value > int32.MaxValue) {
            Console.Error.WriteLine("Invalid " + name + " value: number is outside the supported range")
            Environment.ExitCode = Cli.Usage(Console.Error)
            return
        }
        index = index + 2
    }
    if OperatingSystem.IsWindows() && GetConsoleProcessList([2]uint32, 2) == 1 {
        FreeConsole()
    }
    let version = Assembly.GetExecutingAssembly().GetCustomAttribute[AssemblyInformationalVersionAttribute]()
    Window.ConfigureApplication(
        "Gyroid",
        (version?.InformationalVersion ?? "unknown").Split('+')[0],
        "dev.gyroid.wallet"
    )
    var activationTarget App? = nil
    Window.ApplicationActivated += request -> {
        if !request.IsInitial {
            activationTarget?.Restore()
        }
    }
    let initial = ApplicationActivation{IsInitial: true}
    Window.InitializeApplicationActivation(initial)
    let instance = SingleInstance.AcquireAsync("dev.gyroid.wallet", initial).GetAwaiter().GetResult()
    if instance.Status != SingleInstanceStatus.Primary {
        Console.Error.WriteLine(instance.Status.ToString() + " " + instance.Error)
        return
    }
    using let lease = instance.Lease
    if lease == nil {
        throw InvalidOperationException("Application instance unavailable")
    }
    using let wallet = WalletSession()
    let view = App(wallet, Array.IndexOf(arguments, "--scale") >= 0)
    activationTarget = view
    let window = Window{
        Title: "Gyroid",
        AccessibilityAdapter: NativeAccessibilityAdapter(),
        Width: int32(Option(arguments, "--width", 1280)),
        Height: int32(Option(arguments, "--height", 800)),
        MinWidth: 960,
        MinHeight: 640,
        Resizable: true,
        ResizeBand: 6,
        Transparent: true,
        Background: Color.Transparent,
        IconPng: Resources.Resource("Gyroid.Icon.png"),
        Root: view
    }
    if Array.IndexOf(arguments, "--scale") >= 0 {
        window.UiScale = float32(Option(arguments, "--scale", 1))
    }
    WindowChrome.ReplaceTitlebar(window)
    view.Attach(window)
    window.OnClosing = () -> view.Closing()
    using let termination PosixSignalRegistration? = if OperatingSystem.IsWindows() {
        nil
    } else {
        PosixSignalRegistration.Create(
            PosixSignal.SIGTERM,
            signal -> {
                signal.Cancel = true
                window.Post(() -> view.Quit())
            }
        )
    }
    using let interrupt PosixSignalRegistration? = if OperatingSystem.IsWindows() {
        nil
    } else {
        PosixSignalRegistration.Create(
            PosixSignal.SIGINT,
            signal -> {
                signal.Cancel = true
                window.Post(() -> view.Quit())
            }
        )
    }
    window.Open()
    view.UpdateScale()
    view.Start()
    window.Run()
}

func Option(arguments[]string, name string, fallback float64) float64 {
    let index = Array.IndexOf(arguments, name)
    if index < 0 || index + 1 >= arguments.Length {
        return fallback
    }
    return Double.Parse(arguments[index + 1], CultureInfo.InvariantCulture)
}
