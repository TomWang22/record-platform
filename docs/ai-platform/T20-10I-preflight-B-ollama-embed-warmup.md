# T20.10I-preflight-B — Ollama embed warmup gate

**Purpose:** Benchmark/provider readiness only. Does not change keyword retrieval, shadow timeout defaults, or vector rollout.

## Problem

Ollama `nomic-embed-text` cold-load takes **12–20s** while shadow embed timeout is **5000ms**. Benchmarks run during cold-load produce invalid results (`embed_timed_out` on all shadow runs).

Warm path embed latency is **121–1679ms** — acceptable once the model is loaded.

## Script

`scripts/rp-ai-ollama-embed-warmup.sh`

### Behavior

1. Calls Ollama `/api/embed` via cluster path (default: `kubectl exec` into `python-ai-service`)
2. Uses static warmup text: `record platform seller offer summary warmup`
3. Requires **3 consecutive** successful embeds each **≤ 2000ms**
4. Up to **12** attempts, **25s** per-attempt timeout
5. Exit **0** when warm; non-zero otherwise

### Environment

| Variable | Default |
|----------|---------|
| `OLLAMA_BASE_URL` | `http://ollama.record-platform.svc.cluster.local:11434` |
| `AI_EMBEDDING_MODEL` | `nomic-embed-text` |
| `OLLAMA_WARMUP_MAX_ATTEMPTS` | `12` |
| `OLLAMA_WARMUP_TARGET_MS` | `2000` |
| `OLLAMA_WARMUP_CONSECUTIVE` | `3` |
| `OLLAMA_WARMUP_TIMEOUT_SEC` | `25` |
| `OLLAMA_WARMUP_VIA_POD` | `auto` |

## Usage

### Standalone warmup

```bash
bash scripts/rp-ai-ollama-embed-warmup.sh
```

### Before shadow benchmark (recommended)

```bash
BENCH_REQUIRE_OLLAMA_WARM=1 \
BENCH_WARMUP_RUNS=1 \
BENCH_WORKER_WARMUP_RUNS=4 \
bash scripts/rp-ai-shadow-real-query-timing.sh
```

## Benchmark discipline

```text
warm provider first → confirm python-ai Ready → then measure retrieval quality
```

Do **not** raise committed shadow embed timeout to mask cold starts.

## Commit policy

- Commit this warmup gate script/doc when tested.
- **Do not** commit T20.10I ranking/warmup product code until a valid live benchmark exists.
