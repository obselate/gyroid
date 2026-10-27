# Gyroid

A Blocknet (BNT) wallet with a graphical interface and command-line tools. Supported platform: Linux x64.

## Install

Install the .NET SDK version in `global.json` and the Linux NativeAOT build prerequisites.

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
