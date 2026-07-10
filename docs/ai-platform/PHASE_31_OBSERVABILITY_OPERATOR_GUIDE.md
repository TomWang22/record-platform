# Phase 31 — Observability Operator Guide

Practical runbook for Phase 31 staging-only observability. **No production enablement. No PERCENT rollout. No production DB migration.**

Related:

- R2 soak: `PHASE_31D_R2_REPAIRED_STAGING_LONG_SOAK.md`
- Latency caveat: `PHASE_31K_LATENCY_OUTLIER_AND_STAGING_CONTINUE_ARCHIVE.md`
- Closeout archive: `PHASE_31J_PRODUCTION_KPI_ENABLEMENT_DECISION_ARCHIVE.md`
- Active context: `ACTIVE_CONTEXT.md`

---

## How to read Phase 31 docs

```text
1. Start with ACTIVE_CONTEXT.md.
2. Read PHASE_31K_LATENCY_OUTLIER_AND_STAGING_CONTINUE_ARCHIVE.md for production-readiness caveat.
3. Use 31A–31J docs as ticket closeouts.
4. Phase 31D-R2 matrix proves staging soak — NOT production enablement.
```

---

## Hard stops

```text
Live eval: NOT RUN
Production enablement: NOT APPROVED
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT enabled
KPI write paths default enabled: NO
Generated reports committed: NO
Bench logs committed: NO
Latency max outlier: ~1,037,645 ms — blocks production KPI enablement until RCA
```

---

## Primary verification

```bash
export PHASE31_MATRIX_ROOT=/tmp/phase31d-r2-repaired-staging-long-soak
make ai-platform-verify-phase31-preflight
make ai-platform-verify-phase31-matrix
make ai-platform-verify-phase31-latency-outlier
make ai-platform-verify-phase31-closeout
```

---

## Matrix summary (31D-R2)

```bash
node scripts/phase31-summarize-controlled-matrix.mjs \
  --in /tmp/phase31d-r2-repaired-staging-long-soak \
  --json
```

Expected:

```text
total=51840/51840
H1/H2/H3=17280/17280 each
wrong_gate=0
fallback=0
leakage=0
response_pass=100%
```

---

## Latency outlier caveat

Max latency ~1,037,645 ms was observed across H1/H2/H3 during 31D-R2. This is **not** a matrix gate failure (p50/p95/p99 and quality gates passed), but it **must block production KPI enablement** until explained.

Inspect outliers:

```bash
cat /tmp/phase31d-r2-repaired-staging-long-soak/phase31-latency-outliers-top20.json
```

---

## Evidence separation

```text
Phase 31D-R2: 51840/51840 — separate evidence track
Phase 22 parity: 57105/171315 — NOT merged
Phase 28/29/30: 25920 each — NOT merged
```

---

## Operator actions allowed

- Staging-only KPI observability operations
- Read-only `/tmp` report generation
- Continued staging soak with repaired coordinator (explicit approval)

## Operator actions forbidden

- Production KPI write enablement
- Do not set PERCENT or ALLOW_PROD_PERCENT above 0
- Hybrid/vector production default
- Committing `/tmp` reports or bench logs
- Treating latency max outlier as ignorable for production decisions
