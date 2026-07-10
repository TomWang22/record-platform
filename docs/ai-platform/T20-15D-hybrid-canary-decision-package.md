# T20.15D — Hybrid canary decision package

**Status:** Decision complete  
**Generated:** 2026-06-29  
**Image:** `python-ai-service:t20-p215b2`  
**SHA:** `89cf785`

---

## Current evidence summary

| Source | Key result |
|--------|------------|
| T20.14H1 | Anchored 16/16, pure 8/16, latency PASS (5 runs) |
| T20.15B | Allowlist gates implemented; 270 tests pass |
| T20.15C API | 9/9 HTTP 200, 1 keyword fallback, avg score 3.78 |
| T20.15C shadow | pure 8/16, anchored 16/16, p95 427 ms, zero 0/16 |
| T20.15C UI (canary off) | Playwright PASS, 0 WARNs, keyword retrieval |
| Leakage / OCH | PASS |

---

## Decision options

### Option A — STOP and rollback to keyword only

**Not selected.** No leakage, no canary errors, fallback works, product quality holds with canary off.

### Option B — KEEP allowlist canary only ✅ SELECTED

**Selected because:**

- Hybrid safe on allowlisted contract user (8/9 hybrid_canary, 1 controlled fallback)
- Hybrid p95 **269 ms** API / **427 ms** shadow — well under gate
- Anchored overlap **16/16** on shadow matrix; pure remains **8/16**
- Keyword Lane C verified with `AI_RAG_HYBRID_CANARY=0`
- More evidence useful before any percentage design

**Scope:** Keep current env (allowlist only, percent=0). No production default flip.

### Option C — Proceed to T20.15E percentage design

**Not selected.** Pure overlap still 8/16; one API fallback on long tagged-plan prompt; anchors required for full overlap.

---

## Rollback state

```bash
kubectl -n record-platform set env deployment/python-ai-service \
  AI_RAG_HYBRID_CANARY=0 \
  AI_RAG_HYBRID_CANARY_USER_ALLOWLIST= \
  AI_RAG_HYBRID_CANARY_PERCENT=0
kubectl -n record-platform rollout restart deployment/python-ai-service
```

Image rollback: `python-ai-service:t20-p214g3r`

---

## Locked operational state (T20.15D)

```text
T20.15A–D complete.
Hybrid allowlist canary: KEEP for evidence collection only.
AI_RAG_HYBRID_CANARY=1 for allowlisted contract user.
AI_RAG_HYBRID_CANARY_PERCENT=0.
Production default remains keyword.
Vector production default: NOT APPROVED.
T20.15E limited percentage design: NOT STARTED — explicit approval required.
```

| Metric | T20.15C baseline |
| ------ | ---------------- |
| Image | `python-ai-service:t20-p215b2` |
| Allowlisted user | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |
| API fallback | 1/9 (`final_tagged_plan`) |
| Pure / anchored overlap | 8/16 / 16/16 |
| Avg quality | 3.78 |
| Hybrid p95 | 269 ms API / 427 ms shadow |

---

## Required verdict

```text
Vector production default: NOT APPROVED
Production default remains keyword
Hybrid allowlist canary: KEEP
T20.15E: NOT STARTED — requires explicit owner approval
```

---

## Next approval phrase (only if pursuing percentage design later)

```text
Approved: start T20.15E limited percentage hybrid canary design
```

---

## References

- `docs/ai-platform/T20-15A-hybrid-canary-design.md`
- `docs/ai-platform/T20-15B-hybrid-canary-implementation.md`
- `docs/ai-platform/T20-15C-hybrid-canary-real-inference-eval.md`
