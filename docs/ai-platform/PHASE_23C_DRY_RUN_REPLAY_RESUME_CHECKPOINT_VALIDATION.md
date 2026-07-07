# Phase 23C — dry-run replay resume/checkpoint validation

**Status:** PASS  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED

---

## Verdict

Phase 23C validates long-run replay resume/checkpoint behavior **without live inference**. No `/api/ai/rag/query` calls, no auth/login, no kubectl mutations, and no runtime/env changes.

---

## Dry-run fixture location

Temporary fixtures only under `/tmp/phase23c-*` (created per run by `scripts/phase23c-dry-run-replay-resume-validation.mjs`).

---

## Cases validated

1. Fresh manifest, no checkpoint → would run all rows  
2. Half-complete main JSONL → skips completed probes  
3. Per-batch JSONL complete for one batch → skips that batch  
4. Checkpoint `last_probe_id` behind JSONL → JSONL wins  
5. Duplicate `probe_id` in JSONL → FAIL  
6. Wrong protocol in checkpoint → FAIL  
7. Wrong phase in checkpoint → FAIL  
8. Corrupt JSONL line → FAIL  
9. Corrupt checkpoint JSON → FAIL  
10. Completed manifest → would run 0 remaining rows  

---

## Resume/checkpoint rules

```text
- Completed probes are derived from main JSONL plus per-batch JSONL when --resume is used.
- JSONL is authoritative over stale checkpoint last_probe_id.
- Duplicate probe_id in any JSONL source is a hard failure.
- Checkpoint protocol and phase must match the active replay run.
- Corrupt JSONL or checkpoint JSON is a hard failure.
- Remaining probes = manifest rows not present in completed JSONL set.
```

---

## Failure cases tested

- duplicate probe_id  
- wrong protocol  
- wrong phase  
- corrupt JSONL  
- corrupt checkpoint  

---

## Commands

```bash
node scripts/phase23c-dry-run-replay-resume-validation.mjs
node --test tests/phase23c-dry-run-replay-resume-validation.test.mjs
```

Expected output:

```text
PASS: Phase 23C dry-run replay resume/checkpoint validation
```

---

## Bench logs committed

NO

---

## Next

Phase 23D if PASS
