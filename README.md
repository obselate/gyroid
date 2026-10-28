# Gyroid

A Blocknet (BNT) wallet with a graphical interface and command-line tools for Linux x64 and Windows x64.

## Install

Download the archive for your platform and `SHA256SUMS` from [Releases](https://github.com/obselate/gyroid/releases).

```sh
version=0.1.2
sha256sum --ignore-missing --check SHA256SUMS
tar -xzf "gyroid-$version-linux-x64.tar.gz"
cd "gyroid-$version-linux-x64"
./Gyroid --version
./Gyroid
```

Use the glibc version listed in that release's notes or later. The release script measures the highest required `GLIBC_` symbol across all bundled ELF files. No .NET runtime is needed. The bundle includes libsodium, fonts, icons, checkpoints and shaders.

The Linux GUI needs a Vulkan loader and driver, and a native Wayland session (X11 and XWayland are not supported). Install the runtime packages on Ubuntu 24.04:

```sh
sudo apt install libvulkan1 mesa-vulkan-drivers libwayland-client0 libwayland-cursor0 libwayland-egl1 libxkbcommon0 libdbus-1-3 libglib2.0-0t64 libicu74 libssl3t64 ca-certificates
```

Use your GPU vendor's Vulkan driver instead of Mesa when needed. Tray support also uses `libayatana-appindicator3-1`.

For Windows x64, download `gyroid-<version>-win-x64.zip`. Tested on Windows 11 with a GPU vendor's Vulkan driver. In PowerShell, compare the hash below with the matching line in `SHA256SUMS` before extraction:

```powershell
$version = '0.1.2'
Get-FileHash "gyroid-$version-win-x64.zip" -Algorithm SHA256
Get-Content SHA256SUMS
Expand-Archive "gyroid-$version-win-x64.zip" .
& ".\gyroid-$version-win-x64\Gyroid.exe" --version
& ".\gyroid-$version-win-x64\Gyroid.exe"
```

Builds need the .NET SDK version in `global.json`, Linux NativeAOT prerequisites, and the pinned shader tools installed by `scripts/install-shader-tools.sh`.
Tagged releases must match the project version, use an annotated `v<version>` tag on `main`, and pass verification. The release workflow uploads both tested archives and one checksum file to a draft for review.

## Build and run

From a clean clone:

```sh
dotnet build src/Gyroid/Gyroid.gsproj -c Release
dotnet run --project src/Gyroid/Gyroid.gsproj -c Release --no-build
```

Run `bash scripts/verify.sh` to check the source and build.

Run `bash scripts/verify-testnet.sh <path to Gyroid>` before a release to send funds between two isolated testnet nodes. Mining the funds takes about 17 minutes. Set `GYROID_TESTNET_SNAPSHOT_OUT` to save the funded chain and `GYROID_TESTNET_SNAPSHOT_IN` to reuse it.

## Links

[License](LICENSE)
