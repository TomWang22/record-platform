# Phase 34B — Client intelligence components (in progress)

```text
Status: LIVE EVIDENCE SLICE IN PROGRESS — NOT PRODUCT ACCEPTANCE READY
Target: /tmp/phase33f-capability-gauntlet-target-v1 — ABSENT / NOT LAUNCHED
Production: NOT APPROVED
Fine-tuning: NO
```

## Matrix

Machine-readable status: `scripts/ai-platform/phase34-client-surface-matrix.json`

Allowed statuses: `MISSING` | `PLUMBING_ONLY` | `LIVE_EVIDENCE_CONNECTED` | `TESTED` | `PRODUCT_SLICE_ACCEPTED`

No surface is `PRODUCT_SLICE_ACCEPTED` yet (Playwright journeys and full checklist remain).

## Landed

1. Typed Phase 33 intelligence client + shared panel shell
2. **Live scarcity evidence assembler** (`ai-market-evidence-assembler.ts` + live gather)
   - Active asking: listings search
   - Owner sold/asking: `/api/listings/mine`
   - Auction sold: auction-monitor results (release-level)
   - Separates exact-pressing vs release-level; `claim_rarity_from_zero_results=false`
   - Excludes deleted; flags stale; bootleg warning; wrong pressing excluded
3. Scarcity + valuation panels on `/records/[id]`
4. Valuation on `/sell` + `/market` (advisory only — never auto-fills price) and `/listings/[id]`
5. Explicit search mode chrome on `/listings` and `/market|/sell` (keyword default; no silent fallback)
6. Negotiation assistance on `/messages` (AI-generated draft; insert ≠ send; `automatic_send_allowed=false`)

## Still missing for 34B product acceptance

- Offers inbox/sent negotiation surface
- Auction / recommendations / market analytics / embedding lineage / memory surfaces
- Accessibility + mobile + Playwright gauntlet for all panels
- Phase 34C+ prompt registry / large unique-session programs (blocked until surfaces+assemblers sufficient)
