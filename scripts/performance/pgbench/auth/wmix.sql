-- WMIX_OWNER_RANDOMIZED (auth): weighted mix of W1 / W2 / W3 style statements.
-- Weights: W1 40%, W2 40%, W3 20%.
-- \set pick random(1,100) is the modern form of \setrandom pick 1 100.
-- W3 branch requires -D batch=N.

\set pick random(1, 100)
\set id random(1, 2147483647)
\set touch_id random(1, 2147483647)
\set event_id random(1, 2147483647)
\set aggregate_id random(1, 2147483647)

\if :pick <= 40
BEGIN;
INSERT INTO auth.pgbench_domain_touch (id, touched_at, note)
VALUES (
  md5(:id::text || 'mw1')::uuid,
  now(),
  'wmix-w1-domain-touch'
)
ON CONFLICT (id) DO UPDATE
  SET touched_at = EXCLUDED.touched_at,
      note = EXCLUDED.note;
END;
\elif :pick <= 80
BEGIN;
INSERT INTO auth.pgbench_domain_touch (id, touched_at, note)
VALUES (
  md5(:touch_id::text || 'mw2t')::uuid,
  now(),
  'wmix-w2-domain-touch'
)
ON CONFLICT (id) DO UPDATE
  SET touched_at = EXCLUDED.touched_at,
      note = EXCLUDED.note;
INSERT INTO auth.outbox_events (
  id, aggregate_id, type, version, payload, published
) VALUES (
  md5(:event_id::text || 'mw2e')::uuid,
  md5(:aggregate_id::text || 'mw2a'),
  'PgbenchDomainTouchV1',
  1,
  convert_to('{"bench":true}', 'UTF8')::bytea,
  false
);
END;
\else
BEGIN;
WITH claimed AS (
  SELECT id
  FROM auth.outbox_events
  WHERE published = false
  ORDER BY created_at
  LIMIT :batch
  FOR UPDATE SKIP LOCKED
)
UPDATE auth.outbox_events AS o
SET published = true
FROM claimed
WHERE o.id = claimed.id
  AND o.published = false;
END;
\endif
