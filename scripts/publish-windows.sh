#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-$root/artifacts/win-x64}
sdk=${XWIN_CACHE:-$HOME/scratch/xwin}/splat
[[ -f "$sdk/crt/lib/x86_64/libcmt.lib" ]] || { printf 'Missing xwin CRT and SDK: %s\n' "$sdk" >&2; exit 1; }
ln -sf synchronization.lib "$sdk/sdk/lib/um/x86_64/Synchronization.lib"
export LIB="$sdk/crt/lib/x86_64;$sdk/sdk/lib/ucrt/x86_64;$sdk/sdk/lib/um/x86_64"
export INCLUDE="$sdk/crt/include;$sdk/sdk/include/ucrt;$sdk/sdk/include/shared;$sdk/sdk/include/um"
"${DOTNET:-dotnet}" publish "$root/src/Gyroid/Gyroid.gsproj" -c Release -r win-x64 -m:1 -nr:false -p:NuGetLockFilePath="$root/src/Gyroid/packages.win-x64.lock.json" -p:RestoreLockedMode=true -warnaserror -p:DisableUnsupportedError=true -p:IlcUseEnvironmentalTools=true -p:CppLinker=lld-link -p:NativeDebugSymbols=false -p:UseSharedCompilation=false -o "$out"
rm -f -- "$out/"*.pdb "$out/"*.xml "$out/"*.dbg
[[ -f "$out/Gyroid.exe" && -f "$out/libsodium.dll" ]]
