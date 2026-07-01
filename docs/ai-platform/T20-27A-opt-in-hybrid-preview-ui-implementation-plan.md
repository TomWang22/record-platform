# T20.27A — Opt-in hybrid preview UI implementation plan

**Status:** Plan complete — **UI implementation authorized** (T20.27A–H)  
**Generated:** 2026-07-01  
**Baseline SHA:** `7f005f2` (T20.26E closeout)  
**Image:** `python-ai-service:t20-p225b` (unchanged)  
**Parent:** T20.26D decision B + C recommended; owner approval for T20.27A–H UI implementation

---

## 1. Scope

Implement the T20.26A UI design as authenticated-only surfaces on `/insights`. **No** python-ai image or env changes.

| In scope | Out of scope |
|----------|--------------|
| Preview status card on `/insights` | Hybrid/vector production default |
| Client wrappers for preview API | `PERCENT > 0` |
| Enroll / revoke with confirmation | Allowlist broadening |
| Playwright E2E for preview UI | Message-body exposure |
| Live smoke 270 cases | Anonymous/guest enroll |

## 2. API (existing T20.25)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/ai/rag/preview/status` | Card state |
| `POST /api/ai/rag/preview/enroll` | Opt-in |
| `POST /api/ai/rag/preview/revoke` | Opt-out |

## 3. UI surfaces

| Surface | Implementation |
|---------|----------------|
| `OptInHybridPreviewCard` | New component; `data-testid` hooks for E2E |
| `/insights` integration | Render card for authenticated users above RAG panel |
| Enroll CTA | Confirmation copy + `POST enroll` |
| Revoke CTA | Confirmation copy + `POST revoke` |
| Allowlist info | When RAG `gate_reason=allowlist` and not preview-enrolled |
| Copy | Required non-default strings from T20.26A |

## 4. Files (planned)

```text
webapp/components/ai/opt-in-hybrid-preview-card.tsx   (new)
webapp/lib/ai-insights-client.ts                        (preview client methods)
webapp/lib/ai-insights-types.ts                        (HybridPreviewStatus type)
webapp/components/ai/ai-insights-dashboard.tsx           (mount card)
webapp/e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts     (new E2E)
```

## 5. Hard stops

- Production default: **keyword**
- PERCENT: **0**
- No python service changes
- T20.28A not started without separate approval

## 6. Validation batch

| Ticket | Deliverable |
|--------|-------------|
| T20.27B | UI code |
| T20.27C | Lint / typecheck + E2E |
| T20.27D | Preflight + JWT controls |
| T20.27E | 270-case live + Playwright |
| T20.27F | Rollback drill |
| T20.27G | Decision C |
| T20.27H | Closeout + PHASE_21 |
