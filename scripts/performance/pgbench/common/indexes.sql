-- Partial indexes so per-cell bench outbox cleanup does not seq-scan production outbox_events.
-- Safe to re-run. Apply once per owner database at contract start.

DO $$
DECLARE
  sch text;
  idx text;
BEGIN
  FOR sch IN
    SELECT n.nspname
    FROM pg_namespace n
    WHERE EXISTS (
      SELECT 1
      FROM pg_class c
      WHERE c.relnamespace = n.oid
        AND c.relkind = 'r'
        AND c.relname = 'outbox_events'
    )
    ORDER BY 1
  LOOP
    idx := format('%s_outbox_pgbench_type_idx', sch);
    EXECUTE format(
      $f$
        CREATE INDEX IF NOT EXISTS %I
        ON %I.outbox_events (type)
        WHERE type IN ('PgbenchSeedV1', 'PgbenchDomainTouchV1')
      $f$,
      idx,
      sch
    );
  END LOOP;
END $$;
