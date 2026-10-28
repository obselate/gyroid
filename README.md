# Gyroid

A Blocknet (BNT) wallet for Linux x64 and Windows x64. One binary has the graphical interface and the command-line tools.

## Install

Download the release for your platform and `SHA256SUMS` from [Releases](https://github.com/obselate/gyroid/releases). Check the archive against `SHA256SUMS` before you run it. Linux needs Vulkan and a Wayland session.

```sh
sudo apt install libvulkan1 mesa-vulkan-drivers libwayland-client0 libwayland-cursor0 libwayland-egl1 libxkbcommon0 libdbus-1-3 libglib2.0-0t64 libicu74 libssl3t64 ca-certificates libayatana-appindicator3-1
version=0.1.2
curl -fLO "https://github.com/obselate/gyroid/releases/download/v$version/gyroid-$version-linux-x64.tar.gz"
curl -fLO "https://github.com/obselate/gyroid/releases/download/v$version/SHA256SUMS"
sha256sum --ignore-missing --check SHA256SUMS
tar -xzf "gyroid-$version-linux-x64.tar.gz"
"./gyroid-$version-linux-x64/Gyroid"
```

On Windows, download `gyroid-<version>-win-x64.zip`, compare `Get-FileHash` with `SHA256SUMS`, extract it and run `Gyroid.exe`.

On first start, Gyroid downloads the Blocknet core and checks its SHA-256 before it runs it.

## Build from source

```sh
git clone https://github.com/obselate/gyroid && cd gyroid
curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --jsonfile global.json && export PATH="$HOME/.dotnet:$PATH"
GITHUB_ENV=artifacts/tools.env bash scripts/install-shader-tools.sh "$PWD/artifacts/tools" && export $(cat artifacts/tools.env)
dotnet run --project src/Gyroid/Gyroid.gsproj -c Release
```

## Links

- [Blocknet](https://github.com/blocknetprivacy)
- [MIT License](LICENSE)
