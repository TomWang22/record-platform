# T20.13E — Diagnostic embed warmup/retry

**Baseline:** `bd2b607`  
**Scope:** Diagnostic harness/scripts only — no product route, retrieval, env default, DB, or rollout changes.

## Problem

T20.13D showed shadow diagnostics blocked by `embed_timeout_before_fetch` (7/7 flags off/on). Request errors were 0; true retrieval zero-results were 0. Candidate fetch never ran because embed timed out first.

## Implementation (T20.13B Options A+B)

### CLI flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--embed-warmup-runs N` | 3 | Consecutive successful embed probes required before shadow cases |
| `--embed-warmup-threshold-ms M` | 2000 | Max latency per warmup probe |
| `--embed-retry-on-timeout N` | 1 | Shadow retries after short warmup probe on embed timeout |
| `--embed-timeout-ms M` | 5000 | Harness classification threshold (not app config) |
| `--no-embed-warmup` | off | Escape hatch — skip pre-shadow gate |

### Behavior

1. **Keyword production** runs first (unchanged).
2. **Embed warmup gate** (`scripts/rp-ai-ollama-embed-warmup.sh`) runs before shadow diagnostics.
3. If warmup fails, shadow cases are marked `embed_warmup_failed` (not `true_zero_result`).
4. Per shadow case: on embed timeout, one retry after a single-probe warmup.
5. Overlap flags reset to `0/0` after flagged mode.

### Telemetry fields

Summary JSON `embed_warmup` block plus per-mode:

- `embed_warmup_enabled`, `embed_warmup_runs_requested`, `embed_warmup_runs_passed`
- `embed_warmup_threshold_ms`, `embed_warmup_p50_ms`, `embed_warmup_p95_ms`
- `embed_retry_on_timeout`, `embed_retry_attempted`, `embed_retry_succeeded`
- `embed_timeout_before_fetch`, `true_zero_results`, `shadow_fetch_attempted`

### Files

- `scripts/rp-ai-live-inference-transcript.sh`
- `scripts/rp-ai-live-inference-transcript.py`
- `scripts/rp-ai-live-inference-telemetry.py`

## Validation

```bash
bash -n scripts/rp-ai-live-inference-transcript.sh
python3 scripts/rp-ai-live-inference-telemetry.py --self-test
bash scripts/rp-ai-live-inference-transcript.sh \
  --embed-warmup-runs 3 \
  --embed-warmup-threshold-ms 2000 \
  --embed-retry-on-timeout 1
```

Vector rollout: **NOT APPROVED**. Phase 21: **not started**.
