# Phase 34 — End-to-End Product Gauntlet Scope

## Transport soak vs product acceptance

| Root | Scope | Terminal language |
| --- | --- | --- |
| `/tmp/phase34-live-inference-gauntlet-v3` | `API_INFERENCE_TRANSPORT_SOAK` | `PHASE 34 API/INFERENCE TRANSPORT SOAK-V3 BLOCKED` (1840/1; H3 502) |
| `/tmp/phase34-product-gauntlet-canary-v1` | Product canary (browser + H1/H2/H3 + screenshots) | Canary gate only — **ABSENT until authorized** |
| `/tmp/phase34-product-gauntlet-v1` | Full end-to-end product gauntlet | Three verdicts below |

## Canonical live session

Real auth → Chromium/Playwright → mounted Phase 34 UI → capture exact client request →
H1/H2/H3 replay of that request → pipeline observation → UI/API reconcile →
**`page.screenshot()` before PASS** → screenshot manifest linkage.

## Visual / a11y

- Dated paths: `webapp/e2e/screenshots/{authenticated|guest}/<date>/phase34-product-{gauntlet|canary}/`
- Manifest fields include session/turn/triplet/canonical/H1–H3/rendered hashes
- `accessibility_result` must be PASS/FAIL on live journeys (not NOT_EXECUTED)
- Visual status: `OWNER_VISUAL_REVIEW_REQUIRED` until owner accepts

## Pins

- Live: `LIVE_REGISTRY` hashes of committed prompt registry content
- Fixture: `FIXTURE_SYNTHETIC_PIN` (cannot satisfy live product evidence)

## Verdicts for `AI PLATFORM PRODUCT ACCEPTANCE READY`

Requires protocol PASS + end-to-end product PASS + evidence COMPLETE + human review +
visual accepted + accessibility PASS + privacy/safety hard stops.

Production enablement remains a separate approval.
