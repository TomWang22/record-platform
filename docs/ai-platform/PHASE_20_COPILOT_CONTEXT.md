# Phase 20 — Copilot / agent context (Record Platform AI)

**Last updated:** 2026-06-22  
**Current main SHA:** `108088653d0d0363440c58c969a4e01e1f2e53ef`  
**Audience:** GitHub Copilot, Cursor, and other coding agents working on `record-platform`

Use this document when continuing Phase 20 work. It replaces any deleted handoff notes.

---

## Locked takeaway (active Phase 20 state)

```text
T20.8 verdict: vector rollout NOT READY

Keep:
- keyword retrieval as production default
- AI_RAG_SHADOW_VECTOR=0
- vector retrieval shadow-only
- no EMBEDDING_BACKFILL_FORCE=1
- no broad/full embedding backfill
- no Phase 21
```

### Copilot-safe instruction

```md
Use @docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md as the source of truth.

Do not enable vector retrieval as production default. Do not start Phase 21.
Do not rerun Tranche 2. Do not use EMBEDDING_BACKFILL_FORCE=1.
Do not change keyword retrieval behavior.

Current T20.8 verdict is NOT READY:
- embedded coverage: 6.9% / 5,049 FAIL
- e2e OBO owner-visible embedded: 2 FAIL
- shadow p95: ~7.1s FAIL
- shadow-keyword overlap: 0 FAIL
- leakage: PASS
- keyword stability: PASS

Allowed work only with explicit approval:
- bounded new embedding tranche with fresh backup and dry-run
- shadow-only diagnostics/refinement
- coverage hardening without product behavior changes
```

---

## What this project is

**Record Platform** is a marketplace for vinyl records with listings, auctions, OBO (offers), messaging, notifications, and an **AI insights layer** (`python-ai-service`). The AI stack provides grounded RAG and structured insights over a `python_ai` Postgres corpus with pgvector embeddings.

**Critical invariant:** Production RAG uses **keyword retrieval**. Vector retrieval exists only as **shadow/diagnostic** tooling until explicit rollout approval.

---

## Phase history (locked vs active)

| Phase | Status | Summary |
|-------|--------|---------|
| **Phase 19** | **LOCKED** | Vector shadow routing: route profiles, weights, query hints, OBO corpus repair. Keyword default unchanged. Release: `docs/release/rp-ai-vector-shadow-routing-readiness-20260616.md` |
| **Phase 20** | **IN PROGRESS** | Hardening + bounded embedding growth + rollout readiness evaluation — **not** production vector flip |

### Phase 20 tickets completed

| Ticket | SHA era | What it did |
|--------|---------|-------------|
| **T20.6** | `655ffee` | CI/coverage hardening: `scripts/coverage/service-coverage-manifest.json`, runner/enforcer, python-ai pytest-cov ≥90% on `app/ai/*`, `.github/workflows/coverage.yml` |
| **T20.7** | `655ffee` (DB only) | Bounded **Tranche 2**: +500 embeddings (4,549 → 5,049). Caps: obo 150, listing 200, listing_revision 100, notification 50. Backup: `backups/rp-all-11-t20-tranche2-preflight` |
| **T20.7R** | `8633149` | Rerun guard hardening: lock blocks with **exit 2**; `--check-lock`; `scripts/rp-ai-backfill-rerun-guard-smoke.sh` |
| **T20.8** | `3aba170` | **Read-only** vector rollout readiness eval → **NOT READY** — `docs/ai-platform/T20-8-vector-rollout-readiness.md` |

### Phase 20 tickets NOT started (require explicit approval)

| Ticket | Scope |
|--------|-------|
| **T20.9** | Bounded Tranche 3 embeddings (dry-run plan only until approved) — `docs/ai-platform/T20-9-tranche3-dry-run-plan.md` |
| **T20.10+** | Shadow-only refinement (profiles/hints/diagnostics; no keyword changes) |
| **T20.11+** | Coverage manifest extension for Node services (`strict_enabled=false` until wired) |
| **T20.12+** | Production vector default / hybrid rollout — only after T20.3 thresholds pass |
| **Phase 21** | Not started; do not begin without explicit approval |

---

## Current system snapshot (2026-06-22)

| Metric | Value |
|--------|------:|
| Embedded chunks | **5,049** |
| Non-message chunks | 73,011 |
| Embedded coverage | **~6.9%** |
| Retrieval default | **keyword** |
| Vector default | **off** (`AI_RAG_SHADOW_VECTOR=0`) |
| python-ai coverage (strict) | **90.39%** lines on `app/ai/*` |
| Tranche 2 lock | `bench_logs/ai-platform/t20-tranche-2-actual-run.json` |
| Shadow latency p95 (hinted) | **~7.1s** (target for rollout ≤3s) |
| e2e-contract owner-visible OBO embedded | **2** (rollout target ≥10) |

### Embedded by source_type

| source_type | embedded |
|-------------|--------:|
| listing | 1,700 |
| obo_offer_summary | 952 |
| notification | 750 |
| listing_revision | 800 |
| record | 594 |
| auction_bid_summary | 253 |

---

## Hard rules for agents (do not violate)

1. **Do NOT** enable vector retrieval as production default without explicit approval and T20.3 thresholds passing.
2. **Do NOT** run broad/full corpus embedding backfill.
3. **Do NOT** set `EMBEDDING_BACKFILL_FORCE=1` unless ops explicitly approves (bypasses tranche lock).
4. **Do NOT** rerun actual Tranche 2 write — lock exists; blocked exit **2**.
5. **Do NOT** change product behavior (keyword path, API contracts, default env) as part of Phase 20 hardening/eval tickets.
6. **Do NOT** start Phase 21.
7. **Do NOT** commit: `bench_logs/`, `backups/`, screenshots, DB dumps, coverage output artifacts.
8. **Do** run `bash scripts/rp-och-decontaminate-scan.sh` before push; no OCH/housing/landlord/tenant contamination in committed text.
9. **Pipefail trap:** When testing script exit codes, run **directly** — never pipe to `tail` without `set -o pipefail` (T20.7R lesson).

---

## Architecture: retrieval paths

```
POST /api/ai/rag/query
  └─> insights.rag_query()  [keyword default]
        └─> retrieve_chunks()           ← PRODUCTION
        └─> retrieve_chunks_vector_shadow()  ← ONLY if shadow_vector=true (diagnostic)
```

**Key files:**

| File | Role |
|------|------|
| `services/python-ai-service/app/ai/rag_retrieval.py` | Keyword + shadow vector retrieval, privacy filters |
| `services/python-ai-service/app/ai/shadow_profiles.py` | Route profiles, weights, query hints |
| `services/python-ai-service/app/ai/insights.py` | Insight builders; keyword path unchanged |
| `services/python-ai-service/app/ai/routes.py` | HTTP routes; `shadow_vector`, `shadow_profile`, `shadow_query_hints` query params |
| `services/python-ai-service/app/ai/config.py` | `AI_RAG_SHADOW_VECTOR` default `0` |

**Privacy:** Owner-scoped docs, no message bodies without opt-in, `FORBIDDEN_CHUNK_RE` blocks proxy max leakage.

---

## Embedding operations

**Script:** `scripts/rp-ai-embedding-backfill-controlled.sh`

| Env | Purpose |
|-----|---------|
| `EMBEDDING_BACKFILL_TRANCHE_ID` | Tranche id; writes lock on actual run |
| `EMBEDDING_BACKFILL_DRY_RUN=1` | Plan only |
| `EMBEDDING_BACKFILL_TOTAL_LIMIT` / `MAX_NEW` | Hard cap on new embeddings |
| `EMBEDDING_BACKFILL_PER_TYPE_LIMITS` | Per source_type caps |
| `EMBEDDING_BACKFILL_FORCE=1` | **Ops only** — bypass lock |

**Exit codes:** `0` success · `1` failure · `2` tranche lock blocked

**Helpers:**

- `bash scripts/rp-ai-embedding-backfill-controlled.sh --check-lock t20-tranche-2`
- `bash scripts/rp-ai-backfill-rerun-guard-smoke.sh`

**Backup before any new tranche:**

```bash
PGPASSWORD=postgres PG_DUMP_JOBS=4 BACKUP_TIMESTAMP=<label> \
  bash scripts/backup-rp-postgres-dbs.sh
```

---

## Coverage system (T20.6)

| Path | Role |
|------|------|
| `scripts/coverage/service-coverage-manifest.json` | Per-service thresholds; only `python-ai-service` has `strict_enabled=true` (90% lines, `app/ai/*`) |
| `scripts/coverage/run-service-coverage.sh` | Run one or all services |
| `scripts/coverage/enforce-service-coverage.mjs` | Fail only strict services; others print `SKIP` |
| `.github/workflows/coverage.yml` | Separate from product `ci.yml` |

```bash
bash scripts/coverage/run-service-coverage.sh python-ai-service
node scripts/coverage/enforce-service-coverage.mjs
```

---

## Gate scripts (common verification bundle)

### AI / RAG

```bash
bash scripts/rp-ai-shadow-source-diagnostic.sh      # shadow quality (read-only)
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-pgvector-readiness.sh
bash scripts/rp-ai-backfill-rerun-guard-smoke.sh  # after tranche work
```

### Platform

```bash
bash scripts/rp-runtime-domain-comb.sh
bash scripts/rp-db-domain-comb.sh                 # slow (~30–80 min)
bash scripts/rp-och-decontaminate-scan.sh
bash scripts/rp-bootstrap-grpc-mtls-gate.sh       # slow (~20–50 min)
CLUSTER_DOCTOR_STRICT=1 make cluster-doctor
```

---

## Contract users (auth DB / tests)

| Role | Email | User UUID |
|------|-------|-----------|
| e2e contract | `e2e-contract@record-platform.local` | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |
| buyer | (see gate scripts) | `5a68fe88-c134-4166-b145-57534a3656b9` |
| seller | | `b4ae4fcc-a2ad-4ec4-9ba6-81ea736bc018` |

Edge: `https://record-platform.test` with strict TLS (`certs/dev-chain.pem`).

---

## Vector rollout thresholds (T20.3 / T20.8)

Production vector default requires **all** of:

| Requirement | Target | Current (2026-06-22) |
|-------------|--------|------------------------|
| Embedded coverage | ≥15% **or** ≥10k chunks | 6.9% / 5,049 — **FAIL** |
| Shadow source diversity | ≥5 types | 6 — **PASS** |
| Owner-visible OBO (e2e) | ≥10 | 2 — **FAIL** |
| Shadow p95 latency | ≤3s | ~7.1s — **FAIL** |
| Leakage | 0 | 0 — **PASS** |
| Keyword stability | unchanged | stable — **PASS** |
| Quality parity | meaningful shadow/keyword overlap | 0 overlap — **FAIL** |

**Verdict:** hold keyword default; T20.8 evaluation complete.

---

## Recommended sequencing (what to do next)

Best next **safe** workstreams — **only with explicit approval**:

1. **New bounded embedding tranche (T20.9)** — new tranche id, fresh backup, dry-run first, caps only; never rerun `t20-tranche-2`; no `EMBEDDING_BACKFILL_FORCE=1`. See `docs/ai-platform/T20-9-tranche3-dry-run-plan.md`.
2. **Shadow-only refinement (T20.10)** — improve `shadow_profiles.py` / query hints / diagnostics; no keyword or API contract changes.
3. **Coverage hardening (T20.11)** — extend manifest for more services; keep `strict_enabled=false` until wired; preserve python-ai strict 90% gate.

Refusal rules:

1. **If asked to "enable vector"** → refuse until T20.3 thresholds pass; cite `docs/ai-platform/T20-8-vector-rollout-readiness.md`.
2. **If rerunning Tranche 2** → refuse; lock exists (exit **2**).
3. **Before any push** → OCH scan, strip Co-authored trailers if needed, no `bench_logs/` in commit.

---

## Key references

| Document | Path |
|----------|------|
| **This handoff (source of truth)** | `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md` |
| T20.8 rollout eval (committed) | `docs/ai-platform/T20-8-vector-rollout-readiness.md` |
| T20.8 rollout eval (local run artifact) | `bench_logs/ai-platform/t20-8-vector-rollout-readiness.md` |
| T20.9 Tranche 3 dry-run plan | `docs/ai-platform/T20-9-tranche3-dry-run-plan.md` |
| Phase 20 planning | `bench_logs/ai-platform/phase-20-next-step-planning.md` |
| Phase 19 release | `docs/release/rp-ai-vector-shadow-routing-readiness-20260616.md` |
| AI contracts | `docs/ai-platform/rp-ai-contracts.md` |
| Coverage manifest | `scripts/coverage/service-coverage-manifest.json` |
| Tranche 2 proof | `bench_logs/ai-platform/t20-7-tranche2-embedding-proof.md` |
| Rerun guard smoke | `bench_logs/ai-platform/t20-7r-backfill-rerun-guard-smoke.md` |

---

## Commit message style

Recent Phase 20 commits:

- `chore(ci): add service coverage hardening gates` (T20.6)
- `chore(ai): harden embedding tranche rerun guard` (T20.7R)
- `docs(ai): add Phase 20 copilot context and T20.8 rollout eval` (T20.8)

Do not commit DB-only embedding changes. Docs like this file **should** be committed when updated.
