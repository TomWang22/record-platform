# Phase 33 — Intelligence Capability Gauntlet

```text
Status: PHASE 33A–33E PACKAGES COMPLETE — LIVE GAUNTLET NOT LAUNCHED
Phase 33E: COMPLETE (fixture offline only)
Phase 33F: LAUNCHER COMMITTED — offline readiness/verify PASS; live 720-probe canary NOT LAUNCHED; real canary/target roots ABSENT
Phase 33G: NOT LAUNCHED
Requires: new exact-SHA CI approval + explicit owner launch approval before creating /tmp/phase33f-capability-gauntlet-canary-v1
```

## Purpose

Prove eight intelligence capabilities with grounded evidence and cross-protocol
parity. Phase 32H remains the transport/runtime prerequisite and does not accept
product capabilities.

Phase 32H closeout: COMPLETE transport/runtime PASS for both arms;
causal verdict `NO_CAUSAL_SEPARATION`; underlying historical ≥60s cause
`UNRESOLVED`. See `docs/ai-platform/PHASE_32H_R1_CLOSEOUT.md`.

## Canonical sources

- Capability matrix: `scripts/ai-platform/intelligence-capability-matrix.json`
- Data-source lineage: `scripts/ai-platform/data-source-lineage.json`
- Retrieval corpus: `scripts/ai-platform/retrieval-corpus/`
- Phase 33C scenarios: `scripts/ai-platform/phase33c-scenarios/`
- Phase 33C policy: `scripts/ai-platform/phase33c-acceptance-policy.json`
- Phase 33D scenarios: `scripts/ai-platform/phase33d-scenarios/`
- Phase 33D policy: `scripts/ai-platform/phase33d-acceptance-policy.json`
- Verify:
  - `make ai-platform-verify-phase33a-contracts`
  - `make ai-platform-verify-phase33b`
  - `make ai-platform-verify-phase33c`
  - `make ai-platform-verify-phase33d`
  - `make ai-platform-evaluate-phase33d-fixtures` (`/tmp` only)

## Selected Phase 33C/33D routes

| Route | Module |
| --- | --- |
| `POST /ai/intelligence/scarcity` | `app.ai.market_intelligence` |
| `POST /ai/intelligence/valuation` | `app.ai.market_intelligence` |
| `POST /ai/intelligence/auction` | `app.ai.market_intelligence` |
| `POST /ai/intelligence/auction/watchlist-temperature` | `app.ai.market_intelligence` |
| `POST /ai/intelligence/negotiation` | `app.ai.negotiation_recommendations` |
| `POST /ai/intelligence/recommendations` | `app.ai.negotiation_recommendations` |

Legacy RAG routes (`/ai/seller/negotiation-strategy`, `/ai/records/valuation`,
etc.) remain and are not replaced.

## Program phases

| Phase | Focus | Status |
| --- | --- | --- |
| 33A | Capability contracts and output schemas | COMPLETE |
| 33B | Data lineage, embeddings, retrieval evaluation corpus | COMPLETE (offline) |
| 33C | Scarcity, valuation, auction intelligence | COMPLETE (offline/fixture) |
| 33D | Negotiation assistance and recommendations | COMPLETE (offline/fixture; coverage gate restored) |
| 33E | Market analytics and multi-turn recall | COMPLETE (fixture offline; durable private memory NOT AUTHORIZED) |
| 33F | Cross-protocol capability gauntlet | LAUNCHER COMMITTED; CANARY NOT LAUNCHED |
| 33G | Targeted remediation and staging decision | NOT LAUNCHED |

## Phase 33B metric interpretation (not acceptance)

| Mode | Recall@5 | MRR | nDCG@5 |
| --- | ---: | ---: | ---: |
| keyword | 0.532 | 0.413 | 0.419 |
| semantic_fixture | 0.137 | 0.079 | 0.083 |
| hybrid_fixture | 0.564 | 0.401 | 0.389 |

These are development baselines. They are **not** production acceptance.
`semantic_fixture` is materially below an acceptable product-retrieval level.
Hybrid does **not** justify a production-default change. Phase 33C/33D default to
deterministic metadata/keyword evidence selection.

## Phase 33D notes

- Negotiation is advisory only; `automatic_send_allowed=false` always
- Reply drafts never auto-send, bid, offer, or mutate inventory
- Recommendations are explainable with reason codes; no pay-to-rank
- Privacy isolation and thread authorization are deterministic code
- Model may only draft/explain after structured facts are validated

## Hard stops

- Production default remains keyword; PERCENT=0; ALLOW_PROD_PERCENT=0
- Hybrid/vector production default remains NOT ENABLED
- Automatic negotiation sending remains DISABLED
- No live product matrix in CI
- No `/tmp` generated reports committed

## Phase 33F committed launcher

Committed path (only supported live canary entrypoint):

- `scripts/phase33f-launch-capability-canary.mjs`
- `scripts/lib/phase33f-canary-preflight.mjs`
- `scripts/lib/phase33f-canary-manifest.mjs`
- `scripts/lib/phase33f-capability-runner.mjs`
- `scripts/lib/phase33f-terminal-verdict.mjs`
- `scripts/phase33f-runtime-status-readonly.mjs`

Verify (offline / no real canary root):

- `make ai-platform-verify-phase33f-canary-manifest`
- `make ai-platform-verify-phase33f-canary-launcher`
- `make ai-platform-verify-phase33f-canary-preflight`
- `make ai-platform-verify-phase33f`

Smoke root (optional, distinct from real canary): `/tmp/phase33f-canary-launcher-smoke-v1`

Real canary root remains ABSENT until a new exact-SHA CI approval and an explicit
owner launch statement set `PHASE33F_OWNER_LAUNCH_APPROVED_SHA` to HEAD.

## Next action

Owner review of the committed launcher, live edge proof (currently blocked by
`caddy-with-tcpdump:dev` ImagePullBackOff — see `/tmp/phase33f-edge-preflight-repair/`),
and optional launcher smoke. Then require a **new** exact-SHA CI approval and a
**new** explicit owner statement before creating `/tmp/phase33f-capability-gauntlet-canary-v1`.
Do not launch the 17,280-probe target without a separate exact owner approval after a
frozen canary PASS.
