#!/usr/bin/env bash
# Script to update run_pgbench_sweep.sh with complete percentile reporting

FILE="scripts/run_pgbench_sweep.sh"

# Update Peak TPS Summary to include all percentiles
# Find the section that starts with "# Peak TPS summary" and update it
sed -i.bak '
/# Peak TPS summary/,/^SQL$/ {
  /-- Format matches gold run exactly:/ {
    s/-- Format matches gold run exactly:.*/-- Format includes all percentiles: variant | clients | tps | lat_est_ms | p50_ms | p95_ms | p99_ms | p999_ms | p9999_ms | p99999_ms | p999999_ms | p9999999_ms | p100_ms/
  }
  /ROUND(p9999_ms::numeric, 3) AS p9999_ms/ {
    a\
  ROUND(p99999_ms::numeric, 3) AS p99999_ms,\
  ROUND(p999999_ms::numeric, 3) AS p999999_ms,\
  ROUND(p9999999_ms::numeric, 3) AS p9999999_ms,
  }
}' "$FILE"

# Add Latency Cuts section after "Peak Performance Summary" if it doesn't exist
if ! grep -q "Latency Cuts by Phase" "$FILE"; then
  # Find the line number where "Expected vs Reality Analysis" starts
  LINE_NUM=$(grep -n "^# Comprehensive Expected vs Reality Analysis" "$FILE" | cut -d: -f1)
  if [[ -n "$LINE_NUM" ]]; then
    # Insert Latency Cuts section before that line
    sed -i.bak "${LINE_NUM}i\\
# Latency Cut Reporting (cold and warm phases)\\
echo \"=== Latency Cuts by Phase (this run: \$RUN_ID) ===\"\\
psql_in_pod -v run_id=\"\$RUN_ID\" <<'SQL' | tee \"\$LOG_DIR/latency_cuts.txt\"\\
-- Comprehensive latency cut reporting for both cold and warm phases\\
-- Shows all percentiles (p50, p95, p99, p999, p9999, p99999, p999999, p9999999, p100) for each variant+clients+phase combo\\
SELECT \\
  variant,\\
  phase,\\
  clients,\\
  ROUND(tps::numeric, 2) AS tps,\\
  ROUND(p50_ms::numeric, 3) AS p50_ms,\\
  ROUND(p95_ms::numeric, 3) AS p95_ms,\\
  ROUND(p99_ms::numeric, 3) AS p99_ms,\\
  ROUND(p999_ms::numeric, 3) AS p999_ms,\\
  ROUND(p9999_ms::numeric, 3) AS p9999_ms,\\
  ROUND(p99999_ms::numeric, 3) AS p99999_ms,\\
  ROUND(p999999_ms::numeric, 3) AS p999999_ms,\\
  ROUND(p9999999_ms::numeric, 3) AS p9999999_ms,\\
  ROUND(p100_ms::numeric, 3) AS p100_ms\\
FROM bench.results\\
WHERE variant IN ('knn', 'trgm', 'noop')\\
  AND tps IS NOT NULL\\
  AND phase IN ('cold', 'warm')\\
  AND run_id = :'run_id'\\
ORDER BY \\
  CASE variant WHEN 'knn' THEN 1 WHEN 'trgm' THEN 2 WHEN 'noop' THEN 3 END,\\
  CASE phase WHEN 'cold' THEN 1 WHEN 'warm' THEN 2 END,\\
  clients;\\
SQL\\
echo \"\"\\
" "$FILE"
  fi
fi

echo "✅ Updated $FILE with complete percentile reporting and latency cuts"

