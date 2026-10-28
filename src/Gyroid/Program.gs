package Gyroid

import Goo
import Goo.Widgets.Layout
import Gyroid.Cli
import Gyroid.Node
import Gyroid.Platform
import Gyroid.View
import Gyroid.Wallet
import System
import System.Globalization
import System.Runtime.InteropServices

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
    if arguments.Length > 1 && arguments[1] != "--width" && arguments[1] != "--height" && arguments[1] != "--scale" {
        Environment.ExitCode = Cli.Run(arguments)
        return
    }
    var index = 1
    while index < arguments.Length {
        let name = arguments[index]
        if (name != "--width" && name != "--height" && name != "--scale") ||
            index +
            1 >= arguments.Length ||
            !Double.TryParse(arguments[index + 1], NumberStyles.Float, CultureInfo.InvariantCulture, out let value) ||
            !Double.IsFinite(value) || value <= 0 || (name != "--scale" && value > int32.MaxValue) {
            Environment.ExitCode = Cli.Usage(Console.Error)
            return
        }
        index = index + 2
    }
    if OperatingSystem.IsWindows() && GetConsoleProcessList([2]uint32, 2) == 1 {
        FreeConsole()
    }
    Window.ConfigureApplication("Gyroid", "0.1.0", "dev.gyroid.wallet")
    var activationTarget WalletView? = nil
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
    using let wallet = WalletController()
    let view = WalletView(wallet)
    activationTarget = view
    let window = Window{
        Title: "Gyroid",
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
    window.Open()
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
