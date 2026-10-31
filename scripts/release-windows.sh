#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
version=$(python3 -c 'import xml.etree.ElementTree as E; print(E.parse("src/Gyroid/Gyroid.gsproj").findtext("PropertyGroup/Version"))')
output="$(pwd)/artifacts/release"
mkdir -p "$output"
work=$(mktemp -d "${RUNNER_TEMP:-$output}/gyroid-windows.XXXXXX")
trap 'WINEPREFIX="$work/wine" wineserver -k 2>/dev/null || true; rm -rf "$work"' EXIT
name="gyroid-$version-win-x64"
bundle="$work/$name"
bash scripts/publish-windows.sh "$bundle"
cp LICENSE "$bundle/LICENSE"
cp src/Gyroid/assets/fonts/OFL.txt "$bundle/OFL.txt"
mkdir -p "$bundle/licenses/oasst1"
cp src/Gyroid/assets/oasst1/LICENSE src/Gyroid/assets/oasst1/NOTICE "$bundle/licenses/oasst1/"
python3 - "$work" "$name" "$output/$name.zip" <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
work, name, archive = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
binary = (work / name / "Gyroid.exe").read_bytes()
for asset in ("gyroid.png", "gyroid-tray.rgba", "checkpoints-mainnet.dat", "fonts/JetBrainsMono-Regular.ttf", "fonts/JetBrainsMono-Bold.ttf", "oasst1/text-model.bin"):
    assert Path("src/Gyroid/assets", asset).read_bytes() in binary, f"Missing embedded asset: {asset}"
assert b"Gyroid.Background.goo-effect" in binary, "Missing embedded shader"
with ZipFile(archive, "w", ZIP_DEFLATED) as package:
    for path in sorted((work / name).rglob("*")):
        if path.is_file():
            assert path.suffix not in (".pdb", ".xml", ".dbg"), path
            package.write(path, path.relative_to(work))
with ZipFile(archive) as package:
    package.extractall(work / "extracted")
    print("\n".join(package.namelist()))
print("Embedded assets: verified")
PY
command -v wine >/dev/null
export WINEPREFIX="$work/wine" WINEARCH=win64 WINEDEBUG=-all DISPLAY='' WAYLAND_DISPLAY=''
extracted="$work/extracted/$name"
actual=$(cd "$extracted" && timeout 120 wine ./Gyroid.exe --version | tr -d '\r')
[[ "$actual" == "Gyroid $version" ]]
printf '%s\n' "$actual"
(cd "$extracted" && timeout 120 wine ./Gyroid.exe --help)
wc -c "$output/$name.zip" "$extracted/Gyroid.exe" "$extracted/libsodium.dll"
sha256sum "$output/$name.zip"
