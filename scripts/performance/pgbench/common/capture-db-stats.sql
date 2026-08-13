-- Capture per-relation counters for Gate-3 harness tables on the connected DB.

SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  n_tup_ins,
  n_tup_upd,
  n_tup_del,
  seq_scan,
  idx_scan
FROM pg_stat_user_tables
WHERE relname IN ('outbox_events', 'pgbench_domain_touch')
ORDER BY schemaname, relname;
