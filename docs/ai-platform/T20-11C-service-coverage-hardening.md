# T20.11C — Service coverage hardening audit

**Generated:** 2026-06-25  
**Baseline SHA:** `e379a1e` (`chore(ci): dry wire node service coverage runners`)  
**Audit SHA:** see commit `docs(ci): document Phase 20 service coverage hardening`  
**Mode:** docs/audit only — no product behavior changes  
**Vector rollout:** NOT APPROVED

---

## Executive summary

- **T20.11 coverage hardening is complete** (T20.11A manifest extension → T20.11B dry-wire runners → T20.11C audit).
- **`python-ai-service` remains the only strict coverage gate** (`app/ai/*`, lines ≥90%).
- **Node services are enumerated and dry-wired but non-blocking** — 4 runnable, 13 skipped, all `strict_enabled: false`.
- **No product behavior changed** — coverage tooling and manifest only.
- **Vector rollout remains NOT APPROVED** — this ticket does not affect AI retrieval or rollout gates.

---

## T20.11 ticket chain

| Ticket | SHA | Summary |
|--------|-----|---------|
| **T20.11A** | `44a8902` | Extended manifest to 18 services (manifest v1.1); 5 new Node entries |
| **T20.11B** | `e379a1e` | Dry-wired `run-service-coverage.sh` for 4 Node services (manifest v1.2) |
| **T20.11C** | _(this doc)_ | Stability audit and closeout documentation |

---

## Final manifest state

| Metric | Value |
|--------|------:|
| manifest version | **1.2** |
| total services | **18** |
| strict services | **1** |
| non-strict Node services | **17** |
| dry-wired Node services | **4** |
| skipped Node services | **13** |

**Strict service:** `python-ai-service` only.

**Dry-wired Node services:** messaging, notification, trust, media (`run_command` set, `strict_enabled: false`).

**Skipped Node services (13):** auth, records, cron-jobs, event-layer-verification, listings, shopping, transport-watchdog, analytics, auction-monitor, api-gateway, common, ollama-gateway, ollama-worker — each has explicit `skip_reason` and `run_command: null`.

---

## Dry-wired Node services

Measured at audit time (`bash scripts/coverage/run-service-coverage.sh all`):

| Service | Coverage lines | Strict | Threshold (manifest) | Enforced |
|---------|---------------:|--------|---------------------:|----------|
| messaging-service | **45.82%** | false | 98% (not enforced) | SKIP |
| notification-service | **58.13%** | false | 98% (not enforced) | SKIP |
| trust-service | **57.68%** | false | 98% (not enforced) | SKIP |
| media-service | **71.95%** | false | 98% (not enforced) | SKIP |

Dry-wire line percentages are **informational only**. None of these services block CI via `enforce-service-coverage.mjs` while `strict_enabled=false`.

---

## Strict service

| Service | Coverage lines | Threshold | Status |
|---------|---------------:|----------:|--------|
| python-ai-service | **90.71%** | 90% (`app/ai/*`) | **PASS** |

---

## Enforcement result

Audit commands run at baseline `e379a1e`:

```bash
bash scripts/coverage/run-service-coverage.sh python-ai-service
bash scripts/coverage/run-service-coverage.sh all
node scripts/coverage/enforce-service-coverage.mjs
bash scripts/rp-rp-decontaminate-scan.sh
```

**`run-service-coverage.sh all` per-service:**

```text
SKIP auth-service — test:coverage not wired
SKIP records-service — test:coverage not wired
SKIP cron-jobs — no vitest coverage runner
SKIP event-layer-verification — test:coverage not wired
SKIP listings-service — test:coverage not wired
SKIP shopping-service — test:coverage not wired
SKIP transport-watchdog — test:coverage not wired
▶ coverage: messaging-service (dry-wire)
✅ coverage: messaging-service done — lines 45.82%
▶ coverage: notification-service (dry-wire)
✅ coverage: notification-service done — lines 58.13%
▶ coverage: trust-service (dry-wire)
✅ coverage: trust-service done — lines 57.68%
SKIP analytics-service — test:coverage not wired
▶ coverage: media-service (dry-wire)
✅ coverage: media-service done — lines 71.95%
SKIP auction-monitor — test:coverage not wired
SKIP api-gateway — test:coverage not wired
SKIP common — test:coverage not wired
SKIP ollama-gateway — no test suite
SKIP ollama-worker — no test suite
▶ coverage: python-ai-service (strict)
✅ coverage: python-ai-service done — lines 90.71%
```

**Summary lines:**

```text
run-service-coverage summary: manifest=18 run_ok=5 run_fail_non_strict=0 skip=13 strict_fail=0
enforce-service-coverage: 1 pass, 17 skip, 0 fail
```

**RP scan:** PASS.

---

## Stability audit findings

| Check | Result |
|-------|--------|
| python-ai strict gate unchanged | **PASS** — threshold 90%, scope `app/ai/*` |
| No Node `strict_enabled=true` | **PASS** — all 17 Node entries false |
| Dry-wire failures non-blocking | **PASS** — non-strict failures emit WARN only |
| Manifest enumerates all 18 services | **PASS** |
| `run-service-coverage.sh all` completes | **PASS** |
| Enforcer skips all Node services | **PASS** — dry-wire % shown when summary exists |
| Product / AI retrieval unchanged | **PASS** |
| Generated artifacts committed | **PASS** — none |

---

## Promotion rules for future Node strict mode

1. Add or stabilize `test:coverage` in the service `package.json`.
2. Ensure Vitest `json-summary` writes `services/<svc>/coverage/coverage-summary.json`.
3. Establish **per-service** initial thresholds (do not copy python-ai 90% blindly).
4. Flip `strict_enabled=true` only in an **explicit future ticket** per service (or small batch with approval).
5. **Do not** make all Node services strict at once.
6. **Never** lower the python-ai strict threshold to compensate for Node gaps.

---

## Final guardrails

- No retrieval changes.
- No vector rollout.
- No Phase 21.
- No `coverage/` output, `bench_logs/`, or other generated artifacts in commits.
- T20.12 embedding tranche work requires **explicit approval** (dry-run only until approved).

---

## Key references

| Document | Path |
|----------|------|
| T20.11A manifest extension | `docs/ai-platform/T20-11A-node-coverage-manifest-extension.md` |
| T20.11B dry-wire runners | `docs/ai-platform/T20-11B-node-coverage-runner-dry-wiring.md` |
| Manifest | `scripts/coverage/service-coverage-manifest.json` |
| Runner | `scripts/coverage/run-service-coverage.sh` |
| Enforcer | `scripts/coverage/enforce-service-coverage.mjs` |
| Phase 20 context | `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md` |
