#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

dotnet tool restore
dotnet gsfmt --check src
dotnet restore src/Gyroid/Gyroid.gsproj --locked-mode
dotnet build src/Gyroid/Gyroid.gsproj -c Release --no-restore -warnaserror -m:1 -nr:false -p:UseSharedCompilation=false
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git diff --check
fi
