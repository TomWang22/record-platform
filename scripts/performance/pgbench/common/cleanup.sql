-- Cleanup Gate-3 harness fixtures for the connected owner database.
-- pgbench_domain_touch is a harness-only table: TRUNCATE, never production domain tables.
-- Outbox deletes only bench-typed rows (PgbenchSeedV1 / PgbenchDomainTouchV1).

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
    ORDER BY 1
  LOOP
    EXECUTE format('TRUNCATE TABLE %I.pgbench_domain_touch', sch);

    IF EXISTS (
      SELECT 1
      FROM pg_class c
      WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = sch)
        AND c.relkind = 'r'
        AND c.relname = 'outbox_events'
    ) THEN
      EXECUTE format(
        $f$
          DELETE FROM %I.outbox_events
          WHERE type IN ('PgbenchSeedV1', 'PgbenchDomainTouchV1')
        $f$,
        sch
      );
    END IF;
  END LOOP;
END $$;
