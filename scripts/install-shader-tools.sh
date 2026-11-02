#!/usr/bin/env bash
set -euo pipefail
root="${1:-${RUNNER_TEMP:?Set RUNNER_TEMP or pass an installation directory}}"
mkdir -p "$root/slang" "$root/vulkan-sdk/bin"
if [[ "$(uname -s)" == Darwin ]]; then
  curl -fsSLo "$root/slang.tar.gz" https://github.com/shader-slang/slang/releases/download/v2026.16/slang-2026.16-macos-aarch64.tar.gz
  echo "5d7edc2c91c38d1914c14a5a410f0fe517bce9a284395336715ba36a091e9d9e  $root/slang.tar.gz" | shasum -a 256 -c -
  tar -xzf "$root/slang.tar.gz" -C "$root/slang"
  rm "$root/slang.tar.gz"
  if [[ ! -x "$root/vulkan-sdk/bin/spirv-val" ]]; then
    work=$(mktemp -d "$root/spirv-tools.XXXXXX")
    trap 'rm -rf "$work"' EXIT
    curl -fsSLo "$work/tools.tar.gz" https://github.com/KhronosGroup/SPIRV-Tools/archive/9a49b0883b9b635689a85b5647dbfcb223268151.tar.gz
    curl -fsSLo "$work/headers.tar.gz" https://github.com/KhronosGroup/SPIRV-Headers/archive/29981f65241605e08b0ede4cfeb999fe3b723c6a.tar.gz
    echo "5cd1a935296c324e7bfa8f0e4c223742ac490d45d6af0577fa3c2cf7e1a7dd22  $work/tools.tar.gz" | shasum -a 256 -c -
    echo "232899f1ad4104fb5bc377b94596c7621575eee62ad9a9e8f929b63a7dd8a7ad  $work/headers.tar.gz" | shasum -a 256 -c -
    mkdir "$work/tools" "$work/headers"
    tar -xzf "$work/tools.tar.gz" -C "$work/tools" --strip-components=1
    tar -xzf "$work/headers.tar.gz" -C "$work/headers" --strip-components=1
    cmake -S "$work/tools" -B "$work/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DSPIRV_SKIP_TESTS=ON -DSPIRV-Headers_SOURCE_DIR="$work/headers"
    cmake --build "$work/build" --target spirv-val --parallel 3
    cp "$work/build/tools/spirv-val" "$root/vulkan-sdk/bin/"
  fi
  printf 'SLANG_SDK=%s/slang\nVULKAN_SDK=%s/vulkan-sdk\n' "$root" "$root" >> "${GITHUB_ENV:?Set GITHUB_ENV to the environment output file}"
  exit 0
fi
curl -fsSLo "$root/slang.tar.gz" https://github.com/shader-slang/slang/releases/download/v2026.16/slang-2026.16-linux-x86_64-glibc-2.27.tar.gz
echo "b9c5e195ce9a7124147d47febe78b7f8c59c96829add50b0938bd04b8056fb88  $root/slang.tar.gz" | sha256sum -c -
tar -xzf "$root/slang.tar.gz" -C "$root/slang"
rm "$root/slang.tar.gz"
if [[ ! -x "$root/vulkan-sdk/bin/spirv-val" ]]; then
  curl -fsSLo "$root/vulkan-sdk.tar.xz" https://sdk.lunarg.com/sdk/download/1.4.357.0/linux/vulkan_sdk.tar.xz
  echo "0f09bf6a0625e346bf004be70b92907e934a4c76606b323441b2baf3a5a0e66d  $root/vulkan-sdk.tar.xz" | sha256sum -c -
  tar -xJf "$root/vulkan-sdk.tar.xz" -C "$root/vulkan-sdk/bin" --strip-components=3 1.4.357.0/x86_64/bin/spirv-val
  rm "$root/vulkan-sdk.tar.xz"
fi
printf 'SLANG_SDK=%s/slang\nVULKAN_SDK=%s/vulkan-sdk\n' "$root" "$root" >> "${GITHUB_ENV:?Set GITHUB_ENV to the environment output file}"
