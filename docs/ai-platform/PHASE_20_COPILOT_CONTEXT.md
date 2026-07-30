# Phase 20 — Copilot / agent context (Record Platform AI)

**Last updated:** 2026-06-26 (T20.13K post-synthesis closeout)  
**Current main SHA:** `066ef6e` (verify at commit time)  
**Phase 20 status:** **HARDENING CLOSED** — embedding tranche ops allowed only with explicit approval per tranche; **≥10k count gate complete**  
**Audience:** GitHub Copilot, Cursor, and other coding agents working on `record-platform`

Use this document when continuing Phase 20 work. It replaces any deleted handoff notes.

---

## Locked takeaway (active Phase 20 state)

```text
Vector rollout: NOT APPROVED / NOT READY

Keep:
- keyword retrieval as production default
- AI_RAG_SHADOW_VECTOR=0
- vector retrieval shadow-only
- overlap refinement flags default off:
  - AI_RAG_SHADOW_ENTITY_HINTS=0
  - AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0
- no EMBEDDING_BACKFILL_FORCE=1
- no broad/full embedding backfill
- no Phase 21
- keyword RAG synthesis via rag_synthesis.py (T20.13I) — rule-engine templates, not generative default
```

### Copilot-safe instruction

```md
Use @docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md as the source of truth.

Do not enable vector retrieval as production default. Do not start Phase 21.
Do not rerun Tranche 2. Do not use EMBEDDING_BACKFILL_FORCE=1.
Do not change keyword retrieval behavior.
Do not enable overlap refinement flags by default.

Vector rollout: NOT APPROVED / NOT READY:
- embedded coverage: 13.8% / 10,065 — **≥10k count PASS**; **≥15% FAIL**
- keyword answer quality: **3.6/5** (T20.13J) — **PASS** target ≥3.5
- source diversity: 6 PASS
- owner-visible OBO embedded: 18 PASS (total embedded OBO: 1,544)
- shadow p95: **8–10s** recent warmed runs — **FAIL** (rollout-blocking)
- embed warmup (T20.13E): 7/7 → 0/7 embed_timeout_before_fetch in harness
- shadow-keyword overlap: default/off **1/7** chunk >0; flagged/on **3/7** — **FAIL**
- leakage: 0 PASS
- keyword stability: PASS
- tranche rerun guard: PASS

T20.13I keyword synthesis improved user-visible RAG answers without vector rollout.
Shadow latency/overlap remain blockers. See T20-13K-post-synthesis-readiness-closeout.md.

No further embedding tranches needed for ≥10k count gate unless explicitly approved for 15% coverage.

Allowed work only with explicit approval:
- T20.14/T20.15 production vector rollout — only after **all** gates pass (currently **NOT APPROVED**)
- Phase 21 — not started; blocked until rollout approved
- T20.13L/M shadow latency/overlap design proposals — read-only, explicit approval
- Optional shadow-only refinement (read-only diagnostics) — explicit approval only
```

---

## Phase 20 closeout (T20.16B)

| Branch | Closed at | Doc |
|--------|-----------|-----|
| T20.10 shadow overlap / latency | **T20.10AG** (`ffff38a`) | `docs/ai-platform/T20-10AG-flagged-overlap-stability-eval.md` |
| T20.11 coverage hardening | **T20.11C** (`65fda93`) | `docs/ai-platform/T20-11C-service-coverage-hardening.md` |
| T20.17 release note | **T20.17** (`33b99aa`) | `docs/release/rp-ai-phase-20-hardening-20260625.md` |

**Active verdict unchanged:** Vector rollout **NOT APPROVED / NOT READY**. Production keyword retrieval. Phase 21 not started.

---

## What this project is

**Record Platform** is a marketplace for vinyl records with listings, auctions, OBO (offers), messaging, notifications, and an **AI insights layer** (`python-ai-service`). The AI stack provides grounded RAG and structured insights over a `python_ai` Postgres corpus with pgvector embeddings.

**Critical invariant:** Production RAG uses **keyword retrieval**. Vector retrieval exists only as **shadow/diagnostic** tooling until explicit rollout approval.

---

## Phase history (locked vs active)

| Phase | Status | Summary |
|-------|--------|---------|
| **Phase 19** | **LOCKED** | Vector shadow routing: route profiles, weights, query hints, OBO corpus repair. Keyword default unchanged. Release: `docs/release/rp-ai-vector-shadow-routing-readiness-20260616.md` |
| **Phase 20** | **CLOSED (hardening)** | Coverage, shadow diagnostics, rollout evals, release note — **not** production vector flip |

### Phase 20 tickets completed (core)

| Ticket | SHA | What it did |
|--------|-----|-------------|
| **T20.6** | `6a922c0` | CI/coverage hardening: manifest, runner/enforcer, python-ai pytest-cov ≥90% on `app/ai/*` |
| **T20.7** | `6a922c0` (DB) | Bounded Tranche 2: +500 embeddings (4,549 → 5,049) |
| **T20.7R** | `fb6bed6` | Rerun guard hardening: lock blocks exit **2** |
| **T20.8** | `1732d90` | Read-only vector rollout readiness eval → **NOT READY** |

### T20.10 shadow overlap / latency branch (closed)

| Ticket | SHA | Summary |
|--------|-----|---------|
| **T20.10O** | `387bdc7` | Post notification-metadata refresh readiness eval; rollout NOT APPROVED |
| **T20.10P** | `809eaac` | Shadow latency diagnostics |
| **T20.10T** | `d78e1e4` | Shadow benchmark timing hardening |
| **T20.10U** | `3c051e9` | pgvector candidate-fetch EXPLAIN diagnostics |
| **T20.10V** | `ed64bf0` | Shadow profile refinement proposal |
| **T20.10W** | `334443d` / `0d7aa7c` | Scoped-first + dedupe shadow fetch strategy |
| **T20.10X** | `203a1e9` | Source diversity regression diagnostics |
| **T20.10Y** | `e6efcd3` / `ee435ca` | Typed diversity top-ups restored 6 types |
| **T20.10Z** | `e6e3e90` | Post-refinement readiness eval; rollout still NOT APPROVED |
| **T20.10AA** | `61a0bae` / `250d79b` | Overlap deep dive + count correction |
| **T20.10AB** | `692b28e` | Overlap refinement proposal |
| **T20.10AC** | `2f8d227` | Default-off flagged overlap refinements |
| **T20.10AD** | `472e8b3` | Flagged overlap eval |
| **T20.10AE** | `70e54be` | Flagged latency-trim proposal |
| **T20.10AF** | `91c2120` / `bdc310d` | Flagged latency trims (AF1–AF4) |
| **T20.10AG** | `ffff38a` | Flagged overlap stability eval — **branch closed** |

**T20.10 branch outcome:** Flagged diagnostic mode improves overlap **11/16 → 8/16** zero chunk-overlap (stable across 3 warm runs per T20.10AG). Latency acceptable on warm runs; embed variance remains conditional. **Not rollout approval.** Flags stay default off.

### T20.11 coverage hardening (closed)

| Ticket | SHA | Summary |
|--------|-----|---------|
| **T20.11A** | `44a8902` | Manifest v1.1 — enumerate 18 services; 5 new Node entries; all Node non-strict |
| **T20.11B** | `e379a1e` | Manifest v1.2 — dry-wire runners for messaging/notification/trust/media |
| **T20.11C** | `65fda93` | Audit — python-ai only strict gate; 4 dry-wired Node, 13 skipped — **branch closed** |

**T20.11 outcome:** `python-ai-service` remains the **only strict** coverage gate (≥90% `app/ai/*`). Node dry-wire runs are **non-blocking**. See `docs/ai-platform/T20-11C-service-coverage-hardening.md`.

### Phase 20 docs and release (closed)

| Ticket | SHA | Summary |
|--------|-----|---------|
| **T20.16** | `caabbc0` | Phase 20 copilot context refresh (post T20.10AG) |
| **T20.17** | `33b99aa` | Phase 20 release note draft — `docs/release/rp-ai-phase-20-hardening-20260625.md` |
| **T20.16B** | `a44e553` | Final context reconciliation after T20.11C + T20.17 |
| **T20.12** | `t20-tranche-12` (ops) | Tranche 12 actual: +500 embeddings (9,565 → 10,065); ≥10k count gate clears; T20.13 rollout **NOT APPROVED** |
| **T20.13** | (eval) | Comprehensive vector rollout readiness re-eval — `docs/ai-platform/T20-13-comprehensive-vector-rollout-readiness.md` |
| **T20.13A–B** | (docs) | Shadow zero-result/latency triage + stability fix proposal |
| **T20.13C–D** | `33c886f` | Live inference telemetry harness + real inference report |
| **T20.13E–F** | `a249c14` | Diagnostic embed warmup/retry; shadow fetch unblocked |
| **T20.13G–G-S** | `4658022` | Shadow fetch/latency/overlap triage + prompt/answer quality eval (RAG 2.6/5) |
| **T20.13H–J** | `066ef6e` | Keyword synthesis proposal + implementation + eval (RAG **3.6/5**) |
| **T20.13K** | (docs) | Post-synthesis readiness closeout — `docs/ai-platform/T20-13K-post-synthesis-readiness-closeout.md` |

### Phase 20 tickets NOT started (require explicit approval)

| Ticket | Scope |
|--------|-------|
| **T20.13L / T20.13M** | Shadow latency / overlap design proposals (read-only) |
| **T20.14 / T20.15** | Production vector default / hybrid rollout — only after all gates pass |
| **Phase 21** | Not started; do not begin without explicit approval |

### Phase 20 tickets completed (embedding ops)

| Ticket | Scope |
|--------|-------|
| **T20.12** (dry-run) | Tranche 3/4 planning dry-runs — see `bench_logs/ai-platform/t20-12-tranche3-dry-run.json` |
| **T20.12** (actual) | **`t20-tranche-4`** completed 2026-06-25: +500 → 6,065 |
| **T20.12F** (actual) | **`t20-tranche-5`** completed 2026-06-25: +500 → 6,565; backup `backups/rp-all-11-t20-12-tranche5-preflight/` (local only) |
| **T20.12G** | Docs-only source-of-truth update for Tranche 5 |
| **T20.12H** | Live inference transcript harness — `scripts/rp-ai-live-inference-transcript.sh` |
| **T20.12I** | Post–Tranche 5 readiness + live inference eval — `docs/ai-platform/T20-12I-post-tranche5-readiness-eval.md` |
| **T20.12J** | Tranche 6 dry-run plan — `docs/ai-platform/T20-12J-tranche6-dry-run-plan.md` |
| **T20.12J-R/S** | Tranche 6 capacity adjustment + adjusted dry-run (500/500) |
| **T20.12K** (actual) | **`t20-tranche-6`** completed 2026-06-25: +500 → 7,065; backup `backups/rp-all-11-t20-12-tranche6-preflight/` (local only) |
| **T20.12L** | Docs-only source-of-truth update for Tranche 6 |
| **T20.12M** | Post–Tranche 6 readiness + live inference eval — `docs/ai-platform/T20-12M-post-tranche6-readiness-eval.md` |
| **T20.12N** | Tranche 7 dry-run plan — `docs/ai-platform/T20-12N-tranche7-dry-run-plan.md` |
| **T20.12O** (actual) | **`t20-tranche-7`** completed 2026-06-25: +500 → 7,565; backup `backups/rp-all-11-t20-12-tranche7-preflight/` (local only) |
| **T20.12P** | Docs-only source-of-truth update for Tranche 7 |
| **T20.12Q** | Post–Tranche 7 readiness + live inference eval — `docs/ai-platform/T20-12Q-post-tranche7-readiness-eval.md` |
| **T20.12R** | Tranche 8 dry-run plan — `docs/ai-platform/T20-12R-tranche8-dry-run-plan.md` |
| **T20.12S** (actual) | **`t20-tranche-8`** completed 2026-06-25: +500 → 8,065; backup `backups/rp-all-11-t20-12-tranche8-preflight/` (local only) |
| **T20.12T** | Docs-only source-of-truth update for Tranche 8 |
| **T20.12U** | Post–Tranche 8 readiness + live inference eval — `docs/ai-platform/T20-12U-post-tranche8-readiness-eval.md` |
| **T20.12V** | Tranche 9 dry-run plan — `docs/ai-platform/T20-12V-tranche9-dry-run-plan.md` |
| **T20.12W** (actual) | **`t20-tranche-9`** completed 2026-06-25: +500 → 8,565; backup `backups/rp-all-11-t20-12-tranche9-preflight/` (local only) |
| **T20.12X** | Docs-only source-of-truth update for Tranche 9 |
| **T20.12Y** | Post–Tranche 9 readiness + live inference eval — `docs/ai-platform/T20-12Y-post-tranche9-readiness-eval.md` |
| **T20.12Z** | Tranche 10 dry-run plan — `docs/ai-platform/T20-12Z-tranche10-dry-run-plan.md` |
| **T20.12AA** (actual) | **`t20-tranche-10`** completed 2026-06-25: +500 → 9,065; backup `backups/rp-all-11-t20-12-tranche10-preflight/` (local only) |
| **T20.12AB** | Docs-only source-of-truth update for Tranche 10 |
| **T20.12AC** | Post–Tranche 10 readiness + live inference eval — `docs/ai-platform/T20-12AC-post-tranche10-readiness-eval.md` |
| **T20.12AD** | Tranche 11 dry-run plan only — `docs/ai-platform/T20-12AD-tranche11-dry-run-plan.md` |
| **T20.12AE** (actual) | **`t20-tranche-11`** completed 2026-06-26: +500 → 9,565; backup `backups/rp-all-11-t20-12-tranche11-preflight/` (local only) |
| **T20.12AF** | Docs-only source-of-truth update for Tranche 11 |
| **T20.12AG** | Post–Tranche 11 readiness + live inference eval — `docs/ai-platform/T20-12AG-post-tranche11-readiness-eval.md` |
| **T20.12AH** | Tranche 12 dry-run plan only — `docs/ai-platform/T20-12AH-tranche12-dry-run-plan.md` |
| **T20.12AI** (actual) | **`t20-tranche-12`** completed 2026-06-26: +500 → 10,065; backup `backups/rp-all-11-t20-12-tranche12-preflight/` (local only) |
| **T20.12AJ** | Docs-only source-of-truth update for Tranche 12 |
| **T20.12AK** | Post–Tranche 12 readiness + live inference eval — `docs/ai-platform/T20-12AK-post-tranche12-readiness-eval.md` |
| **T20.13** | Comprehensive vector rollout readiness re-eval — `docs/ai-platform/T20-13-comprehensive-vector-rollout-readiness.md` |

---

## Current system snapshot (2026-06-26, T20.13K)

```text
Current main SHA: 066ef6e (verify at commit time)
Embedded chunks: 10,065
Non-message chunks: 73,043
Embedded coverage: 13.8%
≥10k count gate: PASS
≥15% coverage gate: FAIL
Production retrieval: keyword
Production model_used: rule-engine
Keyword RAG synthesis: rag_synthesis.py (T20.13I) — 7 templates
Keyword answer quality: 3.6/5 (T20.13J) — target ≥3.5 PASS
Vector default: off
AI_RAG_SHADOW_VECTOR=0
AI_RAG_SHADOW_ENTITY_HINTS=0
AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0
Source diversity: 6 PASS
Owner-visible OBO embedded: 18 / 1,544 total embedded OBO
Leakage: 0 PASS
Keyword stability: PASS
Shadow embed timeouts (warmed harness): 0/7
Shadow p95 (recent warmed): 8–10s FAIL vs 3s SLO
Default/off overlap: 1/7 chunk >0 FAIL
Flagged/on overlap: 3/7 diagnostic-only
Coverage (app/ai strict): PASS (~90%+)
Vector rollout: NOT APPROVED
Phase 21: not started
Phase 20 hardening: CLOSED
Embedding ladder to 10k: COMPLETE — no further tranches required for count gate
Last tranche: t20-tranche-12 (+500, 2026-06-26)
```

### Embedded by source_type (post–Tranche 12)

| source_type | embedded |
|-------------|--------:|
| listing | 4,024 |
| obo_offer_summary | 1,544 |
| listing_revision | 2,100 |
| notification | 1,550 |
| record | 594 |
| auction_bid_summary | 253 |

---

## Vector rollout gate table (T20.13K closeout)

| Gate | Target | Current | Status |
|------|--------|---------|--------|
| Embedded count | ≥10,000 | **10,065** | **PASS** |
| Percent coverage | ≥15% | **~13.8%** | **FAIL** (count gate passes alternate) |
| Keyword answer quality | ≥3.5/5 | **3.6/5** (T20.13J) | **PASS** |
| Production retrieval | keyword | keyword | **PASS** |
| Source diversity | ≥5 types | 6 | **PASS** |
| Owner-visible OBO | ≥10 | 18 | **PASS** |
| Leakage | 0 | 0 | **PASS** |
| Keyword stability | unchanged | PASS | **PASS** |
| Shadow p95 latency | ≤3,000 ms | **8–10s** recent warmed | **FAIL** |
| Shadow overlap | meaningful | 1/7 off; 3/7 flagged | **FAIL** |
| Vector default | off | off | **PASS** |
| Phase 21 | not started | not started | **PASS** |
| Tranche rerun guard | exit 2 on lock | PASS | **PASS** |

**Verdict:** hold keyword default; vector rollout **NOT APPROVED**. Product RAG quality improved via synthesis; shadow latency/overlap remain blockers.

---

## Overlap refinement flags (T20.10AC–AF)

| Flag | Default | When on (diagnostic only) |
|------|---------|---------------------------|
| `AI_RAG_SHADOW_ENTITY_HINTS` | `0` | Entity key extraction, score boost, conditional listing_id typed fetch |
| `AI_RAG_SHADOW_NEIGHBOR_EXPANSION` | `0` | Entity-gated neighbor expansion (AF1 caps: 1/doc, 3 global, 3 docs) |

Read at process start in `app/ai/config.py`. Deployment must match for live benchmarks. **Never default on.**

Key implementation: `_apply_shadow_overlap_refinements()` in `rag_retrieval.py`.

---

## Hard rules for agents (do not violate)

1. **Do NOT** enable vector retrieval as production default without explicit approval and all rollout gates passing.
2. **Do NOT** enable `AI_RAG_SHADOW_ENTITY_HINTS` or `AI_RAG_SHADOW_NEIGHBOR_EXPANSION` by default.
3. **Do NOT** run broad/full corpus embedding backfill.
4. **Do NOT** set `EMBEDDING_BACKFILL_FORCE=1` unless ops explicitly approves (bypasses tranche lock).
5. **Do NOT** rerun actual Tranche 2–12 writes — locks exist; blocked exit **2**.
6. **Do NOT** change product behavior (keyword path, API contracts, default env) as part of Phase 20 hardening/eval tickets.
7. **Do NOT** start Phase 21.
8. **Do NOT** commit: `bench_logs/`, `backups/`, screenshots, DB dumps, coverage output artifacts.
9. **Do** run `bash scripts/rp-rp-decontaminate-scan.sh` before push; no RP/housing/landlord/tenant contamination in committed text.
10. **Pipefail trap:** When testing script exit codes, run **directly** — never pipe to `tail` without `set -o pipefail` (T20.7R lesson).

---

## Architecture: retrieval paths

```
POST /api/ai/rag/query
  └─> insights.rag_query()  [keyword default]
        └─> retrieve_chunks()           ← PRODUCTION (unchanged)
        └─> synthesize_rag_summary()  ← T20.13I keyword answer templates
        └─> retrieve_chunks_vector_shadow()  ← ONLY if shadow_vector=true (diagnostic)
              └─> _apply_shadow_overlap_refinements()  ← ONLY if overlap flags on
```

**Key files:**

| File | Role |
|------|------|
| `services/python-ai-service/app/ai/rag_retrieval.py` | Keyword + shadow vector retrieval, overlap refinements, privacy filters |
| `services/python-ai-service/app/ai/rag_synthesis.py` | Deterministic keyword RAG summary templates (T20.13I) |
| `services/python-ai-service/app/ai/shadow_profiles.py` | Route profiles, weights, query hints, neighbor caps |
| `services/python-ai-service/app/ai/insights.py` | Insight builders; rag_query wires synthesis |
| `services/python-ai-service/app/ai/routes.py` | HTTP routes; `shadow_vector`, `shadow_profile`, `shadow_query_hints` query params |
| `services/python-ai-service/app/ai/config.py` | `AI_RAG_SHADOW_VECTOR`, overlap flags — all default `0` |

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

**Backup before any new tranche:**

```bash
PGPASSWORD=postgres PG_DUMP_JOBS=4 BACKUP_TIMESTAMP=<label> \
  bash scripts/backup-rp-postgres-dbs.sh
```

---

## Coverage system (T20.6 / T20.11)

| Path | Role |
|------|------|
| `scripts/coverage/service-coverage-manifest.json` | **v1.2** — 18 services; only `python-ai-service` has `strict_enabled=true` (90% lines, `app/ai/*`); 4 Node dry-wired |
| `scripts/coverage/run-service-coverage.sh` | Run one service, or `all` (18 services); Node dry-wire non-blocking |
| `scripts/coverage/enforce-service-coverage.mjs` | Fail only strict services; Node SKIP with optional dry-wire line % |

```bash
bash scripts/coverage/run-service-coverage.sh python-ai-service
bash scripts/coverage/run-service-coverage.sh all
node scripts/coverage/enforce-service-coverage.mjs
```

Closeout: `docs/ai-platform/T20-11C-service-coverage-hardening.md`

---

## Gate scripts (common verification bundle)

### AI / RAG

```bash
bash scripts/rp-ai-shadow-source-diagnostic.sh      # shadow quality (read-only)
bash scripts/rp-ai-shadow-real-query-timing.sh      # T20.10T timing harness
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
bash scripts/rp-rp-decontaminate-scan.sh
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

## Recommended next work

```text
Phase 20 hardening is closed. T20.13K closeout recorded.

Embedding ladder to 10k count gate: COMPLETE (10,065 embedded).
No further embedding tranches required for ≥10k unless explicitly approved for ≥15% coverage.

Default: stop rollout work. Keyword synthesis (T20.13I) improved product value without vector.

Only with explicit approval:
1. T20.13L — shadow latency design proposal (read-only)
2. T20.13M — shadow overlap design proposal (read-only)
3. T20.14/T20.15 production vector rollout — blocked until latency/overlap pass
4. Phase 21 — not started
5. Optional additional embedding tranches toward 15% coverage — explicit approval only
```

Do **not** start T20.14/T20.15 rollout or Phase 21 without explicit approval and all gates passing.

Refusal rules:

1. **If asked to "enable vector"** → refuse until all rollout gates pass; cite this doc and `docs/ai-platform/T20-8-vector-rollout-readiness.md`.
2. **If asked to default-on overlap flags** → refuse; T20.10AG closed branch as diagnostic-only.
3. **If rerunning Tranche 2–12** → refuse; locks exist (exit **2**).
4. **Before any push** → RP scan, strip Co-authored trailers if needed, no `bench_logs/` in commit.

---

## Key references

| Document | Path |
|----------|------|
| **This handoff (source of truth)** | `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md` |
| T20.8 rollout eval | `docs/ai-platform/T20-8-vector-rollout-readiness.md` |
| T20.10Z post-refinement readiness | `docs/ai-platform/T20-10Z-post-shadow-refinement-readiness.md` |
| T20.10AA overlap deep dive | `docs/ai-platform/T20-10AA-shadow-keyword-overlap-deep-dive.md` |
| T20.10AD flagged overlap eval | `docs/ai-platform/T20-10AD-flagged-overlap-refinement-eval.md` |
| T20.10AF latency trims | `docs/ai-platform/T20-10AF-flagged-overlap-latency-trim.md` |
| T20.10AG stability eval | `docs/ai-platform/T20-10AG-flagged-overlap-stability-eval.md` |
| T20.11C coverage closeout | `docs/ai-platform/T20-11C-service-coverage-hardening.md` |
| T20.17 Phase 20 release note | `docs/release/rp-ai-phase-20-hardening-20260625.md` |
| T20.9 Tranche 3 dry-run plan | `docs/ai-platform/T20-9-tranche3-dry-run-plan.md` |
| T20.12I post–Tranche 5 eval | `docs/ai-platform/T20-12I-post-tranche5-readiness-eval.md` |
| T20.12M post–Tranche 6 eval | `docs/ai-platform/T20-12M-post-tranche6-readiness-eval.md` |
| T20.12Q post–Tranche 7 eval | `docs/ai-platform/T20-12Q-post-tranche7-readiness-eval.md` |
| T20.12R Tranche 8 dry-run plan | `docs/ai-platform/T20-12R-tranche8-dry-run-plan.md` |
| T20.12U post–Tranche 8 eval | `docs/ai-platform/T20-12U-post-tranche8-readiness-eval.md` |
| T20.12V Tranche 9 dry-run plan | `docs/ai-platform/T20-12V-tranche9-dry-run-plan.md` |
| T20.12Y post–Tranche 9 eval | `docs/ai-platform/T20-12Y-post-tranche9-readiness-eval.md` |
| T20.12Z Tranche 10 dry-run plan | `docs/ai-platform/T20-12Z-tranche10-dry-run-plan.md` |
| T20.12AC post–Tranche 10 eval | `docs/ai-platform/T20-12AC-post-tranche10-readiness-eval.md` |
| T20.12AD Tranche 11 dry-run plan | `docs/ai-platform/T20-12AD-tranche11-dry-run-plan.md` |
| T20.12AG post–Tranche 11 eval | `docs/ai-platform/T20-12AG-post-tranche11-readiness-eval.md` |
| T20.12AH Tranche 12 dry-run plan | `docs/ai-platform/T20-12AH-tranche12-dry-run-plan.md` |
| T20.12AK post–Tranche 12 eval | `docs/ai-platform/T20-12AK-post-tranche12-readiness-eval.md` |
| T20.13 comprehensive rollout re-eval | `docs/ai-platform/T20-13-comprehensive-vector-rollout-readiness.md` |
| T20.13K post-synthesis closeout | `docs/ai-platform/T20-13K-post-synthesis-readiness-closeout.md` |
| T20.13J synthesis quality eval | `docs/ai-platform/T20-13J-keyword-synthesis-quality-eval.md` |
| T20.13I keyword synthesis | `docs/ai-platform/T20-13I-keyword-answer-synthesis.md` |
| T20.13G-S answer quality report | `docs/ai-platform/T20-13G-S-real-use-case-answer-quality-report.md` |
| T20.13E/F embed warmup | `docs/ai-platform/T20-13E-diagnostic-embed-warmup-retry.md`, `T20-13F-post-warmup-inference-telemetry.md` |
| T20.12AA→AD bundle flight plan (completed) | `docs/ai-platform/T20-12AA-tranche10-bundle-flight-plan.md` |
| T20.12W→Z bundle flight plan (completed) | `docs/ai-platform/T20-12W-tranche9-bundle-flight-plan.md` |
| T20.12S→V bundle flight plan (completed) | `docs/ai-platform/T20-12S-tranche8-bundle-flight-plan.md` |
| T20.12O→R bundle flight plan (completed) | `docs/ai-platform/T20-12O-tranche7-bundle-flight-plan.md` |
| T20.12J-S adjusted Tranche 6 dry-run | `docs/ai-platform/T20-12J-S-tranche6-adjusted-dry-run.md` |
| T20.12H live inference harness | `scripts/rp-ai-live-inference-transcript.sh` |
| Phase 19 release | `docs/release/rp-ai-vector-shadow-routing-readiness-20260616.md` |
| AI contracts | `docs/ai-platform/rp-ai-contracts.md` |
| Coverage manifest | `scripts/coverage/service-coverage-manifest.json` |

---

## Commit message style

Recent Phase 20 commits:

- `docs(ci): document Phase 20 service coverage hardening` (T20.11C)
- `docs(release): draft Phase 20 AI hardening notes` (T20.17)
- `docs(ai): reconcile final Phase 20 context` (T20.16B)

Do not commit DB-only embedding changes. Docs like this file **should** be committed when updated.
