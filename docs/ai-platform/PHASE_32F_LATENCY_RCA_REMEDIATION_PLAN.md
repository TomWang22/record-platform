# Phase 32F — Latency Outlier RCA Remediation Plan

```text
Phase 32F: PASS — RCA narrowed, long-soak instrumentation required
Max outlier explained: NO
Production enablement: NOT APPROVED
Controlled real inference: RUN (32D/32E micro-soaks; 31D-R2 historical evidence)
Production/live eval: NOT RUN
```

## RCA conclusion from 32B / 32D / 32E

| Phase | Finding |
| ----- | ------- |
| **32B** | CLASSIFIED original ~1,037,645 ms outlier from 31D-R2 JSONL, but attribution incomplete (`rag_total_ms` only) |
| **32D** | Timing-attributed 3888-probe micro-soak PASS; 17-minute outlier **NOT reproduced** (max wall ~9.3s/protocol) |
| **32E** | Slow/failing KPI write durability PASS; KPI writes are **fail-open** |

**Current verdict:** KPI write path is **unlikely root cause**.

**Max outlier explained:** **NO** — no component clearly accounts for ~1,037,645 ms.

**Production enablement:** **NOT APPROVED** — do not claim production-ready while max-latency RCA is unresolved.

## Likely root causes excluded

| Suspect | Status |
| ------- | ------ |
| KPI write path blocking RAG | **Excluded** (32E fail-open PASS) |
| Production default / PERCENT rollout | **Excluded** (keyword default, PERCENT=0 throughout) |
| Preview lifecycle race (31K) | **Mitigated** (31L shared coordinator; 32D/32E clean) |
| Micro-soak repeat of 17-minute stall | **Excluded** (32D 3888/3888, 32E 3888/3888, no tier-1 outlier) |

## Remaining suspects (32G capture targets)

1. **Shard / process stall** — event-loop delay, CPU, RSS, probe gap since previous probe
2. **Coordinator lock / wait** — lock wait ms, stale lock recovery, lock owner protocol/pid
3. **Network / curl start-transfer** — curl phase timings vs `time_starttransfer`
4. **App / server timing** — server-reported `rag_total_ms` vs client curl vs wall
5. **Monitor / restart gap** — shard restart count, monitor log correlation

## 32F instrumentation (stall capture)

Per-probe `timing` block extended with redacted stall-capture fields (null when unavailable):

```text
event_loop_delay_ms, process_cpu_user_ms, process_cpu_system_ms, rss_mb
coordinator_lock_wait_ms, coordinator_stale_lock_recovered
coordinator_lock_owner_protocol, coordinator_lock_owner_pid
child_process_spawn_ms
curl_exit_code, curl_error_class
curl_time_namelookup_ms … curl_time_total_ms
server_timing_rag_total_ms, server_timing_retrieval_total_ms, server_timing_kpi_query_write_ms
jsonl_flush_ms, probe_gap_since_previous_ms, shard_restart_count
```

Rules: all redacted; no prompt/response/JWT/private data; missing fields are null.

## Analyzer

Read-only over:

- `/tmp/phase31d-r2-repaired-staging-long-soak`
- `/tmp/phase32d-timing-attribution-micro-soak`
- `/tmp/phase32e-slow-kpi-write-durability`

Output: `/tmp/phase32f-latency-stall-analysis/`

## Next required step

**Phase 32G — timing-attributed repaired long soak** (no production enablement).

Do not start 32G until 32F PASS and explicit approval.
