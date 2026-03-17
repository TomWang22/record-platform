# Preflight / Colima Handoff Report

**Date:** 2026-02-08  
**For:** Handoff to another engineer or future run

**Single report to send to an AI or teammate:** **`docs/PREFLIGHT_REPORT_FOR_AI.md`** — One self-contained document with RCA, current situation, what still breaks, MetalLB, ADRs, tuning, and all commands. Copy or send that file as-is.

---

## What was done on your behalf

1. **Colima status**  
   Colima was already running (default profile, docker+k3s). If you see “Colima is not running” from the tuning script, run:
   ```bash
   colima start --with-kubernetes
   ```
   The tuning script was updated to detect “running” correctly via `colima status 2>&1 | grep -qi running` (Colima prints status to stderr).

2. **k3s/etcd tuning applied**  
   Ran:
   ```bash
   ./scripts/apply-k3s-etcd-tuning.sh
   ```
   Result: drop-in config written in the Colima VM at `/etc/rancher/k3s/config.yaml.d/50-control-plane-stabilization.yaml`, k3s restarted, API server ready after ~10s. This reduces API stalls and connection resets during reissue and applies.

3. **Diagnostic report generated**  
   Full preflight diagnostic was written to:
   ```text
   preflight-diagnostic-20260207-200410.txt
   ```
   (Exact filename may vary; look for `preflight-diagnostic-*.txt` in the repo root.)  
   It includes: Kubernetes context, API/nodes, namespaces, pods, Docker containers, MetalLB, Caddy service, observability pods, relevant script paths, and “how to run” commands.

---

## Current state (from the diagnostic run)

- **Context:** colima  
- **API:** 127.0.0.1:6443 reachable  
- **Node:** colima Ready (v1.33.4+k3s1)  
- **Caddy:** NodePort 443:30443 (no MetalLB in use for core preflight)  
- **Note:** Some `test-reset-debug-*` namespaces are Terminating; safe to ignore or delete. MetalLB webhook had no endpoints in the snapshot (only relevant if you enable MetalLB).

---

## What you (or the other person) should do next

### Run full preflight and capture log

```bash
cd /path/to/record-platform
LOG="preflight-full-$(date +%Y%m%d-%H%M%S).log"
METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"
```

### If anything fails: get an explanation

```bash
./scripts/generate-preflight-failure-report.sh "$LOG"
```

That prints a short report: what failed (reissue, Kafka SSL, applies, scale, Caddy verify) and what to do.

### Key docs for “what’s really going on”

- **docs/PREFLIGHT_RUN_ANALYSIS.md** — Run analysis: this run vs good run (preflight-full-20260206-215733.log), how to get a good run (flock, MetalLB off, save log), MetalLB vs control-plane limit.
- **docs/PREFLIGHT_FORENSIC_BREAKDOWN_20260207.md** — Forensic breakdown for 2026-02-07 run: apply immutable-type failure, fix (Opaque), control-plane telemetry (how to capture pressure; /metrics in-flight and duration).
- **docs/PREFLIGHT_RUN_PACKAGE_20260207-212034.md** — **Full run package:** log summary, pressure (telemetry during run), raw metrics excerpt, strict TLS/mTLS (what is verified and status), analysis, explanation. Single MD for AI or handoff.
- **docs/CONTROL_PLANE_TELEMETRY.md** — How to capture all control-plane telemetry (readyz, healthz, top, /metrics); script: **scripts/capture-control-plane-telemetry.sh**.
- **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md** — **RCA:** symptoms, root cause, evidence, mitigations (including **etcd tuning**), **current situation**, **what still breaks in detail**, and **MetalLB** (opt-in, webhook/endpoints, when to use). Primary reference for handoff and deep dive.
- **docs/PREFLIGHT_ROOT_CAUSE_AND_FIXES.md** — Short "what's going on" and what to do when it breaks again.
- **docs/PREFLIGHT_AND_DIAGNOSTICS.md** — Full flow: start Colima → tuning → preflight with tee → failure report → optional full diagnostic.
- **docs/COLIMA_K3S_TUNING.md** — What we tuned (etcd + kube-apiserver values) and how (script vs Colima config).
- **docs/adr/005-control-plane-is-rate-limited.md** — Control plane rate-limited; MetalLB opt-in.
- **docs/adr/006-colima-k3s-etcd-tuning.md** — Decision to apply etcd/k3s tuning via script.
- **Runbook.md** item 32 — Connection reset / apiserver not ready playbook.

---

## One-line summary

Colima was running; k3s/etcd tuning was applied successfully; full diagnostic report was saved to `preflight-diagnostic-*.txt`. Next: run preflight with the command above, tee to a log, then run `generate-preflight-failure-report.sh` on that log if anything fails. Use **docs/PREFLIGHT_ROOT_CAUSE_AND_FIXES.md** to understand and fix recurring issues.
