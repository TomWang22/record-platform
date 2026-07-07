# Phase 25E — observability guardrails and test design

**Phase 25E:** PASS — design guard script and unit tests added  
**Live eval:** NOT RUN  
**Network/DB/kubectl:** NOT USED by guard

---

## Executive verdict

Phase 25E defines **tests future Phase 26 implementation must pass** and ships a **read-only design doc validator** for Phase 25 closeout.

---

## Required future tests (Phase 26)

| Test | Purpose | Owner phase |
| ---- | ------- | ----------- |
| Redaction test | No raw response body, JWT, password, private message, proxy max bid in KPI tables or JSON exports | 26B–26E |
| Schema contract test | All Phase 25B required fields present in Prisma/migration | 26A |
| Ingestion KPI partial/gap handling | Honest PARTIAL when run-level only; GAP when DB unreachable | 26B |
| Data-to-searchable timing calculation | `arrival_to_searchable_ms` derived correctly | 26C |
| Query latency percentile calculation | p50/p95/max by protocol | 26D |
| Evidence-label preservation | H1/H2/H3/171315/22C/22B labels never merged unlabeled | 26E–26F |
| Production posture lock preservation | keyword default, PERCENT=0, NOT APPROVED hybrid | 26F–26G |
| No bench logs committed | CI guard on `bench_logs/**` | 26G |

---

## Phase 25 design guard (implemented)

Read-only validator — **no network, no DB, no kubectl, no live inference**.

```bash
node scripts/phase25-observability-design-guard-readonly.mjs
node --test tests/phase25-observability-design-guard.test.mjs
```

### Guard checks

```text
- All PHASE_25A–25F docs exist
- Four proposed tables referenced
- Six JSON output contracts referenced
- Phase 26A–26G in rollout plan
- Closeout claims CLOSED PASS without schema applied
- Required schema fields in 25B
- Privacy rules documented
- ACTIVE_CONTEXT Phase 25 CLOSED PASS
- No banned Current handoff HEAD label
- No banned unlabeled 171315 wording
- Guard script has no curl/kubectl/live RAG patterns
```

---

## Makefile target

```make
ai-platform-verify-phase25-design:
	$(MAKE) ai-platform-verify-phase24-kpis
	node scripts/phase25-observability-design-guard-readonly.mjs
	node --test tests/phase25-observability-design-guard.test.mjs
```

---

## Privacy rules (test assertions)

```text
No raw response bodies.
No raw message bodies.
No JWTs.
No passwords.
No raw buyer private data.
No proxy max bids.
```

---

## Related files

- `scripts/phase25-observability-design-guard-readonly.mjs`
- `scripts/lib/phase25-observability-design-guard.mjs`
- `tests/phase25-observability-design-guard.test.mjs`
