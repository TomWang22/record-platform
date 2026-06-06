# Preflight phase / barrier equivalence (static)

**Primary script:** `scripts/run-preflight-scale-and-all-suites.sh`

_Scan bundle includes:_ `scripts/cluster-stability-guard.sh`, `scripts/phase-barrier.sh`, `scripts/run-transport-study-experiments.sh`, `scripts/preflight-controlled-transport-otel-prove.sh` when present.

| Invariant | Description | Result |
|-------------|-------------|--------|
| `preflight_invokes_cluster_guard` | Preflight wires cluster stability guard | **PASS** |
| `cpu_idle_min_logic` | CPU idle threshold logic | **PASS** |
| `mem_free_guard` | Memory free / headroom guard | **PASS** |
| `node_readiness` | Node readiness / node set discovery | **PASS** |
| `phase_barrier_script` | Phase barrier script invocation | **PASS** |
| `kafka_alignment` | Kafka alignment suite | **PASS** |
| `jaeger_gate` | Jaeger / trace / Step7 wiring | **PASS** |
| `quic_transport` | QUIC / transport proof hooks | **PASS** |
| `strict_errexit` | Strict `set -euo pipefail` on preflight entry | **PASS** |
| `strict_exit_flag` | Strict exit flag documented / used | **PASS** |
| `chaos_optional` | Optional chaos / stochastic hooks | **PASS** |
| `adaptive_single_multi` | Adaptive single- vs multi-node thresholds | **PASS** |
| `step7_strict_docs` | Step 7 and `PREFLIGHT_STRICT_EXIT` both present in scan bundle | **PASS** |
| `transport_study_set_plus_e_scoped` | `set +e` around transport study only with inner `set -euo pipefail` subshell | **PASS** |

**Summary:** 14/14 passed; **0** failed (heuristic).
