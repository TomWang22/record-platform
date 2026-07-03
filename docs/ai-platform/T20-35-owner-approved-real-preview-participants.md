# Owner-approved real preview participants — T20.35

**Status:** OWNER ARTIFACT — scope approved; participant rows **incomplete** (0/3)  
**Date (UTC):** 2026-07-03  
**Approver:** Tom Wang / repository owner  
**Scope:** Real-participant opt-in hybrid preview soak only

## Explicitly approved

* [x] Real participant opt-in hybrid preview soak only
* [ ] Participants listed below have owner approval / consent for preview testing *(pending — rows incomplete)*
* [x] JWT-authenticated users only
* [x] User-scoped opt-in enrollment only
* [x] Keyword default unchanged for non-enrolled users
* [x] `AI_RAG_HYBRID_CANARY_PERCENT=0`
* [x] `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0`
* [x] Hybrid anchored Lane B only
* [x] Keyword fallback retained
* [x] Overlap anchors retained
* [x] Revoke and rollback drill required after live eval

## Explicitly NOT approved

* [x] Hybrid production default
* [x] Vector production default
* [x] Percentage rollout
* [x] `AI_RAG_HYBRID_CANARY_PERCENT > 0`
* [x] Permanent allowlist broadening
* [x] Anonymous or guest hybrid access
* [x] Message-body exposure
* [x] Removal of keyword fallback
* [x] Removal of overlap anchors
* [x] Relabeling staging/test cohort users as real participants

## Participants

| # | Email | UUID / JWT sub | Participant type    | Approval source | Consent confirmed | Scope                    | Message bodies exposed? | Production default approved? | PERCENT > 0 approved? |
| - | ----- | -------------- | ------------------- | --------------- | ----------------- | ------------------------ | ----------------------- | ---------------------------- | --------------------- |
| 1 | TBD   | TBD            | real_owner_approved | TBD             | yes/no            | opt-in preview soak only | NO                      | NO                           | NO                    |
| 2 | TBD   | TBD            | real_owner_approved | TBD             | yes/no            | opt-in preview soak only | NO                      | NO                           | NO                    |
| 3 | TBD   | TBD            | real_owner_approved | TBD             | yes/no            | opt-in preview soak only | NO                      | NO                           | NO                    |

## Minimum gate

At least **3** participants must be complete and marked `real_owner_approved` or owner-approved `internal_staff` before any live eval.

## Signature / approval reference

Owner approval reference:  
Owner chat instruction approving real-participant opt-in hybrid preview soak scope.

Signed:  
Tom Wang / repository owner — 2026-07-03
