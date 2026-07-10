# T20.15AG — Hybrid canary ladder closeout

**Status:** Ladder **CLOSED**  
**Generated:** 2026-06-30  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15AF decision (B selected, C recommended)

---

## 1. Final ladder state

```text
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
Percentage ladder: COMPLETE (1% → 100%)
T20.16A: NOT STARTED
```

---

## 2. Commit map (T20.15A through AF)

| Ticket | SHA | Summary |
|--------|-----|---------|
| T20.15A design | `c8715e9` | Hybrid canary design |
| T20.15C eval | `e5a2211` | Allowlist inference eval |
| T20.15D-S soak | `d0897e0` | Allowlist soak |
| T20.15D-T drill | `fbe8013` | Control rollback drill |
| T20.15E design | `9f9fd59` | Limited percentage design |
| T20.15G 1% eval | `8bbb493` | 1% live eval |
| T20.15H decision | `11308cb` | 1% decision package |
| T20.15I design | `3086d23` | 5% design |
| T20.15J gate | `42fac2b` | 5% gate tests |
| T20.15K 5% eval | `d3194d0` | 5% live eval |
| T20.15L decision | `99ebeb2` | 5% decision |
| T20.15M design | `32ad1ce` | 10% design |
| T20.15O 10% eval | `58c6fcf` | 10% live eval |
| T20.15P decision | `9c210aa` | 10% decision |
| T20.15Q design | `836e6b9` | 25% design |
| T20.15S 25% eval | `bca701b` | 25% live eval |
| T20.15T decision | `d7799f2` | 25% decision |
| T20.15U design | `f9d3069` | 50% design |
| T20.15V gate | `517d85f` | 50% gate verification |
| T20.15W 50% eval | `76fa090` | 50% live eval |
| T20.15X decision | `64e875e` | 50% decision |
| T20.15Y design | `cec27a3` | 75% design |
| T20.15Z gate | `b178160` | 75% gate verification |
| T20.15AA 75% eval | `bb6b282` | 75% live eval |
| T20.15AB decision | `8e575eb` | 75% decision |
| T20.15AC design | `c996ff7` | 100% design |
| T20.15AD gate | `5155fd0` | 100% gate verification |
| T20.15AE eval | *(this commit)* | 100% live eval |
| T20.15AF decision | *(this commit)* | 100% decision package |

Gate implementation commits: T20.15F (`hybrid_canary.py`), T20.15B image `t20-p215f`.

---

## 3. Evidence table (all eval windows)

| % | HTTP 200 | Fallback | Hybrid p95 | Anchored | Pure | Leakage | WARNs | Restored |
|---|----------|----------|------------|----------|------|---------|-------|----------|
| 1% | 27/27 | 11.11% | 223 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 5% | 27/27 | 11.11% | ~223 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 10% | 27/27 | 11.11% | 223.8 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 25% | 27/27 | 11.11% | ~350 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 50% | 27/27 | 11.11% | ~515 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 75% | 27/27 | 11.11% | 472.88 ms | 16/16 | 8/16 | PASS | 0 | yes |
| 100% | 27/27 | 11.11% | 345.97 ms | 16/16 | 8/16 | PASS | 0 | yes |

---

## 4. Final operational state

| Item | Value |
|------|-------|
| Hybrid allowlist | **KEEP** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** |
| Image | `python-ai-service:t20-p215f` |
| Allowlisted user | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |

---

## 5. Hard stops for future agents

- Do **NOT** enable vector retrieval as production default.
- Do **NOT** set `AI_RAG_HYBRID_CANARY_PERCENT` above 0 without explicit owner approval for a scoped eval window.
- Do **NOT** keep PERCENT=100 (or any PERCENT>0) active without explicit approval.
- Do **NOT** rename hybrid canary to production rollout.
- Do **NOT** enable anonymous/guest hybrid.
- Do **NOT** spoof user IDs with headers — JWT auth only.
- Do **NOT** start T20.16 implementation without design approval.
- Do **NOT** commit bench_logs, screenshots, traces, dumps, or scratch helper scripts.

---

## 6. Rollback runbook

**Full hybrid rollback:** `AI_RAG_HYBRID_CANARY=0` → rollout → verify keyword for all users.

**Allowlist-only restore:** `AI_RAG_HYBRID_CANARY=1`, contract UUID allowlist, `PERCENT=0`, all hybrid flags as in §4.

**After any failed eval:** restore `PERCENT=0` immediately, verify keyword_default, write failure decision doc, stop.

---

## 7. Next-roadmap options

| Ticket | Scope |
|--------|-------|
| **T20.16A** | Hybrid production-readiness **design only** |
| **T20.16B** | `final_tagged_plan` fallback remediation |
| **T20.16C** | Pure vector overlap research |
| **P21.10+** | Product lanes remain keyword/rule-engine only |

---

## 8. Required next approval phrase

```text
Approved: start T20.16A hybrid production-readiness design only
```

Do **not** start T20.16A without this phrase.
