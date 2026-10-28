# Gyroid

A Blocknet (BNT) wallet with a graphical interface and command-line tools. Supported platform: Linux x64.

## Install

Download `gyroid-<version>-linux-x64.tar.gz` and `SHA256SUMS` from [Releases](https://github.com/obselate/gyroid/releases). Only Linux x64 is released.

```sh
version=0.1.0
sha256sum --check SHA256SUMS
tar -xzf "gyroid-$version-linux-x64.tar.gz"
cd "gyroid-$version-linux-x64"
./Gyroid --version
./Gyroid
```

Use the glibc version listed in that release's notes or later. The release script measures the highest required `GLIBC_` symbol across all bundled ELF files. No .NET runtime is needed. The bundle includes libsodium, fonts, icons, checkpoints and shaders.

The GUI needs a Vulkan loader and driver, and a Wayland or X11 desktop. Install the runtime packages on Ubuntu 24.04:

```sh
sudo apt install libvulkan1 mesa-vulkan-drivers libx11-6 libwayland-client0 libwayland-cursor0 libwayland-egl1 libxkbcommon0 libdbus-1-3 libicu74 libssl3t64 ca-certificates
```

Use your GPU vendor's Vulkan driver instead of Mesa when needed. Tray support also uses `libayatana-appindicator3-1`.

Builds need the .NET SDK version in `global.json`, Linux NativeAOT prerequisites, and the pinned shader tools installed by `scripts/install-shader-tools.sh`.
Tagged releases must match the project version, use an annotated `v<version>` tag on `main`, and pass verification. The release workflow uploads the tested archive and checksums to a draft for review.

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
