#!/usr/bin/env python3
"""
Transport Validation CLI — Python orchestration for H3 ramp, capture, knee detection, and report.
Loads central config from transport-config.yaml (env overrides). Records experiment metadata
(git commit, cluster, sysctl, k6 version, timestamp) for reproducibility.
Usage: python3 scripts/run_transport_validation.py [--warmup] [--transport-gate] [--capture] [--v2] ...
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path


def colima_cmd(*args: str) -> list[str]:
    """Return [colima_bin, ...args]. Resolves colima via PATH or Homebrew default."""
    colima = shutil.which("colima") or "/opt/homebrew/bin/colima"
    return [colima, *args]


def repo_root() -> Path:
    root = Path(__file__).resolve().parent.parent
    return root


def get_caddy_pod(env: dict | None = None) -> str | None:
    """Return caddy-h3 pod name in ingress-nginx, or None if not found."""
    env = {**os.environ, **(env or {})}
    r = subprocess.run(
        ["kubectl", "get", "pod", "-n", "ingress-nginx", "-l", "app=caddy-h3", "-o", "jsonpath={.items[0].metadata.name}"],
        capture_output=True,
        text=True,
        timeout=10,
        env=env,
    )
    if r.returncode != 0 or not (r.stdout or "").strip():
        return None
    return (r.stdout or "").strip()


def resolve_tshark() -> str | None:
    """Return tshark path (PATH, then Homebrew locations). Use so validator finds tshark when PATH lacks /opt/homebrew/bin."""
    out = shutil.which("tshark")
    if out:
        return out
    for cand in ("/opt/homebrew/bin/tshark", "/usr/local/bin/tshark"):
        if Path(cand).exists():
            return cand
    return None


def load_config(root: Path) -> dict:
    """Load transport-config.yaml; env overrides. No PyYAML required: fallback to defaults."""
    cfg_path = root / "infra" / "transport" / "transport-config.yaml"
    cfg: dict = {
        "k6": {"lb_ip": "192.168.64.240", "h2_rate": 0, "strict_h3": True, "bin": ".k6-build/bin/k6-http3"},
        "ramp": {"start_vus": 10, "step": 10, "max_vus": 200},
        "gate": {"quic_probe_repeat": 10},
        "capture": {
            "vm_pcap_path": "/tmp/vm-capture-validation.pcap",
            "interface_override": "",
            "min_pcap_bytes": 1024,
            "location": "pod",  # "pod" = tcpdump inside Caddy pod; "vm" = colima ssh
            "snaplen": 256,     # bytes per packet (enough for QUIC header + ALPN; keeps pcap small)
            "max_packets": 10000,  # stop after N packets (avoids multi-GB capture over kubectl)
        },
        "output": {"out_dir": "."},
    }
    if cfg_path.exists():
        try:
            import yaml
            with open(cfg_path) as f:
                file_cfg = yaml.safe_load(f) or {}
            for k, v in file_cfg.items():
                if isinstance(v, dict) and k in cfg:
                    cfg[k].update(v)
                else:
                    cfg[k] = v
        except ImportError:
            pass
    # Env overrides
    if os.environ.get("K6_LB_IP"):
        cfg["k6"]["lb_ip"] = os.environ["K6_LB_IP"]
    if os.environ.get("TRANSPORT_VALIDATION_OUT"):
        cfg["output"]["out_dir"] = os.environ["TRANSPORT_VALIDATION_OUT"]
    if os.environ.get("K6_BIN"):
        cfg["k6"]["bin"] = os.environ["K6_BIN"]
    return cfg


def compute_reproducibility_hash(cfg: dict, ramp_opts: list[str], env: dict) -> str:
    """Deterministic fingerprint of config and ramp options for reproducibility."""
    payload = {
        "config": cfg,
        "ramp_opts": ramp_opts,
        "env": {
            "K6_LB_IP": env.get("K6_LB_IP"),
            "STRICT_H3": env.get("STRICT_H3"),
            "H2_RATE": env.get("H2_RATE"),
        },
    }
    blob = json.dumps(payload, sort_keys=True).encode()
    return hashlib.sha256(blob).hexdigest()


def run(cmd: list[str], env: dict | None = None, check: bool = True, timeout: int | None = 300) -> subprocess.CompletedProcess:
    env = {**os.environ, **(env or {})}
    return subprocess.run(cmd, env=env, check=check, timeout=timeout)


def run_allow_fail(cmd: list[str], env: dict | None = None, timeout: int | None = 120, stdout=None, stderr=None, cwd: str | Path | None = None) -> subprocess.CompletedProcess:
    env = {**os.environ, **(env or {})}
    capture = stdout is None and stderr is None
    stderr_out = stderr if stderr is not None else (subprocess.PIPE if capture else subprocess.DEVNULL)
    try:
        return subprocess.run(cmd, env=env, timeout=timeout, capture_output=capture, text=True, stdout=stdout, stderr=stderr_out, cwd=cwd)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, -1, None, None)
    except Exception:
        return subprocess.CompletedProcess(cmd, -1, None, None)


def main() -> int:
    root = repo_root()
    cfg = load_config(root)
    k6_cfg = cfg["k6"]
    ramp_cfg = cfg["ramp"]
    gate_cfg = cfg["gate"]
    capture_cfg = cfg["capture"]
    out_dir = Path(cfg["output"]["out_dir"]).expanduser()
    if not out_dir.is_absolute():
        out_dir = (root / out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    parser = argparse.ArgumentParser(
        description="Transport validation: H3 ramp + optional capture + report.",
        epilog="To validate an existing pcap without running the ramp: --pcap vm.pcap --v2",
    )
    parser.add_argument("--warmup", action="store_true", help="Run 10 VUs 20s warmup before ramp")
    parser.add_argument("--transport-gate", action="store_true", help="5s sustained H3 gate before ramp (capture before gate)")
    parser.add_argument("--pcap", metavar="PATH", help="Validate this pcap (skips ramp if no --capture); e.g. --pcap vm.pcap")
    parser.add_argument("--capture", action="store_true", help="tcpdump during ramp (default: in Caddy pod; else VM); validate QUIC+h3 ALPN")
    parser.add_argument("--require-transport-proof", action="store_true", help="Exit 1 if transport not validated")
    parser.add_argument("--bbr-vs-cubic", action="store_true", help="Ramp twice (BBR vs CUBIC), compare")
    parser.add_argument("--metallb-vs-nodeport", action="store_true", help="MetalLB then NodePort ramp compare")
    parser.add_argument("--v2", action="store_true", help="Use knee v3 + classifier/report v2")
    parser.add_argument("--export-dataset", action="store_true", help="Write dataset_{experiment_uuid}.json and ramp_steps.csv")
    parser.add_argument("--compare", metavar="OLD_REPORT.json", help="Compare to previous report; exit 1 if regression detected")
    parser.add_argument("--start", type=int, default=ramp_cfg["start_vus"], help=f"Start VUs (default {ramp_cfg['start_vus']})")
    parser.add_argument("--step", type=int, default=ramp_cfg["step"], help=f"Step VUs (default {ramp_cfg['step']})")
    parser.add_argument("--max", type=int, default=ramp_cfg["max_vus"], help=f"Max VUs (default {ramp_cfg['max_vus']})")
    parser.add_argument("--config", metavar="YAML", help="Override config file path")
    args = parser.parse_args()

    if args.config:
        cfg_path = Path(args.config).expanduser()
        if cfg_path.exists():
            try:
                import yaml
                with open(cfg_path) as f:
                    file_cfg = yaml.safe_load(f) or {}
                for k, v in file_cfg.items():
                    if isinstance(v, dict) and k in cfg:
                        cfg[k].update(v)
                    else:
                        cfg[k] = v
            except ImportError:
                pass

    # Env for all subprocesses
    env = {
        "K6_LB_IP": k6_cfg["lb_ip"],
        "H2_RATE": str(k6_cfg["h2_rate"]),
        "STRICT_H3": "1" if k6_cfg["strict_h3"] else "0",
        "TRANSPORT_VALIDATION_OUT": str(out_dir),
        "RAMP_STEPS_FILE": str(out_dir / "ramp_steps.json"),
        "RAMP_STEPS_STREAM": str(out_dir / "ramp_steps.jsonl"),
        "TRANSPORT_SUMMARY_FILE": str(out_dir / "transport-summary.json"),
    }
    k6_bin = root / k6_cfg["bin"] if not Path(k6_cfg["bin"]).is_absolute() else Path(k6_cfg["bin"])
    if not k6_bin.is_absolute():
        k6_bin = root / k6_bin
    env["K6_BIN"] = str(k6_bin)
    env["QUIC_PROBE_REPEAT"] = str(gate_cfg.get("quic_probe_repeat", 10))

    transport_gate = args.transport_gate
    do_capture = args.capture
    use_v2 = args.v2
    pcap_path_arg = args.pcap
    require_proof = args.require_transport_proof
    warmup = args.warmup
    ramp_opts = ["--start", str(args.start), "--step", str(args.step), "--max", str(args.max)]

    experiment_uuid = str(uuid.uuid4())
    reproducibility_hash = compute_reproducibility_hash(cfg, ramp_opts, env)

    scripts = root / "scripts"
    lib = root / "scripts" / "lib"

    # ----- Health gate (infra only when transport-gate) -----
    if os.environ.get("SKIP_HEALTH_GATE") == "1":
        pass
    else:
        if transport_gate:
            env["SKIP_QUIC_PROBE"] = "1"
            run([str(scripts / "pre-ramp-health-gate.sh")], env=env)
        elif (scripts / "pre-ramp-health-gate.sh").exists():
            run([str(scripts / "pre-ramp-health-gate.sh")], env=env)
        print()

    # ----- Capture start (before transport gate) -----
    tcpdump_proc: subprocess.Popen | None = None
    vm_pcap = capture_cfg["vm_pcap_path"]
    capture_location = (capture_cfg.get("location") or os.environ.get("TRANSPORT_CAPTURE_LOCATION") or "pod").strip().lower()
    snaplen = str(capture_cfg.get("snaplen", 256))
    max_packets = str(capture_cfg.get("max_packets", 10000))
    capture_in_pod: bool = False
    caddy_pod_name: str | None = None

    # Interface detection only for VM capture (display / fallback)
    iface_override = (capture_cfg.get("interface_override") or "").strip()
    if iface_override:
        iface = iface_override
    else:
        iface = "any"
        if capture_location == "vm":
            r = run_allow_fail(colima_cmd("ssh", "--", "ip", "route", "get", k6_cfg["lb_ip"]), env=env)
            route_output = ((r.stdout or "") + (r.stderr or "")).replace("\r", "").strip()
            if r.returncode == 0 and route_output and re.search(r"\bdev\s+(\S+)", route_output):
                iface = re.search(r"\bdev\s+(\S+)", route_output).group(1)
            else:
                iface = "col0"
                print("[Capture] Could not parse 'dev' from ip route get; using Colima fallback 'col0'.")

    if do_capture:
        if not resolve_tshark():
            print("[Capture] tshark not found (PATH or /opt/homebrew/bin, /usr/local/bin); pcap validation will fail. Install: brew install wireshark", file=sys.stderr)
        # Prefer pod capture: Caddy pod sees QUIC; VM capture can miss packets (Colima networking).
        if capture_location == "pod":
            caddy_pod_name = get_caddy_pod(env)
            if caddy_pod_name:
                capture_in_pod = True
                print("=== Capture: start (in Caddy pod; tcpdump sees QUIC at listener) ===")
                print(f"[Capture] Pod: {caddy_pod_name}")
                try:
                    tcpdump_proc = subprocess.Popen(
                        [
                            "kubectl", "exec", "-n", "ingress-nginx", caddy_pod_name, "--",
                            "tcpdump", "-i", "any", "-s", snaplen, "-c", max_packets,
                            "-w", "/tmp/vm.pcap", "udp", "port", "443",
                        ],
                        env={**os.environ, **env},
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    print(f"[Capture] Pod tcpdump started (PID {tcpdump_proc.pid})\n")
                except (FileNotFoundError, OSError) as e:
                    print(f"[Capture] kubectl exec failed: {e}; falling back to VM capture.", file=sys.stderr)
                    capture_in_pod = False
                    caddy_pod_name = None
            else:
                print("[Capture] No caddy-h3 pod found; falling back to VM capture.", file=sys.stderr)

        if not capture_in_pod and capture_location == "vm":
            print("=== Capture: start (VM, inside Colima) ===")
            try:
                run(colima_cmd("ssh", "--", "true"), env=env, check=True)
                r = run_allow_fail(colima_cmd("ssh", "--", "test", "-x", "/usr/bin/tcpdump"), env=env)
                if r.returncode != 0:
                    r = run_allow_fail(colima_cmd("ssh", "--", "which", "tcpdump"), env=env)
                if r.returncode != 0:
                    print("[Capture] tcpdump not found; installing via apt...")
                    run(colima_cmd("ssh", "--", "sudo", "apt-get", "update", "-qq"), env=env)
                    run(colima_cmd("ssh", "--", "sudo", "apt-get", "install", "-y", "tcpdump"), env=env)
                # Gold standard: restrict to MetalLB IP so only traffic to our LB is captured (no background QUIC).
                lb_ip = k6_cfg.get("lb_ip") or env.get("K6_LB_IP") or ""
                bpf_vm = "udp port 443"
                if lb_ip:
                    bpf_vm = f"udp and dst host {lb_ip} and dst port 443"
                    print(f"[Capture] BPF: {bpf_vm} (traffic to MetalLB IP only)")
                print(f"[Capture] Starting VM tcpdump -i {iface} {bpf_vm} -> {vm_pcap}")
                tcpdump_proc = subprocess.Popen(
                    colima_cmd(
                        "ssh", "--",
                        "sudo", "tcpdump",
                        "-i", "any", "-s", snaplen, "-c", max_packets, "-nn",
                        *bpf_vm.split(),
                        "-w", vm_pcap,
                    ),
                    env={**os.environ, **env},
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                print(f"[Capture] VM tcpdump started (SSH process PID {tcpdump_proc.pid})\n")
            except KeyboardInterrupt:
                print("\nInterrupted.", file=sys.stderr)
                return 130
        elif not capture_in_pod:
            print("=== Capture: start (VM fallback) ===")
            try:
                run(colima_cmd("ssh", "--", "true"), env=env, check=True)
                r = run_allow_fail(colima_cmd("ssh", "--", "which", "tcpdump"), env=env)
                if r.returncode != 0:
                    print("[Capture] tcpdump not found in VM; installing via apt...")
                    run(colima_cmd("ssh", "--", "sudo", "apt-get", "update", "-qq"), env=env)
                    run(colima_cmd("ssh", "--", "sudo", "apt-get", "install", "-y", "tcpdump"), env=env)
                lb_ip = k6_cfg.get("lb_ip") or env.get("K6_LB_IP") or ""
                bpf_vm = "udp port 443"
                if lb_ip:
                    bpf_vm = f"udp and dst host {lb_ip} and dst port 443"
                print(f"[Capture] Starting VM tcpdump -i any {bpf_vm} -> {vm_pcap}")
                tcpdump_proc = subprocess.Popen(
                    colima_cmd("ssh", "--", "sudo", "tcpdump", "-i", "any", "-s", snaplen, "-c", max_packets, "-nn", *bpf_vm.split(), "-w", vm_pcap),
                    env={**os.environ, **env},
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                print(f"[Capture] VM tcpdump started (PID {tcpdump_proc.pid})\n")
            except KeyboardInterrupt:
                print("\nInterrupted.", file=sys.stderr)
                return 130

    # ----- Transport gate -----
    if os.environ.get("SKIP_HEALTH_GATE") != "1" and transport_gate:
        env["SKIP_INFRA"] = "1"
        try:
            run([str(scripts / "pre-ramp-transport-gate.sh")], env=env)
        except subprocess.CalledProcessError as e:
            print("", file=sys.stderr)
            print("Transport gate failed (H3 from host to LB IP did not succeed).", file=sys.stderr)
            print("Common causes: UDP 443 not reaching Caddy (MetalLB/Colima), or k6 target unreachable.", file=sys.stderr)
            print("Fix QUIC path then re-run. See docs/HTTP3-UDP-AND-COLIMA-FIXES.md", file=sys.stderr)
            sys.exit(e.returncode if e.returncode is not None else 1)
        print()

    print("=== Transport validation run ===")
    print(f"Env: K6_LB_IP={env['K6_LB_IP']} H2_RATE={env['H2_RATE']} STRICT_H3=1")
    print("k6 ramp runs on host; traffic: host → LB (Caddy). Capture is in Caddy pod by default (or VM if TRANSPORT_CAPTURE_LOCATION=vm).")
    print(f"Output dir: {out_dir}\n")

    # When only --pcap is given (no --capture), skip ramp and go to pcap validation + downstream
    pcap_only_mode = bool(pcap_path_arg and Path(pcap_path_arg).exists() and not do_capture)

    # ----- Warmup -----
    if warmup and not pcap_only_mode:
        print("Warmup: 10 VUs, 20s (discard)...")
        run_allow_fail([str(k6_bin), "run", str(scripts / "k6-chaos-test.js")], env={**env, "H3_VUS": "10", "DURATION": "20s"})
        print("Warmup done.\n")

    # ----- Ramp ----- (skipped when --pcap only, no --capture)
    if pcap_only_mode:
        print("Skipping ramp (--pcap only mode); validating pcap and continuing.\n")
        pcap_path = pcap_path_arg
    else:
        (out_dir / "ramp_steps.json").unlink(missing_ok=True)
        (out_dir / "ramp_steps.jsonl").unlink(missing_ok=True)
        env["SKIP_HEALTH_GATE"] = "1"
        # Short per-step duration so ramp completes in reasonable time (e.g. 20 steps × 15s ≈ 5 min)
        env["DURATION"] = os.environ.get("RAMP_DURATION", "15s")
        try:
            r = run_allow_fail(
                [str(scripts / "run-h3-ramp.sh"), "--collect-steps"] + ramp_opts,
                env=env,
                timeout=3600,
                cwd=root,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except KeyboardInterrupt:
            if tcpdump_proc is not None:
                tcpdump_proc.terminate()
                time.sleep(1)
                try:
                    tcpdump_proc.kill()
                except ProcessLookupError:
                    pass
            print("\nInterrupted.", file=sys.stderr)
            return 130
        if not (out_dir / "ramp_steps.json").exists():
            print("No ramp_steps.json produced.", file=sys.stderr)
            print(f"Expecting ramp_steps.json at: {out_dir / 'ramp_steps.json'}", file=sys.stderr)
            print(f"Files in out_dir: {list(out_dir.glob('*'))}", file=sys.stderr)
            print(f"Ramp exit code: {r.returncode}", file=sys.stderr)
            if r.returncode == -1:
                print("Exit -1 usually means the ramp was killed by timeout. Try RAMP_DURATION=10s or --max 20 for a shorter run.", file=sys.stderr)
            if r.stderr:
                print("Ramp stderr:", file=sys.stderr)
                print(r.stderr, file=sys.stderr)
            if r.stdout:
                lines = (r.stdout or "").strip().splitlines()
                print("Ramp stdout (last 50 lines):", file=sys.stderr)
                for line in lines[-50:]:
                    print(line, file=sys.stderr)
            return 1

    # ----- Capture stop and validate -----
    pcap_path: str | None = pcap_path_arg
    if do_capture and tcpdump_proc is not None:
        print("=== Capture: stop and validate ===")
        tcpdump_proc.terminate()
        time.sleep(2)
        try:
            tcpdump_proc.kill()
        except ProcessLookupError:
            pass
        time.sleep(1)
        if capture_in_pod and caddy_pod_name:
            pcap_local = out_dir / "vm.pcap"
            # Check pcap in pod before copy (diagnose 0-byte copies)
            check = subprocess.run(
                ["kubectl", "exec", "-n", "ingress-nginx", caddy_pod_name, "--", "sh", "-c", "ls -la /tmp/vm.pcap 2>/dev/null || echo 'FILE_MISSING'"],
                capture_output=True,
                text=True,
                env={**os.environ, **env},
                timeout=15,
            )
            if check.returncode != 0 or "FILE_MISSING" in (check.stdout or "") + (check.stderr or ""):
                print("[Capture] pcap missing in pod (tcpdump may have failed to start or pod restarted during ramp).", file=sys.stderr)
                if check.stdout:
                    print(check.stdout.strip(), file=sys.stderr)
                if check.stderr:
                    print(check.stderr.strip(), file=sys.stderr)
            else:
                print(f"[Capture] In-pod pcap: {(check.stdout or '').strip()}", file=sys.stderr)
            try:
                with open(pcap_local, "wb") as f:
                    r = subprocess.run(
                        ["kubectl", "exec", "-n", "ingress-nginx", caddy_pod_name, "--", "cat", "/tmp/vm.pcap"],
                        stdout=f,
                        stderr=subprocess.PIPE,
                        env={**os.environ, **env},
                        timeout=300,
                    )
                if r.returncode != 0:
                    err = (r.stderr or b"").decode(errors="replace").strip()
                    print(f"[Capture] kubectl exec cat failed: {err}", file=sys.stderr)
                elif pcap_local.stat().st_size == 0:
                    print("[Capture] kubectl exec cat returned 0 bytes (file in pod may be empty; tcpdump may have captured no packets).", file=sys.stderr)
            except subprocess.TimeoutExpired:
                print("[Capture] kubectl exec cat timed out (pcap very large?). Increase timeout or shorten ramp.", file=sys.stderr)
                if pcap_local.exists():
                    pcap_local.unlink()
            run_allow_fail(
                ["kubectl", "exec", "-n", "ingress-nginx", caddy_pod_name, "--", "rm", "-f", "/tmp/vm.pcap"],
                env=env,
            )
        else:
            with open(out_dir / "vm.pcap", "wb") as f:
                r = subprocess.run(colima_cmd("ssh", "--", "sudo", "cat", vm_pcap), capture_output=True, env=env, timeout=30)
                if r.returncode == 0 and r.stdout:
                    f.write(r.stdout)
            run_allow_fail(colima_cmd("ssh", "--", "sudo", "rm", "-f", vm_pcap), env=env)
        time.sleep(1)
        capture_pcap = out_dir / "vm.pcap"
        min_bytes = capture_cfg.get("min_pcap_bytes", 1024)
        if not capture_pcap.exists() or capture_pcap.stat().st_size < min_bytes:
            size = capture_pcap.stat().st_size if capture_pcap.exists() else 0
            print("❌ Capture failed: vm.pcap missing or too small", file=sys.stderr)
            print(f"   (got {size} bytes, need >= {min_bytes}). No UDP/QUIC packets captured.", file=sys.stderr)
            print("   With pod capture, Caddy pod should see QUIC; check Caddy image has tcpdump (e.g. caddy-with-tcpdump).", file=sys.stderr)
            if capture_in_pod and size == 0:
                print("   If in-pod pcap is missing/empty above: tcpdump may have failed to start (check -s/-c support) or pod restarted during ramp.", file=sys.stderr)
            return 1
        validator = lib / "transport_validator.py"
        validation_json_capture = out_dir / "transport_validation.json"
        if validator.exists():
            run_env = {**os.environ, **env}
            tshark_path = resolve_tshark()
            if tshark_path:
                run_env["PATH"] = str(Path(tshark_path).parent) + os.pathsep + run_env.get("PATH", os.environ.get("PATH", ""))
                run_env["TSHARK_BIN"] = tshark_path
            proc = subprocess.run(
                [sys.executable, str(validator), str(capture_pcap), "--output", str(validation_json_capture.resolve())],
                env=run_env,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if not validation_json_capture.exists() or validation_json_capture.stat().st_size == 0:
                validation_json_capture.write_text(proc.stdout if proc.stdout else "{}")
                if proc.stderr:
                    print("   Validator stderr:", file=sys.stderr)
                    print(proc.stderr.strip(), file=sys.stderr)
        try:
            tv = json.loads((out_dir / "transport_validation.json").read_text())
        except (json.JSONDecodeError, OSError):
            tv = {}
        if not tv.get("valid"):
            print("❌ Transport validation failed: QUIC and/or h3 ALPN not confirmed.", file=sys.stderr)
            err = tv.get("error")
            if err is None and not tv:
                err = "validator produced no output (re-run and check stderr for tshark or crash)"
            err = err or "unknown"
            print(f"   Reason: {err}", file=sys.stderr)
            if "tshark" in err.lower():
                print("   Install tshark (macOS): brew install wireshark", file=sys.stderr)
                print("   Then re-run this script or: python3 scripts/lib/transport_validator.py vm.pcap", file=sys.stderr)
            print(f"   Details: alpn_h3={tv.get('alpn_h3')} quic_stream_frames={tv.get('quic_stream_frames')} quic_version={tv.get('quic_version')} http2_frames={tv.get('http2_frames')}", file=sys.stderr)
            print(f"   Full report: {out_dir / 'transport_validation.json'}", file=sys.stderr)
            return 1
        print("✅ transport_validated=true (QUIC + h3 ALPN confirmed)\n")
        pcap_path = str(capture_pcap)

    # ----- Knee detection -----
    print("Knee detection...")
    knee_files = [lib / "knee_detection_v3.py", lib / "knee_detection_v2.py", lib / "knee_detection.py"]
    if use_v2:
        knee_script = next((p for p in knee_files if p.exists()), None)
    else:
        knee_script = lib / "knee_detection.py"
    if knee_script and knee_script.exists():
        with open(out_dir / "knee_result.json", "w") as out:
            run_allow_fail([sys.executable, str(knee_script), str(out_dir / "ramp_steps.json")], env=env, stdout=out)

    # ----- Optional pcap validation (--pcap without --capture) -----
    validation_json = out_dir / "transport_validation.json"
    if pcap_path and Path(pcap_path).exists() and (lib / "transport_validator.py").exists() and not do_capture:
        pcap_abs = Path(pcap_path).resolve()
        print(f"Validating pcap: {pcap_abs}")
        run_env = {**os.environ, **env}
        tshark_path = resolve_tshark()
        if tshark_path:
            run_env["PATH"] = str(Path(tshark_path).parent) + os.pathsep + run_env.get("PATH", os.environ.get("PATH", ""))
            run_env["TSHARK_BIN"] = tshark_path
        # Validator writes directly to file (--output) so we don't depend on subprocess stdout capture
        proc = subprocess.run(
            [sys.executable, str(lib / "transport_validator.py"), str(pcap_abs), "--output", str(validation_json.resolve())],
            env=run_env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if not validation_json.exists():
            validation_json.write_text(
                json.dumps({
                    "valid": False,
                    "error": "validator produced no output (crash or timeout)",
                    "quic_version": None,
                    "alpn_h3": False,
                    "http2_frames": 0,
                    "validation_note": "Run standalone: python3 scripts/lib/transport_validator.py <pcap>",
                })
            )
        # exit 1 from validator just means valid=false; file was still written (--output). Don't overwrite.
        if proc.returncode != 0:
            if proc.stderr:
                print(f"[Validator stderr] {proc.stderr.strip()}", file=sys.stderr)
            try:
                tv = json.loads(validation_json.read_text())
                if not tv.get("valid"):
                    print(f"[Validator] valid=false error={tv.get('error')} quic_version={tv.get('quic_version')}", file=sys.stderr)
                    print(f"  Check file after CLI: cat {validation_json.resolve()}", file=sys.stderr)
            except (json.JSONDecodeError, OSError):
                pass
    if not validation_json.exists():
        validation_json.write_text('{"valid": false, "error": "no pcap or validator"}')

    # ----- Bottleneck classification -----
    print("Bottleneck classification...")
    quic_loss_json = out_dir / "quic_loss.json"
    if pcap_path and Path(pcap_path).exists() and (lib / "quic_loss_analyzer.py").exists():
        with open(quic_loss_json, "w") as out:
            run_allow_fail([sys.executable, str(lib / "quic_loss_analyzer.py"), pcap_path], env=env, stdout=out)
    classifier_v2 = lib / "bottleneck_classifier_v2.py"
    classifier = lib / "bottleneck_classifier.py"
    comp_input = out_dir / "transport_comparison_input.json"
    if not comp_input.exists():
        comp_input.write_text("{}")
    if use_v2 and classifier_v2.exists():
        cmd = [sys.executable, str(classifier_v2), str(out_dir / "ramp_steps.json"), str(validation_json), str(comp_input)]
        if quic_loss_json.exists():
            cmd.append(str(quic_loss_json))
        with open(out_dir / "bottleneck_result.json", "w") as out:
            run_allow_fail(cmd, env=env, stdout=out)
    elif classifier.exists():
        with open(out_dir / "bottleneck_result.json", "w") as out:
            run_allow_fail([sys.executable, str(classifier), str(out_dir / "ramp_steps.json"), str(validation_json)], env=env, stdout=out)

    # ----- Experiment metadata -----
    sys.path.insert(0, str(lib))
    from experiment_metadata import collect as collect_meta
    meta = collect_meta(root, k6_bin, experiment_uuid=experiment_uuid, reproducibility_hash=reproducibility_hash)
    with open(out_dir / "experiment_metadata.json", "w") as f:
        json.dump(meta, f, indent=2)
    print("Experiment metadata written to", out_dir / "experiment_metadata.json")

    # ----- Report -----
    print("Building transport_ceiling_report.json...")
    report_v2 = lib / "build_ceiling_report_v2.py"
    report_v1 = lib / "build_ceiling_report.py"
    report_file = out_dir / "transport_ceiling_report.json"
    report_root = str(out_dir.resolve())  # absolute so report reads same dir we wrote to
    report_cwd = out_dir.resolve()  # run report with cwd=out_dir so path context is explicit
    if use_v2 and report_v2.exists():
        run_allow_fail([sys.executable, str(report_v2), report_root], env=env, cwd=report_cwd, stderr=sys.stderr)
    elif report_v1.exists():
        run_allow_fail([sys.executable, str(report_v1), report_root], env=env, cwd=report_cwd, stderr=sys.stderr)
    if report_file.exists():
        print("\n=== transport_ceiling_report.json ===")
        print(report_file.read_text())
        print(f"\nWritten to: {report_file}")
        fmt = lib / "format_ceiling_report.py"
        if fmt.exists():
            run_allow_fail([sys.executable, str(fmt), str(out_dir), "-m"], env=env)

        if args.export_dataset:
            rep = json.loads(report_file.read_text())
            eid = (rep.get("experiment") or {}).get("experiment_uuid") or meta.get("experiment_uuid") or "unknown"
            dataset = {
                "experiment_uuid": eid,
                "timestamp": meta.get("timestamp_utc"),
                "ramp_steps": json.loads((out_dir / "ramp_steps.json").read_text()) if (out_dir / "ramp_steps.json").exists() else [],
                "transport_validation": rep.get("transport_validation"),
                "performance": rep.get("performance"),
                "bottleneck": rep.get("performance", {}).get("bound"),
            }
            dataset_path = out_dir / f"dataset_{eid}.json"
            with open(dataset_path, "w") as f:
                json.dump(dataset, f, indent=2)
            print(f"Dataset written to {dataset_path}", file=sys.stderr)
            if (out_dir / "ramp_steps.json").exists():
                steps_data = json.loads((out_dir / "ramp_steps.json").read_text())
                steps_list = steps_data if isinstance(steps_data, list) else steps_data.get("steps", steps_data.get("ramp_steps", []))
                if steps_list and isinstance(steps_list[0], dict):
                    csv_path = out_dir / "ramp_steps.csv"
                    with open(csv_path, "w", newline="") as f:
                        writer = csv.DictWriter(f, fieldnames=list(steps_list[0].keys()), extrasaction="ignore")
                        writer.writeheader()
                        writer.writerows(steps_list)
                    print(f"ramp_steps.csv written to {csv_path}", file=sys.stderr)

        if args.compare:
            old_path = Path(args.compare).expanduser().resolve()
            if not old_path.exists():
                print(f"❌ --compare: file not found: {old_path}", file=sys.stderr)
                return 1
            old_report = json.loads(old_path.read_text())
            new_report = json.loads(report_file.read_text())
            from regression_detector import compare_reports
            deltas, regression = compare_reports(old_report, new_report)
            print("Comparison:", json.dumps(deltas, indent=2), file=sys.stderr)
            if regression:
                print("❌ Regression detected (RPS drop >5% or loss increase >0.02).", file=sys.stderr)
                return 1
            print("✅ No regression detected.")

    # ----- Require transport proof -----
    if require_proof and report_file.exists():
        with open(report_file) as f:
            rep = json.load(f)
        tv = rep.get("transport_validation") or rep
        if not tv.get("validated", rep.get("transport_validated", False)):
            print("❌ --require-transport-proof: transport not validated.", file=sys.stderr)
            return 1
        print("✅ Transport proof required and satisfied.")

    # ----- BBR vs CUBIC (optional) -----
    if args.bbr_vs_cubic:
        print("\n=== BBR vs CUBIC comparison ===")
        run_allow_fail([str(scripts / "colima-quic-sysctl.sh")], env=env)
        env["SKIP_HEALTH_GATE"] = "1"
        run_allow_fail([str(scripts / "run-h3-ramp.sh"), "--collect-steps"] + ramp_opts, env=env, timeout=3600)
        steps_bbr = json.loads((out_dir / "ramp_steps.json").read_text()) if (out_dir / "ramp_steps.json").exists() else []
        bbr_max = max((s.get("rps") or 0) for s in steps_bbr) if steps_bbr else 0
        (out_dir / "ramp_steps_bbr.json").write_text(json.dumps(steps_bbr, indent=2))
        run_allow_fail(["env", "COLIMA_QUIC_SKIP_BBR=1", str(scripts / "colima-quic-sysctl.sh")], env=env)
        (out_dir / "ramp_steps.json").unlink(missing_ok=True)
        (out_dir / "ramp_steps.jsonl").unlink(missing_ok=True)
        run_allow_fail([str(scripts / "run-h3-ramp.sh"), "--collect-steps"] + ramp_opts, env=env, timeout=3600)
        steps_cubic = json.loads((out_dir / "ramp_steps.json").read_text()) if (out_dir / "ramp_steps.json").exists() else []
        cubic_max = max((s.get("rps") or 0) for s in steps_cubic) if steps_cubic else 0
        delta = round((cubic_max - bbr_max) / bbr_max * 100, 2) if bbr_max else 0
        (out_dir / "transport_comparison_input.json").write_text(
            json.dumps({"bbr_vs_cubic_delta_percent": delta, "bbr_max_rps": bbr_max, "cubic_max_rps": cubic_max})
        )
        run_allow_fail([sys.executable, str(report_v1), str(out_dir)], env=env)

    print()
    if do_capture:
        print("Done. pcap and transport_validation in", out_dir)
    else:
        print("Done. Optional: --capture for VM capture, or --pcap <path> to validate existing capture.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
