# P21.10 — Post-release product roadmap

**Generated:** 2026-06-28  
**Release tag:** `rp-ai-phase-21-non-vector-seller-intelligence-20260628` @ `d0e4c58`  
**Phase 21 non-vector track:** CLOSED / RELEASE TAGGED

---

## Current product state

```text
Phase 21 non-vector seller intelligence: RELEASE TAGGED
Production retrieval: keyword
Synthesis: rule-engine
Seller intelligence UI: live
Source evidence UX: live
Session memory API: prototype (in-memory, single-pod)
Collector metadata field map: live
Quality telemetry: live (scripts/ai-quality-telemetry-report.mjs)
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```

Reference: `docs/release/rp-ai-phase-21-non-vector-seller-intelligence.md`, `docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md`

---

## Optional product follow-ups

All tracks below require **explicit approval** before implementation. None may enable vector retrieval.

| Track | Purpose | Risk | Notes |
| ----- | ------- | ---- | ----- |
| **P21.10** | Batch seller endpoint design | medium | Reduce four parallel keyword retrievals (~3–11s API under load) |
| **P21.11** | Persistent session memory design | medium | Redis/DB, multi-pod, TTL policy — no vector dependency |
| **P21.12** | Observation-deck telemetry integration | low | Feed `quality-telemetry/*.json` into `/observation-deck` |
| **P21.13** | Seller intelligence polish | low | UX copy, panel ordering, sparse-excerpt affordances |
| **P21.14** | Dedicated session-memory UI | medium | `/insights` chat surface wired to session API — design first |

---

## Recommended priority (product lane)

1. **P21.12** — lowest risk; extends existing telemetry without retrieval changes  
2. **P21.10** — addresses remaining latency under concurrent load (keyword-only)  
3. **P21.11** — unblocks multi-pod session continuity before UI (P21.14)  
4. **P21.14** — depends on P21.11 design  
5. **P21.13** — incremental polish anytime

---

## Hard separation from vector lane

| Rule | Status |
| ---- | ------ |
| Product work continues on **keyword + rule-engine** | Allowed with approval |
| Vector rollout is a **separate track** (T20.14 → T20.15) | Blocked until gates pass |
| No product ticket may set `AI_RAG_SHADOW_VECTOR=1` as production default | **Forbidden** |
| No product ticket may enable hybrid/vector retrieval default | **Forbidden** |
| No product ticket may run embedding tranches or create ANN indexes | **Forbidden** |
| Phase 21 release tag does **not** imply vector approval | **Required understanding** |

Vector blocker burn-down: `docs/ai-platform/T20-14-vector-rollout-blocker-burndown-roadmap.md` (T20.14B)

---

## Validation discipline (product lane)

After any approved product change:

```bash
./scripts/webapp-playwright-strict-edge.sh e2e/seller-intelligence-ui.spec.ts --grep "Seller intelligence UI"
./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-record-intelligence.spec.ts --grep "AI record intelligence UI acceptance"
./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-longform-record-session.spec.ts --grep "AI longform record collector RAG session"
node scripts/ai-quality-telemetry-report.mjs
bash scripts/rp-och-decontaminate-scan.sh
```

Do not commit `bench_logs/` artifacts.

---

## Final verdict

```text
Phase 21 non-vector seller intelligence: RELEASE TAGGED
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```
