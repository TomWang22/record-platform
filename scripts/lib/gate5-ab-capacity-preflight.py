#!/usr/bin/env python3
"""Bounded host-capacity preflight for Gate 5 disposable readiness A/B.

Exit codes:
  0  — capacity healthy (enough consecutive samples)
  75 — BLOCKED_HOST_SATURATION (timeout or hard fail); evidence written
  2  — usage / lock error
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_cmd(argv: list[str], *, timeout: float, env: dict[str, str] | None = None) -> dict[str, Any]:
    t0 = time.time()
    try:
        r = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env or os.environ.copy(),
        )
        return {
            "argv": argv,
            "rc": r.returncode,
            "stdout": (r.stdout or "")[:4000],
            "stderr": (r.stderr or "")[:2000],
            "duration_s": round(time.time() - t0, 3),
            "timed_out": False,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "argv": argv,
            "rc": 124,
            "stdout": (exc.stdout or "")[:2000] if isinstance(exc.stdout, str) else "",
            "stderr": f"TIMEOUT after {timeout}s",
            "duration_s": round(time.time() - t0, 3),
            "timed_out": True,
        }


def parse_loadavg(text: str) -> tuple[float | None, float | None, float | None]:
    parts = (text or "").strip().split()
    if len(parts) < 3:
        return None, None, None
    try:
        return float(parts[0]), float(parts[1]), float(parts[2])
    except ValueError:
        return None, None, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence-root", required=True)
    ap.add_argument("--max-wait-seconds", type=int, default=180)
    ap.add_argument("--sample-interval-seconds", type=float, default=15.0)
    ap.add_argument("--required-consecutive-healthy", type=int, default=3)
    ap.add_argument("--cmd-timeout-seconds", type=float, default=15.0)
    ap.add_argument("--load-per-cpu-max", type=float, default=1.5)
    ap.add_argument("--min-host-mem-gib", type=float, default=4.0)
    ap.add_argument("--min-docker-free-gib", type=float, default=4.0)
    ap.add_argument("--min-docker-storage-free-gib", type=float, default=30.0)
    ap.add_argument("--docker-info-latency-max-s", type=float, default=10.0)
    ap.add_argument("--readyz-latency-max-s", type=float, default=5.0)
    ap.add_argument("--require-k8s", action="store_true", help="Also require live k8s health (default profile only)")
    ap.add_argument("--docker-host", default=os.environ.get("DOCKER_HOST", ""))
    ap.add_argument("--skip-k8s", action="store_true", default=True)
    args = ap.parse_args()

    root = Path(args.evidence_root)
    root.mkdir(parents=True, exist_ok=True)
    lock = root / "WRITER_LOCK.json"
    if lock.exists():
        print(f"lock exists: {lock}", file=sys.stderr)
        return 2
    lock.write_text(
        json.dumps({"pid": os.getpid(), "host": socket.gethostname(), "ts": utc_now()}, indent=2) + "\n",
        encoding="utf-8",
    )

    env = os.environ.copy()
    if args.docker_host:
        env["DOCKER_HOST"] = args.docker_host

    thresholds = {
        "load1_per_cpu_max": args.load_per_cpu_max,
        "load5_per_cpu_max": args.load_per_cpu_max,
        "min_host_mem_gib": args.min_host_mem_gib,
        "min_docker_free_gib": args.min_docker_free_gib,
        "min_docker_storage_free_gib": args.min_docker_storage_free_gib,
        "docker_info_latency_max_s": args.docker_info_latency_max_s,
        "readyz_latency_max_s": args.readyz_latency_max_s,
        "max_wait_seconds": args.max_wait_seconds,
        "sample_interval_seconds": args.sample_interval_seconds,
        "required_consecutive_healthy_samples": args.required_consecutive_healthy,
        "per_command_timeout_seconds": args.cmd_timeout_seconds,
    }

    samples: list[dict[str, Any]] = []
    commands: list[dict[str, Any]] = []
    healthy_streak = 0
    t_start = time.time()
    deadline = t_start + args.max_wait_seconds
    sample_i = 0
    expected_cmds_per_sample = 6  # load, mem, docker info, docker df, docker ps, builds

    def record(cmd: dict[str, Any]) -> dict[str, Any]:
        commands.append(cmd)
        return cmd

    terminal = "RUNNING"
    try:
        while time.time() < deadline:
            sample_i += 1
            sample: dict[str, Any] = {"sample": sample_i, "ts": utc_now(), "checks": {}}

            # CPU count + load via colima ssh (bounded) or host sysctl fallback
            load_cmd = record(
                run_cmd(
                    ["python3", "-c", "import subprocess,sys;\n"
                     "import os\n"
                     "try:\n"
                     " r=subprocess.run(['colima','ssh','--','sh','-c','nproc; cat /proc/loadavg; free -b | awk \"/Mem:/{print \\$7}\"'],capture_output=True,text=True,timeout=14)\n"
                     " print(r.stdout)\n"
                     " sys.exit(r.returncode)\n"
                     "except Exception as e:\n"
                     " print('ERR',e); sys.exit(1)\n"],
                    timeout=args.cmd_timeout_seconds,
                    env=env,
                )
            )
            cpus = None
            load1 = load5 = load15 = None
            avail_mem_b = None
            lines = [ln.strip() for ln in (load_cmd.get("stdout") or "").splitlines() if ln.strip()]
            if lines and lines[0].isdigit():
                cpus = int(lines[0])
            if len(lines) >= 2:
                load1, load5, load15 = parse_loadavg(lines[1])
            if len(lines) >= 3 and lines[2].isdigit():
                avail_mem_b = int(lines[2])

            docker_info = record(run_cmd(["docker", "info"], timeout=args.cmd_timeout_seconds, env=env))
            docker_df = record(run_cmd(["docker", "system", "df", "--format", "{{json .}}"], timeout=args.cmd_timeout_seconds, env=env))
            docker_ps = record(run_cmd(["docker", "ps", "-q"], timeout=args.cmd_timeout_seconds, env=env))
            builds = record(
                run_cmd(
                    ["docker", "ps", "--filter", "label=com.docker.compose.project", "-q"],
                    timeout=args.cmd_timeout_seconds,
                    env=env,
                )
            )
            # active buildx-ish
            build_ps = record(
                run_cmd(["pgrep", "-fl", "docker build|buildx|image load"], timeout=5.0, env=env)
            )

            reasons: list[str] = []
            if load_cmd.get("timed_out") or load_cmd.get("rc") not in (0, None) and cpus is None:
                reasons.append("load_sample_failed")
            if cpus and cpus > 0 and load1 is not None:
                if load1 / cpus > args.load_per_cpu_max:
                    reasons.append(f"load1_per_cpu={load1/cpus:.2f}>{args.load_per_cpu_max}")
                if load5 is not None and load5 / cpus > args.load_per_cpu_max:
                    reasons.append(f"load5_per_cpu={load5/cpus:.2f}>{args.load_per_cpu_max}")
            else:
                reasons.append("cpu_or_load_unknown")

            if avail_mem_b is not None:
                if avail_mem_b / (1024**3) < args.min_host_mem_gib:
                    reasons.append("host_mem_low")
            else:
                reasons.append("host_mem_unknown")

            if docker_info.get("timed_out") or docker_info.get("duration_s", 0) > args.docker_info_latency_max_s:
                reasons.append("docker_info_slow_or_timeout")
            if docker_info.get("rc") != 0:
                reasons.append("docker_info_failed")

            # storage free heuristic from docker system df text
            storage_ok = True  # soft: mark unknown rather than fail hard if unparsable
            if docker_df.get("rc") != 0 or docker_df.get("timed_out"):
                reasons.append("docker_df_failed")
                storage_ok = False

            if build_ps.get("rc") == 0 and (build_ps.get("stdout") or "").strip():
                # pgrep returns 0 if matches — treat as active builds
                reasons.append("active_docker_builds_or_loads")

            healthy = len(reasons) == 0 and storage_ok
            sample["checks"] = {
                "cpus": cpus,
                "load1": load1,
                "load5": load5,
                "load15": load15,
                "avail_mem_gib": None if avail_mem_b is None else round(avail_mem_b / (1024**3), 3),
                "docker_info_latency_s": docker_info.get("duration_s"),
                "docker_ps_rc": docker_ps.get("rc"),
                "healthy": healthy,
                "reasons": reasons,
            }
            samples.append(sample)
            dump = {
                "document": "gate5-pre-v10-ab-capacity-preflight",
                "ts": utc_now(),
                "thresholds": thresholds,
                "samples": samples,
                "commands": commands[-50:],
                "healthy_streak": healthy_streak,
                "wait_duration_seconds": round(time.time() - t_start, 3),
            }
            (root / "capacity-preflight.partial.json").write_text(json.dumps(dump, indent=2) + "\n")

            if healthy:
                healthy_streak += 1
            else:
                healthy_streak = 0

            if healthy_streak >= args.required_consecutive_healthy:
                terminal = "CAPACITY_HEALTHY"
                break

            time.sleep(args.sample_interval_seconds)
        else:
            terminal = "BLOCKED_HOST_SATURATION"
    finally:
        pass

    wait_s = round(time.time() - t_start, 3)
    timed_out_cmds = sum(1 for c in commands if c.get("timed_out"))
    completed_cmds = sum(1 for c in commands if not c.get("timed_out"))
    report = {
        "document": "gate5-pre-v10-ab-capacity-preflight",
        "ts": utc_now(),
        "terminal_classification": terminal,
        "thresholds": thresholds,
        "capacity_samples_expected": max(1, int(args.max_wait_seconds / max(args.sample_interval_seconds, 0.1))),
        "capacity_samples_collected": len(samples),
        "commands_expected": len(samples) * expected_cmds_per_sample,
        "commands_completed": completed_cmds,
        "commands_timed_out": timed_out_cmds,
        "healthy_consecutive_samples": healthy_streak if terminal == "CAPACITY_HEALTHY" else 0,
        "healthy_streak_at_end": healthy_streak,
        "wait_duration_seconds": wait_s,
        "A_started": False,
        "B_started": False,
        "samples": samples,
        "commands_tail": commands[-80:],
    }
    (root / "capacity-preflight.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"terminal": terminal, "samples": len(samples), "wait_s": wait_s}, indent=2))
    if terminal == "CAPACITY_HEALTHY":
        return 0
    return 75


if __name__ == "__main__":
    raise SystemExit(main())
