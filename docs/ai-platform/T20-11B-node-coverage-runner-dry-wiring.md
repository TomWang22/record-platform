# T20.11B — Node coverage runner dry-wiring

**Generated:** 2026-06-25  
**Baseline SHA:** `44a8902` (`chore(ci): extend service coverage manifest`)  
**Implementation SHA:** see commit `chore(ci): dry wire node service coverage runners`  
**Mode:** coverage tooling only — no product behavior changes

## Summary

Dry-wired `run-service-coverage.sh` to execute Vitest `test:coverage` for Node services that have manifest `run_command` entries, while keeping **every Node service `strict_enabled: false`**. **`python-ai-service`** remains the **only strict gate**.

Node coverage runs are **informational / dry-wired** — failures on non-strict services are reported as `WARN` and do not fail the script. Promotion to `strict_enabled=true` is a **future explicit ticket** (not T20.11B).

---

## Manifest

| Item | Value |
|------|-------|
| Version | `1.1` → **`1.2`** |
| Total services | **18** |
| Strict services | **1** (`python-ai-service`, lines ≥90%, `app/ai/*`) |
| Dry-wired Node (`run_command` set) | **4** |

### Dry-wired Node services (T20.11B)

| Service | `run_command` | `strict_enabled` |
|---------|---------------|------------------|
| `messaging-service` | `pnpm -C services/messaging-service run test:coverage` | `false` | ~45.8% lines (dry-wire) |
| `notification-service` | `pnpm -C services/notification-service run test:coverage` | `false` | ~58.1% lines (dry-wire) |
| `trust-service` | `pnpm -C services/trust-service run test:coverage` | `false` | ~57.7% lines (dry-wire) |
| `media-service` | `pnpm -C services/media-service run test:coverage` | `false` | ~72.0% lines (dry-wire) |

All other Node entries remain `run_command: null` with explicit `skip_reason`.

---

## Runner behavior (`run-service-coverage.sh`)

| Input | Behavior |
|-------|----------|
| (no arg) or `all` | Enumerate all **18** manifest services |
| `<service-name>` | Run one service; strict failure exits non-zero |
| `run_command` null | `SKIP` with `skip_reason` |
| `test:coverage` missing in `package.json` | `SKIP` (manifest/runner mismatch guard) |
| Non-strict run failure | `WARN` + continue |
| Strict run failure | `FAIL` + exit **1** at end |

End-of-run summary line:

```text
run-service-coverage summary: manifest=18 run_ok=N run_fail_non_strict=N skip=N strict_fail=N
```

---

## Enforcer behavior (`enforce-service-coverage.mjs`)

| Service type | Result |
|--------------|--------|
| `strict_enabled: true` (python-ai) | **PASS** or **FAIL** on threshold |
| `strict_enabled: false` (all Node) | **SKIP** — non-blocking |

When a dry-wired Node summary exists on disk, SKIP lines include informational line %:

```text
SKIP messaging-service — strict_enabled=false (dry-wire summary: lines 64.39%)
```

No Node service can fail enforcement while `strict_enabled=false`.

---

## Validation

```bash
bash scripts/coverage/run-service-coverage.sh python-ai-service
bash scripts/coverage/run-service-coverage.sh all
node scripts/coverage/enforce-service-coverage.mjs
bash scripts/rp-och-decontaminate-scan.sh
```

---

## Not in scope

- Setting any Node service to `strict_enabled=true`.
- Lowering python-ai thresholds.
- Product code, AI retrieval, vector default, or Phase 21 work.
- Committing `coverage/` output artifacts.

---

## Next step

**T20.11C** — coverage docs/stability audit across dry-wired runners and manifest/enforcer consistency.
