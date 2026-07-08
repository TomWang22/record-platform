# Phase 27 — Observability Operational Enablement Archive

Human-readable archive of Phase 27 controlled local/dev operational enablement. This is a documentation addendum — it does **not** reopen enablement or authorize production rollout.

```text
Phase 27: CLOSED PASS
Implementation/closeout commit: 15d8d08
Phase 27I: archive/explainer docs only (no code/runtime changes)
Artifact SHA unchanged: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
Live eval: NOT RUN
57105 replay: NOT RUN
Runtime/env/default/allowlist changes: NONE
Production DB migration: NOT RUN
Production enablement: NOT APPROVED
DB writes: local/dev synthetic redacted rows only (via official write paths), then writes re-disabled
KPI write paths default enabled: NO
Runtime writes enabled by default: NO
Generated KPI reports committed: NO
Bench logs committed: NO
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
```

```text
Archive precedence: When older Phase 27A–27H closeout docs conflict with this archive, this archive and ACTIVE_CONTEXT.md are authoritative for current state. Older docs are historical snapshots of their ticket at commit time.
```

---

## What Phase 27 was

```text
Phase 27 was controlled local/dev operational enablement only.
It proved KPI observability can populate redacted rows through official write paths.
It did not approve production rollout.
It did not migrate production DB.
It did not enable KPI writes by default.
It did not run live eval or 57105 replay.
It did not change production default, PERCENT, ALLOW_PROD_PERCENT, allowlist, runtime, or participant artifact.
```

---

## Final ledger

```text
Phase 27A: PASS — roadmap/design
Phase 27B: PASS — local/dev schema apply + introspection
Phase 27C: PASS — process-local flag enablement / default-off proof
Phase 27D: PASS — ingestion/searchability rows via write paths
Phase 27E: PASS — query H1/H2/H3 + usefulness H1/H2/H3/22C rows; no live RAG
Phase 27F: PASS — /tmp report from controlled rows
Phase 27G: PASS — disable-switch rollback
Phase 27H: PASS — closeout
Phase 27I: PASS — archive/explainer docs only
Phase 27: CLOSED PASS
```

---

## Controlled row counts (local/dev only)

Proven at Phase 27H on `python_ai` @ `127.0.0.1:5440`:

```text
ingestion=1
searchability=1
query=3
usefulness=4
```

Meaning:

```text
These are local/dev synthetic redacted rows.
They prove write paths and report generation work.
They do not mean production KPI observability is enabled.
They do not mean operational population is approved.
They do not authorize production migration or feature flag enablement.
```

Combined `/tmp` report child statuses from those rows (not committed):

```text
ingestion: PASS
searchability: PASS
query_latency: PASS
usefulness: PASS
operational_health: PARTIAL
```

---

## Why Phase 27 existed

Phase 26 implemented KPI observability behind default-off gates. Phase 27 proved a **controlled, non-production** path to:

1. verify schema on local/dev
2. temporarily enable flags in process env
3. write tiny synthetic redacted rows through official helpers
4. generate `/tmp` combined reports from real rows
5. flip disable switch and prove writes stop again

Without changing production posture.

---

## Companion docs

| Doc | Role |
| --- | ---- |
| `PHASE_27_OBSERVABILITY_OPERATOR_GUIDE.md` | How to verify safely |
| `PHASE_27_OBSERVABILITY_CODE_MAP.md` | Docs → code → flags → tests |
| `PHASE_27I_OPERATIONAL_ENABLEMENT_ARCHIVE_EXPLAINER.md` | 27I closeout note |
| `PHASE_27H_OBSERVABILITY_OPERATIONAL_ENABLEMENT_CLOSEOUT.md` | Implementation batch closeout |
| `PHASE_27A_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ROADMAP.md` | Design roadmap (historical) |

---

## Locked production posture (unchanged)

```text
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
AI_KPI_* flags: default OFF, master disable ON
Production enablement: NOT APPROVED
Production DB migration: NOT RUN
```

---

## Next allowed step

```text
Approved: start Phase 28A observability production-readiness design only after Phase 27 archive PASS — no live eval, no production default, no PERCENT rollout, no production DB migration.
```
