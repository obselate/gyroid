#!/usr/bin/env bash
set +x
set -euo pipefail
exec 2>/dev/null
started=$SECONDS
step=Prerequisites
run=
child=
cleanup() {
    result=$?
    trap - EXIT
    if [[ -n "$child" ]]; then
        kill -TERM -- "-$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
    fi
    if [[ -n "$run" ]] && ! rm -rf -- "$run"; then
        result=1
    fi
    if (( result == 0 )); then
        printf 'Cleanup PASS\nTotal %ss PASS\n' "$((SECONDS - started))"
    else
        printf '%s FAIL\nTotal %ss FAIL\n' "$step" "$((SECONDS - started))"
    fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[[ $# == 1 && -x "$1" ]]
gyroid=$(realpath -- "$1")
run=$(mktemp -d -t gyroid-testnet.XXXXXX)
chmod 700 "$run"
step=Core
core=${BLOCKNET_CORE:-}
if [[ -z "$core" ]]; then
    curl --fail --silent --location --proto '=https' --proto-redir '=https' --max-time 180 \
        https://github.com/blocknetprivacy/core/releases/download/v0.22.0/blocknet-core-amd64-linux-0.22.0.zip \
        --output "$run/core.zip"
    unzip -qq "$run/core.zip" -d "$run/core" 2>/dev/null
    core=$run/core/blocknet-core-amd64-linux
    chmod 700 "$core"
fi
[[ -x "$core" ]]
core=$(realpath -- "$core")
[[ $(sha256sum "$core" | cut -d ' ' -f 1) == d64a062646792c60c11ddbc232044943557a6a1deadbcc8cd6dc66c788b89342 ]]
printf 'Core %ss PASS\n' "$((SECONDS - started))"
step=Testnet
{
exec setsid unshare --user --map-root-user --net bash -c 'ip link set lo up && exec python3 - "$@"' bash "$gyroid" "$core" "$run" <<'PY'
import decimal
import json
import os
import pathlib
import pty
import re
import secrets
import select
import shutil
import signal
import socket
import subprocess
import sys
import termios
import time
import urllib.error
import urllib.request

started = time.monotonic()
since = started
mining_timeout = int(os.environ.get("GYROID_TESTNET_MINING_TIMEOUT_SECONDS", "2400"))
snapshot_in = os.environ.get("GYROID_TESTNET_SNAPSHOT_IN", "")
snapshot_out = os.environ.get("GYROID_TESTNET_SNAPSHOT_OUT", "")
snapshot = None
tip = None
gyroid, core, directory = sys.argv[1:]
root = pathlib.Path(directory)
processes = []
step = "Isolation"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
environment = os.environ.copy()
for name in list(environment):
    if name.startswith(("GYROID_", "BNT_", "HTTP_", "HTTPS_", "ALL_PROXY", "http_", "https_", "all_proxy")):
        del environment[name]
environment.update(HOME=directory, XDG_CONFIG_HOME=str(root / "config"),
                   XDG_DATA_HOME=str(root / "data"), XDG_CACHE_HOME=str(root / "cache"),
                   XDG_RUNTIME_DIR=str(root / "runtime"), BNT_CONFIG_DIR=str(root / "bnt"),
                   GYROID_SETTINGS=str(root / "gyroid.json"), GYROID_NETWORK="testnet",
                   GYROID_NODE_MODE="manual")
os.umask(0o077)
for name in ("config", "data", "cache", "runtime", "bnt"):
    (root / name).mkdir()


def report(name, since):
    print(f"{name} {time.monotonic() - since:.2f}s PASS", flush=True)


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def interrupt(signum, frame):
    raise InterruptedError()


signal.signal(signal.SIGTERM, interrupt)
signal.signal(signal.SIGINT, interrupt)
signal.signal(signal.SIGALRM, interrupt)
signal.alarm(mining_timeout + 660)


def api(index, path, body=None):
    token = (root / f"node{index}" / "api.cookie").read_text().strip()
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"http://127.0.0.1:{ports[index]}/api/{path}", data=data,
                                    headers={"Authorization": "Bearer " + token,
                                             "Content-Type": "application/json"})
    with opener.open(request, timeout=5) as response:
        return json.load(response)


def wait_for(check, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        if any(process.poll() is not None for process in active):
            raise RuntimeError()
        time.sleep(0.2)
    raise TimeoutError()


def ready(index):
    try:
        return api(index, "status")
    except (FileNotFoundError, urllib.error.URLError, ConnectionError):
        return False


def launch(index):
    process = subprocess.Popen(["taskset", "-c", "0-3", "nice", "-n", "19", "ionice", "-c3",
                                core, "--testnet", "--data", str(root / f"node{index}"),
                                "--api", f"127.0.0.1:{ports[index]}"],
                               env=environment, cwd=root / f"node{index}",
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    processes.append(process)
    return process


def cli_error(output):
    for line in output.decode(errors="replace").splitlines():
        if not line.strip() or line.startswith(("Recipient:", "Amount:", "Fee:", "Total:", "Password:", "Submitted:")):
            continue
        line = line.replace(password, "[redacted]")
        for address in addresses:
            line = line.replace(address, "[redacted]")
        line = re.sub(r"\b[0-9A-Fa-f]{32,}\b|\b[1-9A-HJ-NP-Za-km-z]{80,}\b", "[redacted]", line)
        if re.search(r"\b(seed|cookie|password)\s*[:=]", line, re.IGNORECASE):
            line = "[redacted]"
        if re.search(r"(?:\b[a-z]+\s+){11,}[a-z]+\b", line):
            line = "[redacted]"
        print("CLI " + line[:240], flush=True)


def cli(*arguments, reply=None, prompt=None):
    command = [gyroid, *arguments]
    if reply is None:
        result = subprocess.run(command, env=environment, cwd=root, capture_output=True, timeout=30)
        if result.returncode:
            cli_error(result.stderr)
            raise RuntimeError()
        return result.stdout.decode()
    master, slave = pty.openpty()
    attributes = termios.tcgetattr(slave)
    attributes[3] &= ~termios.ECHO
    termios.tcsetattr(slave, termios.TCSANOW, attributes)
    process = subprocess.Popen(command, env=environment, cwd=root, stdin=slave, stdout=slave, stderr=slave)
    processes.append(process)
    os.close(slave)
    output = b""
    sent = False
    deadline = time.monotonic() + 30
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                output += chunk
                if not sent and prompt in output:
                    os.write(master, reply.encode() + b"\r")
                    sent = True
            if process.poll() is not None:
                break
        if process.wait(timeout=1) != 0 or not sent:
            cli_error(output)
            raise RuntimeError()
        return output.decode()
    finally:
        os.close(master)
        stop(process)


def atoms(text, label):
    match = re.search(rf"^{label}: ([0-9.]+) BNT", text, re.MULTILINE)
    if not match:
        raise RuntimeError()
    return int(decimal.Decimal(match[1]) * 100000000)


try:
    interfaces = {name for index, name in socket.if_nameindex()}
    if interfaces != {"lo"}:
        raise RuntimeError()
    sockets = [socket.socket() for _ in range(4)]
    for connection in sockets:
        connection.bind(("127.0.0.1", 0))
    ports = [connection.getsockname()[1] for connection in sockets]
    for connection in sockets:
        connection.close()
    if any(port in (8332, 28080, 28081, 38080, 38081) for port in ports):
        raise RuntimeError()
    configurations = []
    if snapshot_in:
        snapshot_path = pathlib.Path(snapshot_in).resolve()
        snapshot = json.loads((snapshot_path / "snapshot.json").read_text())
        if snapshot["network"] != "testnet":
            raise RuntimeError()
    for index in range(2):
        data = root / f"node{index}"
        if snapshot:
            shutil.copytree(snapshot_path / f"node{index}", data)
        else:
            data.mkdir()
        settings = dict(listen=f"/ip4/127.0.0.1/tcp/{ports[index + 2]}", seed=index == 1,
                        full_sync=True, wallet_file=str(data / "wallet.dat"),
                        identity_key_path=str(data / "identity.key"), p2p_max_inbound=1,
                        p2p_max_outbound=1, p2p_whitelist=[], extra_peers=[])
        configurations.append(settings)
        (data / "settings.json").write_text(json.dumps(settings))
    report(step, started)
    step = "Peers"
    since = time.monotonic()
    if snapshot:
        peer_ids = snapshot["peer_ids"]
    else:
        active = [launch(index) for index in range(2)]
        statuses = [wait_for(lambda index=index: ready(index)) for index in range(2)]
        for process in active:
            stop(process)
        peer_ids = [status["peer_id"] for status in statuses]
    for index in range(2):
        peer_id = peer_ids[1 - index]
        other = f"/ip4/127.0.0.1/tcp/{ports[3 - index]}/p2p/{peer_id}"
        configurations[index].update(extra_peers=[] if index == 1 else [other], p2p_whitelist=[peer_id])
        (root / f"node{index}" / "settings.json").write_text(json.dumps(configurations[index]))
    active = [launch(1)]
    wait_for(lambda: ready(1), seconds=mining_timeout)
    active.append(launch(0))
    for index in range(2):
        wait_for(lambda index=index: ready(index), seconds=mining_timeout)
        report(f"Startup{index}", since)
        wait_for(lambda index=index: api(index, "peers")["count"] == 1)
    report(step, since)
    step = "Wallets"
    since = time.monotonic()
    password = snapshot["password"] if snapshot else secrets.token_hex(16)
    action = "load" if snapshot else "create"
    addresses = [api(index, f"wallet/{action}", {"password": password})["address"] for index in range(2)]
    environment.update(GYROID_ENDPOINT=f"http://127.0.0.1:{ports[0]}",
                       GYROID_DATA_DIR=str(root / "node0"), GYROID_WALLET_DIR=str(root / "node0"),
                       GYROID_BINARY=core)
    api(0, "wallet/lock", {})
    cli("settings", "auto-lock", "1")
    cli("unlock", reply=password, prompt=b"Password:")
    report(step, since)
    step = "CliAutoLock"
    since = time.monotonic()
    api(0, "wallet/balance")
    def locked():
        try:
            api(0, "wallet/balance")
            return False
        except urllib.error.HTTPError as error:
            if error.code != 403:
                raise
            return True
    wait_for(locked, seconds=70)
    if time.monotonic() - since < 59:
        raise RuntimeError()
    cli("settings", "auto-lock", "0")
    cli("unlock", reply=password, prompt=b"Password:")
    report(step, since)
    step = "Maturity"
    since = time.monotonic()
    if not snapshot:
        api(0, "mining/threads", {"threads": 1})
        api(0, "mining/start", {})
        milestone = 10
        def mature():
            global milestone
            height = api(0, "status")["chain_height"]
            while milestone <= height:
                difficulty = api(0, f"block/{milestone}")["difficulty"]
                print(f"Blocks {milestone} {time.monotonic() - since:.2f}s Difficulty {difficulty} PASS", flush=True)
                milestone += 10
            return api(0, "wallet/balance").get("spendable", 0) > 100000000
        wait_for(mature, seconds=mining_timeout)
        api(0, "mining/stop", {})
    else:
        wait_for(lambda: api(0, "wallet/balance").get("spendable", 0) > 100000000)
    report(step, since)
    if snapshot_out:
        step = "Snapshot"
        since = time.monotonic()
        height = api(0, "status")["chain_height"]
        wait_for(lambda: api(1, "status")["chain_height"] == height, seconds=120)
        tip = (height, api(0, f"block/{height}")["difficulty"], api(0, "stats")["difficulty"])
        block_hash = api(0, f"block/{height}")["hash"]
        for process in active:
            stop(process)
        destination = pathlib.Path(snapshot_out).resolve()
        destination.mkdir(mode=0o700)
        for index in range(2):
            shutil.copytree(root / f"node{index}", destination / f"node{index}")
            (destination / f"node{index}" / "checkpoints.dat").write_text(f"{height}:{block_hash}\n")
        (destination / "snapshot.json").write_text(json.dumps(
            dict(network="testnet", password=password, peer_ids=peer_ids, height=height)))
        report(step, since)
        sys.exit(0)
    step = "Balance"
    since = time.monotonic()
    balance = cli("balance")
    if atoms(balance, "Spendable") <= 100000000:
        raise RuntimeError()
    report(step, since)
    step = "Estimate"
    since = time.monotonic()
    amount = 100000000
    memo = "Gyroid testnet verification"
    request = {"dry_run": True, "recipients": [{"address": addresses[1], "amount": amount, "memo_text": memo}]}
    estimate = api(0, "wallet/send", request)
    fee = estimate["input_total"] - estimate["change"] - amount
    if fee != estimate["fee"] or fee <= 0:
        raise RuntimeError()
    dry_run = cli("send", addresses[1], "1", "--memo", memo, "--dry-run")
    if atoms(dry_run, "Fee") != fee or atoms(dry_run, "Amount") != amount:
        raise RuntimeError()
    print(f"Amount {amount / 100000000:.8f} BNT Fee {fee / 100000000:.8f} BNT", flush=True)
    report(step, since)
    time.sleep(4)
    step = "Send"
    since = time.monotonic()
    submitted = cli("send", addresses[1], "1", "--memo", memo,
                    reply="send", prompt=b"Type send to submit:")
    transaction = re.search(r"Submitted: ([0-9a-f]{64})", submitted)
    if not transaction or atoms(submitted, "Fee") != fee:
        cli_error(submitted.encode())
        raise RuntimeError()
    transaction = transaction[1]
    print("Submit PASS", flush=True)
    confirmation_started = time.monotonic()
    api(0, "mining/threads", {"threads": 1})
    api(0, "mining/start", {})
    wait_for(lambda: api(1, "wallet/balance").get("total", 0) == amount, seconds=300)
    report("Receive", since)
    report("ConfirmationMining", confirmation_started)
    wait_for(lambda: f"Sent {transaction} 1 BNT confirmed" in cli("history"), seconds=20)
    report("Confirmed", since)
    api(0, "mining/stop", {})
    sends = api(0, "wallet/sends")["sends"]
    if len(sends) != 1 or sends[0]["txid"] != transaction or sends[0]["fee"] != fee:
        raise RuntimeError()
    recipient = sends[0]["recipients"][0]
    if recipient["amount"] != amount or recipient.get("memo_hex") != memo.encode().hex():
        raise RuntimeError()
    report(step, since)
except (Exception, KeyboardInterrupt):
    print(f"{step} {time.monotonic() - since:.2f}s FAIL", flush=True)
    sys.exit(1)
finally:
    since = time.monotonic()
    signal.alarm(0)
    try:
        if tip is None:
            height = api(0, "status")["chain_height"]
            tip = (height, api(0, f"block/{height}")["difficulty"], api(0, "stats")["difficulty"])
        print(f"Tip {tip[0]} Difficulty {tip[1]} NextDifficulty {tip[2]} PASS", flush=True)
    except Exception:
        print("Tip FAIL", flush=True)
    for process in reversed(processes):
        stop(process)
    report("Processes", since)
PY
} &
child=$!
wait "$child"
child=
