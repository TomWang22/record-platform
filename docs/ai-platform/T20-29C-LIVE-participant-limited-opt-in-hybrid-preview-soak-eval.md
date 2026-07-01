# T20.29C-LIVE — Participant-limited opt-in hybrid preview soak eval

**Status:** Live soak **PASS**  
**Generated:** 2026-07-01  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`  
**Artifact:** `bench_logs/ai-platform/t20-29c-participant-eval/20260701-162537/summary.json`

---

## 1. Participant matrix

| Dimension | Value |
|-----------|-------|
| Participants | **12 JWT** (1 allowlist + 11 opt-in) |
| Windows | 4 |
| Runs / user / window | 5 |
| Cases / run | 9 |
| **Total** | **2160** |

Enrollment: API bulk per window (UI enroll/revoke verified in Playwright). Rate-limit retry/backoff enabled for 12-user load.

## 2. Results

| Gate | Result | Threshold |
|------|--------|-----------|
| HTTP 200 | **2160/2160** | 100% **PASS** |
| Fallback | **0%** | ≤1% **PASS** |
| `final_tagged_plan` fallback | **0** | 0 **PASS** |
| Avg quality | **4.0** | ≥3.5 **PASS** |
| Worst quality | **4.0** | ≥3.0 **PASS** |
| Hybrid p95 | **175.94 ms** | ≤3000 ms **PASS** |
| Canary errors | **0** | 0 **PASS** |
| Telemetry WARNs | **0** | 0 **PASS** |
| Leakage | **PASS** | **PASS** |
| OCH | **PASS** | **PASS** |
| Playwright | **PASS** | **PASS** |
| PERCENT | **0** | **PASS** |
| Guest hidden / no message bodies | **PASS** | **PASS** |
| Post-revoke `keyword_default` | **PASS** | **PASS** |

### `gate_reason` counts

| `gate_reason` | Count |
|---------------|------:|
| `allowlist` | 180 |
| `preview_opt_in` | 1980 |

## 3. Post-eval revoke

All 11 participant enrollments revoked; participants → `keyword` / `keyword_default`; contract → `hybrid_canary` / `allowlist`.

## 4. Supplementary shadow

| Script | Result |
|--------|--------|
| `rp-ai-shadow-real-query-timing.sh` | **PASS** |
| `rp-ai-shadow-source-diagnostic.sh` | **FAIL (20 issues)** — known non-blocking class |

Anchored overlap **16/16** class; pure **8/16** report-only.

## 5. Cumulative live

| Batch | Cases |
|-------|------:|
| D16→D28C | 4185/4185 |
| T20.29C | 2160/2160 |
| **Total** | **6345/6345** |

## 6. Verdict

```text
T20.29C-LIVE: PASS
T20.29D: AUTHORIZED
```
