#!/usr/bin/env bash
set -euo pipefail
root="${1:-${RUNNER_TEMP:?Set RUNNER_TEMP or pass an installation directory}}"
mkdir -p "$root/slang" "$root/vulkan-sdk/bin"
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
echo "45cb90cbc77a92012b5073aa2af5ef3676740c4574f6e4072b3e8f16fec3708d  $root/vulkan-sdk/bin/spirv-val" | sha256sum -c -
printf 'SLANG_SDK=%s/slang\nVULKAN_SDK=%s/vulkan-sdk\n' "$root" "$root" >> "${GITHUB_ENV:?Set GITHUB_ENV to the environment output file}"
