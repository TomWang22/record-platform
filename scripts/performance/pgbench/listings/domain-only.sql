-- W1_DOMAIN_ONLY (listings): real mutation against harness domain-touch table.
-- Table: listings.pgbench_domain_touch (infra/db/99-pgbench-domain-touch.sql)
-- No outbox insert in this workload.
-- Variable style: \set name random(lo,hi) (modern replacement for \setrandom).

\set id random(1, 2147483647)

BEGIN;
INSERT INTO listings.pgbench_domain_touch (id, touched_at, note)
VALUES (
  md5(:id::text || 'w1')::uuid,
  now(),
  'w1-domain-touch'
)
ON CONFLICT (id) DO UPDATE
  SET touched_at = EXCLUDED.touched_at,
      note = EXCLUDED.note;
END;
