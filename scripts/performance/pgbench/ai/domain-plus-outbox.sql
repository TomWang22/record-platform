-- W2_DOMAIN_PLUS_OUTBOX (ai): same-TX domain touch + outbox insert.
-- Outbox: ai.outbox_events (canonical; auth uses auth.outbox_events only).
-- pgbench vars: :event_id :aggregate_id (and :touch_id for domain row).

\set touch_id random(1, 2147483647)
\set event_id random(1, 2147483647)
\set aggregate_id random(1, 2147483647)

BEGIN;
INSERT INTO ai.pgbench_domain_touch (id, touched_at, note)
VALUES (
  md5(:touch_id::text || 'w2t')::uuid,
  now(),
  'w2-domain-touch'
)
ON CONFLICT (id) DO UPDATE
  SET touched_at = EXCLUDED.touched_at,
      note = EXCLUDED.note;

INSERT INTO ai.outbox_events (
  id, aggregate_id, type, version, payload, published
) VALUES (
  md5(:event_id::text || 'w2e')::uuid,
  md5(:aggregate_id::text || 'w2a'),
  'PgbenchDomainTouchV1',
  1,
  convert_to('{"bench":true}', 'UTF8')::bytea,
  false
);
END;
