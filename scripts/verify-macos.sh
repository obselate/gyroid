#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
output="$PWD/artifacts/macos-smoke"
mkdir -p "$output"
work=$(mktemp -d "$RUNNER_TEMP/gyroid-smoke.XXXXXX")
cleanup() {
  hdiutil detach "$work/mount" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
mkdir "$work/mount" "$work/Applications Test"
hdiutil attach artifacts/release/*.dmg -nobrowse -readonly -mountpoint "$work/mount"
ditto "$work/mount/Gyroid.app" "$work/Applications Test/Gyroid.app"
hdiutil detach "$work/mount"
codesign --verify --deep --strict --verbose=2 "$work/Applications Test/Gyroid.app" 2>&1 | tee "$output/signature.log"
clang -x c -o "$work/verify-layout" - <<'C'
#include <stddef.h>
#include <sys/stat.h>
#include <sys/proc_info.h>
_Static_assert(offsetof(struct stat, st_mode) == 4, "stat mode offset");
_Static_assert(offsetof(struct stat, st_uid) == 16, "stat uid offset");
_Static_assert(sizeof(struct proc_bsdshortinfo) == 64, "process info size");
_Static_assert(offsetof(struct proc_bsdshortinfo, pbsi_uid) == 36, "process uid offset");
_Static_assert(offsetof(struct proc_bsdshortinfo, pbsi_ruid) == 44, "process real uid offset");
int main(void) { return 0; }
C
"$work/verify-layout"
python3 - "$work" "$output" <<'PY'
from pathlib import Path
import json
import os
import signal
import subprocess
import sys
import time

work, output = map(Path, sys.argv[1:])
exe = work / "Applications Test/Gyroid.app/Contents/MacOS/Gyroid"
env = dict(os.environ, GYROID_NETWORK="testnet", GYROID_SETTINGS=str(work / "settings.json"),
           GYROID_DATA_DIR=str(work / "testnet"), GYROID_WALLET_DIR=str(work / "wallets"),
           GYROID_ENDPOINT="http://127.0.0.1:42891/", GYROID_NODE_MODE="automatic",
           BNT_CONFIG_DIR=str(work / "bnt"))
Path(env["BNT_CONFIG_DIR"]).mkdir()
settings = Path(env["GYROID_SETTINGS"])
settings.write_text(json.dumps({"network": "testnet"}))
settings.chmod(0o600)

def run(*args, environment=env):
    result = subprocess.run([str(exe), *args], env=environment, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
    (output / ("-".join(args).replace("--", "") + ".log")).write_text(result.stdout)
    print(result.stdout, end="", flush=True)
    result.check_returncode()
    return result.stdout

version = run("--version")
expected = subprocess.check_output(["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleShortVersionString",
                                    str(exe.parents[1] / "Info.plist")], text=True).strip()
assert version.strip() == "Gyroid " + expected
run("--help")
run("settings")
node = None
gui = None
try:
    try:
        assert Path(env["GYROID_BINARY"]).is_file()
        with (output / "node-launch.log").open("w") as log:
            node = subprocess.Popen([str(exe), "node", "start"], env=env, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                if node.poll() is not None:
                    raise RuntimeError("Testnet node start exited. See node-launch.log")
                if "Running: True" in (output / "node-launch.log").read_text():
                    break
                time.sleep(1)
            else:
                raise TimeoutError("Testnet core did not start within 180 seconds")
            status = run("node", "status")
            assert "Running: True" in status and "Network: testnet" in status
            scan = run("node", "start", environment=dict(env, GYROID_ENDPOINT="http://127.0.0.1:42892/"))
            assert "Running: True" in scan and "Network: testnet" in scan and "42891" in scan
    finally:
        with (output / "gui.log").open("w") as gui_log:
            gui = subprocess.Popen([str(exe)], env=env, stdout=gui_log, stderr=subprocess.STDOUT)
            time.sleep(20)
            subprocess.run(["screencapture", "-x", str(output / "gui.png")], check=True)
            if gui.poll() is not None:
                raise RuntimeError("GUI exited before screenshot. See gui.log")
finally:
    for process in (gui, node):
        if process is not None and process.poll() is None:
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=10)
PY
