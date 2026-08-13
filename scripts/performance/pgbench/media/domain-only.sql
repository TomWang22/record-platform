-- W1_DOMAIN_ONLY (media): real mutation against harness domain-touch table.
-- Table: media.pgbench_domain_touch (infra/db/99-pgbench-domain-touch.sql)
-- No outbox insert in this workload.
-- Variable style: \set name random(lo,hi) (modern replacement for \setrandom).

\set id random(1, 2147483647)

BEGIN;
INSERT INTO media.pgbench_domain_touch (id, touched_at, note)
VALUES (
  md5(:id::text || 'w1')::uuid,
  now(),
  'w1-domain-touch'
)
ON CONFLICT (id) DO UPDATE
  SET touched_at = EXCLUDED.touched_at,
      note = EXCLUDED.note;
END;
