# Phase 34B — Client intelligence components (in progress)

```text
Status: IN PROGRESS — NOT PRODUCT ACCEPTANCE READY
Target: /tmp/phase33f-capability-gauntlet-target-v1 — ABSENT / NOT LAUNCHED
Production: NOT APPROVED
```

## Landed in this slice

1. Typed Phase 33 intelligence client: `webapp/lib/ai-intelligence-client.ts`
2. Shared contracts: `webapp/lib/ai-intelligence-types.ts`
3. Evidence / confidence / abstention / rate-limit shell:
   `webapp/components/ai/intelligence/intelligence-panel-shell.tsx`
4. First real product surface — scarcity on collection record detail:
   `webapp/components/ai/intelligence/scarcity-intelligence-panel.tsx`
   wired into `webapp/app/(dashboard)/records/[id]/page.tsx`

## Honest behavior note

Live sold/asking comparable assembly is **not** complete yet. The scarcity panel
calls `/api/ai/intelligence/scarcity` with an explicit empty candidate set and
`claim_rarity_from_zero_results=false`, so the deterministic engine **abstains**
instead of inventing rarity from empty inventory. That is the correct fail-closed
product behavior until market-evidence assembly lands.

## Still missing for 34B

- Valuation / auction / search / negotiation / recommendations / analytics panels
  on their required surfaces
- Live comparable / listing context assemblers
- Negotiation draft UX on `/messages` and `/offers/*`
- Accessibility + Playwright journeys for new panels
