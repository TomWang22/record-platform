# GDPR-oriented account deletion and “Reddit-style” anonymization

When a user deletes their account, **auth** is the source of truth for login eligibility. Downstream services still hold **posts, messages, and metadata** that reference `user_id`. Typical product policy (similar to Reddit-style deleted accounts):

- **Keep** thread / conversation integrity (messages and posts remain visible where policy allows).
- **Remove** personal identifiers from the **display surface**: show a **stable pseudonym** (e.g. `deleted_user_x7f2`) instead of the real display name or email.
- **Do not** require the auth row to still exist: consumers must react to **`user.account.deleted.v1`** on **`${ENV_PREFIX}.user.lifecycle.v1`**.

## Event contract

- **Proto**: `events.auth.UserAccountDeletedV1` in `proto/events/auth.proto`.
- **Outbox**: `auth.outbox_events` row with `type = user.account.deleted.v1`, `payload` = serialized `UserAccountDeletedV1`, `aggregate_id = user_id`, `id` = event UUID.
- **Kafka**: Publisher wraps **`EventEnvelope`**; topic **`${ENV_PREFIX}.user.lifecycle.v1`**; key = `user_id`.

**Auth-service emission** (transactional insert + delete) is **deferred** until the auth subsystem is redesigned end-to-end. Until then, document the contract here and use **`@common/utils/outbox`** (`buildKafkaMessageFromOutboxRow`, tests under `services/common`) plus a separate **outbox publisher** worker to read `auth.outbox_events`, wrap **`EventEnvelope`**, and produce to **`${ENV_PREFIX}.user.lifecycle.v1`** (not `${ENV_PREFIX}.auth.events`) for `type = user.account.deleted.v1` — see **`docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md`**.

## Pseudonym generation (application-level)

Pick one strategy per service (be consistent in UX):

1. **Deterministic from user id** (stable across retries): e.g. `deleted_${base32(user_id).slice(0, 12)}` so the same user always maps to the same label.
2. **Random once per deletion event**: store `anonymized_label` in a small **deletion ledger** table keyed by `user_id` if you need stability across services without sharing the algorithm.
3. **Adjective + noun + short id** (Reddit-like feel): generate random tokens at consume time; persist per `user_id` in each domain DB the first time you anonymize.

Never re-use the real **email**, **phone**, or **full name** in the label.

## Consumer responsibilities (by domain)

Each service that stores author/sender presentation fields should:

1. Subscribe to **`${ENV_PREFIX}.user.lifecycle.v1`** (or receive fan-out from a bridge).
2. **Idempotency**: `processed_events` keyed by `envelope.event_id`.
3. On `user.account.deleted.v1` with `deletion_mode = "anonymize"` and `gdpr_erasure = true`:
   - **Messaging / social**: `UPDATE … SET display_name = $pseudonym, avatar_url = NULL, … WHERE user_id = $user_id` on tables that power UI (exact columns depend on your schema).
   - **Forum posts**: set `author_display_name` / denormalized author fields; keep `user_id` or replace with a **sentinel UUID** only if FK policy requires (prefer keeping id + anonymized label for analytics consistency).
   - **Listings / booking / trust**: redact or anonymize PII fields that surface in UI; keep financial/legal records per retention policy (separate compliance doc).
4. Optionally emit **`UserDeletionAckV1`** to **`${ENV_PREFIX}.user.lifecycle.ack.v1`**.

## Schema hints

- Prefer nullable **`display_name`** / **`author_name`** columns you can overwrite without deleting rows.
- See **`docs/SOCIAL_ROLE_MUTATION.md`** for related social DB discussion.

## Related

- **`proto/events/README.md`** — topics list  
- **`docs/OUTBOX_PROTO_TOPIC_MATRIX.md`** — outbox ↔ proto ↔ topic  
- **`docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md`** — envelope + idempotency  
