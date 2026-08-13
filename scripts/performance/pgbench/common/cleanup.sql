-- Cleanup Gate-3 harness fixtures for the connected owner database.
-- Deletes only bench-typed outbox rows and pgbench_domain_touch rows.
-- Does not touch production domain tables or non-bench outbox event types.

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

    EXECUTE format(
      $f$
        DELETE FROM %I.pgbench_domain_touch
        WHERE note IS NULL
           OR note LIKE 'pgbench-%%'
           OR note LIKE 'w1-%%'
           OR note LIKE 'w2-%%'
           OR note LIKE 'wmix-%%'
      $f$,
      sch
    );
  END LOOP;
END $$;
