# T20.11A — Node coverage manifest extension

**Generated:** 2026-06-25  
**Baseline SHA:** `33b99aa` (`docs(release): draft Phase 20 AI hardening notes`)  
**Implementation SHA:** see commit `chore(ci): extend service coverage manifest`  
**Mode:** coverage config/docs only — no product behavior changes

## Summary

Extended `scripts/coverage/service-coverage-manifest.json` to enumerate **all Node/TypeScript services** under `services/` that were missing from the manifest. Every newly added or existing Node entry remains **`strict_enabled: false`**. **`python-ai-service`** is unchanged as the **only strict service** (`app/ai/*`, ≥90% lines).

Node services are **enumerated but non-blocking** in `enforce-service-coverage.mjs`. Strict mode for Node services will be enabled in a later ticket (T20.11B+) only after `test:coverage` runners and CI wiring are complete.

---

## Manifest changes (T20.11A)

| Change | Detail |
|--------|--------|
| Version | `1` → `1.1` |
| Services before | 13 (12 Node + python-ai) |
| Services after | **18** (17 Node + python-ai) |
| New entries | `cron-jobs`, `event-layer-verification`, `ollama-gateway`, `ollama-worker`, `transport-watchdog` |
| `strict_enabled` on new entries | **all `false`** |
| python-ai strict gate | **unchanged** — `strict_enabled: true`, `threshold.lines: 90`, `coverage_include: app/ai` |

### New service entries

| Service | `run_command` | `skip_reason` |
|---------|---------------|---------------|
| `cron-jobs` | `null` | `no vitest coverage runner` |
| `event-layer-verification` | `null` | `test:coverage not wired` |
| `ollama-gateway` | `null` | `no test suite` |
| `ollama-worker` | `null` | `no test suite` |
| `transport-watchdog` | `null` | `test:coverage not wired` |

### Existing Node services (unchanged policy)

| Category | Services | `strict_enabled` |
|----------|----------|------------------|
| Not wired | auth, records, listings, shopping, analytics, auction-monitor, api-gateway, common | `false` |
| Runnable, non-strict | messaging, notification, trust, media | `false` |

### Strict service (unchanged)

| Service | Threshold | Scope |
|---------|-----------|-------|
| `python-ai-service` | lines ≥ **90%** | `app/ai/*` |

---

## Enforcement behavior

```bash
bash scripts/coverage/run-service-coverage.sh python-ai-service
node scripts/coverage/enforce-service-coverage.mjs
```

- **PASS** — only `python-ai-service` when summary meets threshold.
- **SKIP** — all Node services (`strict_enabled=false` or explicit `skip_reason`).
- No change to product `ci.yml`; coverage workflow remains separate (T20.6).

---

## Not in scope (T20.11A)

- Wiring `test:coverage` for unwired Node services (T20.11B track).
- Setting any Node service to `strict_enabled=true`.
- Lowering python-ai thresholds.
- AI retrieval, vector default, or Phase 21 work.

---

## Validation

| Check | Result |
|-------|--------|
| `run-service-coverage.sh python-ai-service` | PASS |
| `enforce-service-coverage.mjs` | 1 pass, 17 skip, 0 fail |
| `rp-och-decontaminate-scan.sh` | PASS |

---

## Next step

**T20.11B** — wire `test:coverage` runners for selected Node services (still `strict_enabled=false` until explicitly promoted).
