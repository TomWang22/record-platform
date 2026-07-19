# Phase 34 Intelligence Pipeline

Canonical data-engineering and intelligence path for owner-proof / product surfaces.

**Classification:** source remediation + pipeline contract pinning.  
This document does **not** claim product acceptance, ChatGPT-tier proven quality, model weight training, or live 24-scenario owner-proof pass.

- `MODEL_WEIGHT_TRAINING: NO`
- `OPTIMIZATION: PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION`

## Architecture

```text
RAW INGESTION
→ SCHEMA VALIDATION
→ NORMALIZATION
→ ENTITY AND PRESSING IDENTITY RESOLUTION
→ AUTHORIZATION AND PRIVACY FILTERING
→ DELETION / EXPIRY / CORRECTION APPLICATION
→ EVIDENCE SNAPSHOT MATERIALIZATION
→ MARKET ANALYTICS AND DETERMINISTIC FEATURES
→ EMBEDDING / RETRIEVAL / RERANKING
→ DETERMINISTIC CAPABILITY ENGINE
→ MODEL SYNTHESIS
→ OUTPUT SCHEMA VALIDATION
→ SAFETY / PRIVACY VALIDATION
→ API RESPONSE
→ CLIENT RENDER
→ TELEMETRY / REVIEW EVIDENCE
```

Central rule: **the data pipeline computes and proves facts; Python AI explains and converses over those facts; validators prevent invention; the client shows answer, evidence, uncertainty, and changes; telemetry proves every stage.**

## Machine-readable contract

- `scripts/ai-platform/phase34-intelligence-pipeline-contract.json`
- `scripts/ai-platform/phase34-intelligence-pipeline-contract.schema.json`
- `scripts/ai-platform/phase34-adversarial-pipeline-fixtures.json`
- Verify: `make ai-platform-verify-phase34-intelligence-pipeline`

## Authorized evidence before synthesis

Python AI consumes a typed authorized evidence bundle. Material numbers in answers must be traceable to `deterministic_metrics` or authorized evidence fields. Untraceable material claims fail closed.

## Response quality

Companion contract: `scripts/ai-platform/phase34-response-quality-contract.json`.  
HTTP 200 / JSON parity alone is insufficient for quality claims.

## Source verification vs owner proof

| Layer | Meaning |
| --- | --- |
| Pipeline / unit / protocol source verification | Proves contract + engines + H1/H2/H3 identity |
| Browser source verification | Real Chromium + authorized thread + four-turn negotiation |
| Live 24-scenario owner proof | Separate gated Stage 2 — not launched by this pass |
| Product acceptance | Blocked until Stage 2 + human review |

Frozen incomplete pack remains immutable failure evidence:

`owner-review-artifacts/phase34/live-action-preflight-24-to-20-v1`
