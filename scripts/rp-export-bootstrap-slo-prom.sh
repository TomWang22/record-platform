#!/usr/bin/env bash
# Merge RP SLO/SLA gate results into bench_logs/rp_slo_sla_metrics.prom
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${RP_SLO_PROM_OUT:-$REPO_ROOT/bench_logs/rp_slo_sla_metrics.prom}"
mkdir -p "$(dirname "$OUT")"

APP_JSON="${RP_APP_RUNTIME_JSON:-$REPO_ROOT/bench_logs/app_runtime_latest.json}"
EDGE_JSON="${RP_EDGE_LATENCY_JSON:-$REPO_ROOT/bench_logs/rp_edge_route_latency.json}"
SLO_JSON="${RP_SLO_REPORT_JSON:-$REPO_ROOT/bench_logs/rp_slo_sla_report.json}"
WALL_JSON="${RP_WALL_JSON:-$REPO_ROOT/bench_logs/cold-bootstrap-last-timing.json}"

python3 - "$OUT" "$APP_JSON" "$EDGE_JSON" "$SLO_JSON" "$WALL_JSON" <<'PY'
import json, os, sys

out_path, app_p, edge_p, slo_p, wall_p = sys.argv[1:6]
lines = [
    "# HELP rp_slo_gate_passed 1 when SLO gate passed for this bootstrap run.",
    "# TYPE rp_slo_gate_passed gauge",
]

def load(path):
    if not path or not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as f:
        raw = f.read().strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Recover from accidental stdout+file double-write (first line only).
        first = raw.splitlines()[0].strip()
        return json.loads(first) if first else {}

slo = load(slo_p)
gates = slo.get("gates") or {}
for gate, val in gates.items():
    v = 1 if val in (True, 1, "1", "true") else 0
    g = gate.replace('"', '\\"')
    lines.append(f'rp_slo_gate_passed{{gate="{g}"}} {v}')

app = load(app_p)
lat = app.get("latency_percentiles_ms") or {}
for q in ("p50", "p95", "p99", "p100"):
    if q in lat:
        lines.append(f'rp_app_runtime_latency_ms{{quantile="{q}"}} {int(lat[q])}')
cp = app.get("critical_path_ms")
if cp is not None:
    lines.append(f"rp_app_runtime_critical_path_ms {int(cp)}")

edge = load(edge_p)
elat = edge.get("latency_percentiles_ms") or {}
for route in edge.get("routes") or []:
    r = route.get("route", "")
    ms = route.get("latency_ms", 0)
    if r:
        esc = r.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'rp_edge_route_latency_ms{{route="{esc}",quantile="p100"}} {int(ms)}')
for q in ("p50", "p95", "p99", "p100"):
    if q in elat:
        lines.append(f'rp_edge_route_latency_ms{{route="_aggregate",quantile="{q}"}} {int(elat[q])}')

wall = load(wall_p)
dur_ms = wall.get("duration_ms")
if dur_ms is not None:
    lines.append(f"rp_bootstrap_wall_clock_seconds {float(dur_ms) / 1000.0:.3f}")

phase_path = os.path.join(os.path.dirname(out_path), "bootstrap_phase_timings.json")
if os.path.isfile(phase_path):
    with open(phase_path, encoding="utf-8") as f:
        phases = json.load(f)
    for phase, ms in phases.items():
        if not isinstance(ms, (int, float)):
            continue
        esc = str(phase).replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'rp_bootstrap_phase_duration_seconds{{phase="{esc}"}} {float(ms) / 1000.0:.3f}')

with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(out_path)
PY
