-- Seed Gate-3 harness fixtures for the connected owner database.
-- Inserts domain-touch rows + unpublished outbox rows (PgbenchSeedV1) so W3 has claimable work.
-- Safe: only touches schemas that already have both pgbench_domain_touch and outbox_events.

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT n.nspname
    FROM pg_namespace n
    WHERE EXISTS (
      SELECT 1
      FROM pg_class c
      WHERE c.relnamespace = n.oid
        AND c.relkind = 'r'
        AND c.relname = 'pgbench_domain_touch'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_class c
      WHERE c.relnamespace = n.oid
        AND c.relkind = 'r'
        AND c.relname = 'outbox_events'
    )
    ORDER BY 1
  LOOP
    EXECUTE format(
      $f$
        INSERT INTO %I.pgbench_domain_touch (id, touched_at, note)
        SELECT gen_random_uuid(), now(), 'pgbench-seed'
        FROM generate_series(1, 64)
      $f$,
      sch
    );

    EXECUTE format(
      $f$
        INSERT INTO %I.outbox_events (
          id, aggregate_id, type, version, payload, published
        )
        SELECT
          gen_random_uuid(),
          gen_random_uuid()::text,
          'PgbenchSeedV1',
          1,
          convert_to('{"bench":true,"seed":true}', 'UTF8')::bytea,
          false
        FROM generate_series(1, 256)
      $f$,
      sch
    );
  END LOOP;
END $$;
