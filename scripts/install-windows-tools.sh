#!/usr/bin/env bash
set -euo pipefail
root="${1:-${RUNNER_TEMP:?Set RUNNER_TEMP or pass an installation directory}}"
if [[ ! -f "$root/xwin/splat/crt/lib/x86_64/libcmt.lib" ]]; then
  mkdir -p "$root/xwin/tool"
  curl -fsSLo "$root/xwin.tar.gz" https://github.com/Jake-Shadle/xwin/releases/download/0.10.0/xwin-0.10.0-x86_64-unknown-linux-musl.tar.gz
  echo "d870eb4b2f390878af6da1ccd3cf321d22fcb72720984853b4be732ae597fc88  $root/xwin.tar.gz" | sha256sum -c -
  tar -xzf "$root/xwin.tar.gz" -C "$root/xwin/tool" --strip-components=1
  rm "$root/xwin.tar.gz"
  "$root/xwin/tool/xwin" --accept-license --cache-dir "$root/xwin/cache" --sdk-version 10.0.26100 --crt-version 14.44.17.14 splat --output "$root/xwin/splat"
fi
printf 'XWIN_CACHE=%s/xwin\n' "$root" >> "${GITHUB_ENV:?Set GITHUB_ENV to the environment output file}"
