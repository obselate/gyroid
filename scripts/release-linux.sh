#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
version=$(python3 -c 'import xml.etree.ElementTree as E; print(E.parse("src/Gyroid/Gyroid.gsproj").findtext("PropertyGroup/Version"))')
if [[ -n "${RELEASE_TAG:-}" ]]; then
  [[ "$RELEASE_TAG" == "v$version" ]]
  [[ "$(git cat-file -t "refs/tags/$RELEASE_TAG")" == tag ]]
  [[ "$(git rev-parse "$RELEASE_TAG^{commit}")" == "$(git rev-parse HEAD)" ]]
  git merge-base --is-ancestor HEAD origin/main
  grep -qx '\*.gs linguist-language=C#' .gitattributes
fi
output="$(pwd)/artifacts/release"
mkdir -p "$output"
work=$(mktemp -d "$output/work.XXXXXX")
trap 'rm -rf "$work"' EXIT
name="gyroid-$version-linux-x64"
bundle="$work/$name"
dotnet publish src/Gyroid/Gyroid.gsproj -c Release -r linux-x64 -p:RestoreLockedMode=true -warnaserror -m:1 -nr:false -p:UseSharedCompilation=false -o "$bundle"
find "$bundle" -type f \( -name '*.dbg' -o -name '*.pdb' -o -name '*.xml' \) -delete
[[ -x "$bundle/Gyroid" && -f "$bundle/libsodium.so" ]]
cp LICENSE "$bundle/LICENSE"
cp src/Gyroid/assets/fonts/OFL.txt "$bundle/OFL.txt"
python3 - "$bundle/Gyroid" <<'PY'
from pathlib import Path
import sys
binary = Path(sys.argv[1]).read_bytes()
for name in ("gyroid.png", "gyroid-tray.rgba", "checkpoints-mainnet.dat", "fonts/JetBrainsMono-Regular.ttf", "fonts/JetBrainsMono-Bold.ttf"):
    assert Path("src/Gyroid/assets", name).read_bytes() in binary, f"Missing embedded asset: {name}"
assert b"Gyroid.Background.goo-effect" in binary, "Missing embedded shader"
print("Embedded assets: verified")
PY
tar -czf "$output/$name.tar.gz" -C "$work" "$name"
mkdir "$work/extracted" "$work/home"
tar -xzf "$output/$name.tar.gz" -C "$work/extracted"
extracted="$work/extracted/$name"
actual=$(cd "$extracted" && env -i HOME="$work/home" PATH=/usr/bin:/bin ./Gyroid --version)
[[ "$actual" == "Gyroid $version" ]]
printf '%s\n' "$actual"
(cd "$extracted" && env -i HOME="$work/home" PATH=/usr/bin:/bin ./Gyroid --help)
python3 - "$extracted" "$output/release-notes.md" <<'PY'
from pathlib import Path
import ctypes
import re
import subprocess
import sys
versions = set()
for path in Path(sys.argv[1]).rglob("*"):
    if not path.is_file():
        continue
    with path.open("rb") as stream:
        if stream.read(4) != b"\x7fELF":
            continue
    symbols = subprocess.check_output(["readelf", "--version-info", str(path)], text=True)
    versions.update(re.findall(r"\bGLIBC_(\d+(?:\.\d+)+)\b", symbols))
    result = subprocess.run(["ldd", "-r", str(path)], capture_output=True, text=True, check=True)
    print(f"Native dependencies: {path.name}\n{result.stdout}", end="")
    assert "not found" not in result.stdout + result.stderr, f"Missing dependency: {path.name}"
    assert "undefined symbol" not in result.stdout + result.stderr, f"Unresolved symbol: {path.name}"
assert ctypes.CDLL(str(Path(sys.argv[1]) / "libsodium.so")).sodium_init() >= 0
print("libsodium initialization: passed")
baseline = max(versions, key=lambda version: tuple(map(int, version.split("."))))
print(f"Linux x64 glibc baseline: {baseline}")
Path(sys.argv[2]).write_text(f"## Linux x64\n\nRequires glibc {baseline} or later. The GUI requires a Vulkan loader, a Vulkan driver, and a Wayland or X11 desktop. No .NET runtime is required.\n\nThe bundle includes libsodium and embedded fonts, icons, checkpoints, and shaders. SHA256SUMS covers the tested archive.\n")
PY
(cd "$output" && sha256sum "$name.tar.gz" > SHA256SUMS && sha256sum -c SHA256SUMS)
tar -tzvf "$output/$name.tar.gz"
wc -c "$output/$name.tar.gz" "$extracted/Gyroid" "$extracted/libsodium.so"
cat "$output/SHA256SUMS"
