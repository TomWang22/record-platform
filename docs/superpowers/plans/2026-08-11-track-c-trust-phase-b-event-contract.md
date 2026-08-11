# Track C — Trust Phase B event-contract draft

**Date:** 2026-08-11  
**Status:** PROTO APPLIED · enqueue API green · HTTP/gRPC writers **wired** · inventory **11 / 1 / 0**  
**Depends on:** Phase A drain green · P2 frozen for first slice  
**Does not:** enable `TRUST_OUTBOX_PUBLISHER` · modify auth · claim Track C PASS

Proto + round-trip + PoolClient enqueue/G7 + seven-path writer wiring are in. STOP before auth.

---

## Why current proto cannot be reused

### `ListingFlaggedV1` is a confirmation event

`infra/db/01-trust-schema.sql`:

> When resolved as confirmed, Trust emits listing.flagged

Runtime listing-flag writers (`POST /flag-listing`, `POST /report-abuse` listing, gRPC `FlagListing` / `ReportAbuse` listing) insert `trust.listing_flags` with `status='pending'`. There is no resolve/dismiss writer.

Emitting `ListingFlaggedV1` on that INSERT would change the event’s meaning from “moderation confirmed the listing is flagged” to “someone submitted a report”. Downstream listing consumers that optionally listen would treat a pending report as a confirmed flag.

**Rule:** `ListingFlaggedV1` stays reserved for a real `pending → resolved` (confirmed) transition. Submission needs a **new** event.

### `ReviewCreatedV1` requires identifiers the peer-review row does not have

```text
proto ReviewCreatedV1:
  review_id, listing_id, order_id, reviewer_id, reviewee_id, rating, created_at

runtime trust.reviews (peer-review path):
  id, booking_id, reviewer_id, target_type='user', target_id, rating, comment, created_at
```

Forbidden:

- `booking_id → order_id`
- empty `listing_id` / `order_id` merely to satisfy the schema

`ReviewCreatedV1` stays reserved for a listing/order review that actually has those ids (marketplace path is out of scope and has no matching proto today). Peer reviews need a **new** event that matches the stored row.

---

## Proto additions (applied 2026-08-11)

Applied to `proto/events/trust.proto` and `infra/k8s/base/config/proto/events/trust.proto`. Existing messages were not rewritten or removed.

```proto
// Emitted when a listing flag is submitted (status=pending).
// Not a confirmation. ListingFlaggedV1 remains the resolved/confirmed event.
message ListingFlagSubmittedV1 {
  string flag_id = 1;
  string listing_id = 2;
  string flagged_by = 3;
  string reason = 4;
  string description = 5;
  string submitted_at = 6;
}

// Emitted when a housing peer review is inserted.
// Matches trust.reviews: booking_id + target_id (reviewee). No listing_id/order_id.
message PeerReviewCreatedV1 {
  string review_id = 1;
  string booking_id = 2;
  string reviewer_id = 3;
  string reviewee_id = 4;
  int32 rating = 5;
  string comment = 6;
  string created_at = 7;
}
```

Existing messages stay:

| Message | Meaning after this draft | Writer required before enqueue |
| --- | --- | --- |
| `ListingFlaggedV1` | flag confirmed (`status=resolved`) | new moderation transition; **not** pending INSERT |
| `ListingUnflaggedV1` | flag dismissed / listing cleared | new unflag path |
| `ReviewCreatedV1` | listing/order review with real `listing_id` + `order_id` | none today; do not bind peer-review |
| `ReputationUpdatedV1` / `UserReputationUpdatedV1` | reputation counter change | none today; out of slice |
| `SellerVerifiedV1` | seller verification | none today; out of slice |

---

## Phase B P2 map (FROZEN for first enqueue slice)

| Mutation | Event | aggregate_id | Same-TX notes |
| --- | --- | --- | --- |
| HTTP/gRPC listing-flag **create** (`pending`) | `ListingFlagSubmittedV1` | `listing_id` | domain INSERT + outbox on one `PoolClient` |
| HTTP/gRPC listing-flag **resolve/confirm** | `ListingFlaggedV1` | `listing_id` | requires a new UPDATE `pending→resolved` writer; do not ship enqueue for this until that writer exists |
| HTTP `/peer-review`, gRPC `SubmitReview` / `SubmitPeerReview` | `PeerReviewCreatedV1` | `review_id` | `reviewee_id=target_id`; `BOOKING_HTTP` stays before `BEGIN` |
| report-abuse `user` | none | — | **OUT_OF_SCOPE** (no proto; optional later `UserFlagSubmittedV1`) |
| marketplace_feedback | none | — | **OUT_OF_SCOPE** |
| reputation / spam / suspension | none | — | **OUT_OF_SCOPE** |

`ListingFlaggedV1` enqueue is **not** part of the first Phase B surface unless a moderation transition is implemented in the same GO. First executable enqueue set is therefore:

1. `ListingFlagSubmittedV1` on pending listing-flag INSERT
2. `PeerReviewCreatedV1` on peer-review INSERT

---

## Enqueue COMMIT (E4) — required with P2, not a proto question

A PostgreSQL `COMMIT` error does not prove the transaction failed. Phase B enqueue must reuse publisher G7:

```text
COMMIT throws
  => UNKNOWN_PENDING_RECONCILIATION
  => fresh connection required

reconcile using frozen event_id plus domain identity:
  outbox exists + domain mutation exists
    => COMMIT_PERSISTED_RECOVERED

  neither exists
    => COMMIT_NOT_PERSISTED

  exactly one exists
    => INVARIANT_VIOLATION

  reconciliation unavailable
    => UNKNOWN_PENDING_RECONCILIATION

unknowns != 0 blocks acceptance
```

Do not treat COMMIT throw as “request failed; nothing persisted”.

---

## Explicit non-goals after writer wiring

- Do not invent `UserFlagSubmittedV1` unless user_flags is pulled into P2.
- Do not hang outbox INSERT off `02-trust-scoring.sql` triggers.
- Do not enable `TRUST_OUTBOX_PUBLISHER`.
- Do not modify `auth.outbox_events`.
- Do not claim Track C PASS.

---

## Freeze checklist (Phase B GO)

- [x] `ListingFlagSubmittedV1` added to `proto/events/trust.proto` + k8s mirror
- [x] `PeerReviewCreatedV1` added the same way
- [x] `ListingFlaggedV1` documented as resolve-only; no pending INSERT encoder
- [x] `ReviewCreatedV1` not bound to `trust.reviews` peer-review rows
- [x] P2 table frozen in the acceptance matrix
- [x] E4 G7 enqueue tests written (RED then GREEN) before writer wiring
- [x] Then, and only then, production writers + `11 / 1 / 0` flip
