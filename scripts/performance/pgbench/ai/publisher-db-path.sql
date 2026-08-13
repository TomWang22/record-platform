-- W3_PUBLISHER_DB_PATH (ai): claim unpublished outbox + mark published.
-- Kafka broker ack is simulated OUTSIDE pgbench (DB path cost only).
-- REQUIRED: pass -D batch=N (Gate-3 publisher_batches: 1|10|25|50).
-- \set jitter random(...) stands in for legacy \setrandom jitter lo hi.

\set jitter random(1, 1000000)

BEGIN;
WITH claimed AS (
  SELECT id
  FROM ai.outbox_events
  WHERE published = false
  ORDER BY created_at
  LIMIT :batch
  FOR UPDATE SKIP LOCKED
)
UPDATE ai.outbox_events AS o
SET published = true
FROM claimed
WHERE o.id = claimed.id
  AND o.published = false;
END;
