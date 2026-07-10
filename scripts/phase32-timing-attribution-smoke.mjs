#!/usr/bin/env node
/**
 * Phase 32C — timing attribution smoke (fixture only, /tmp output).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertAllowedOutputPath,
  assertRedactedProbeRow,
  attachTimingToProbeRow,
  buildTimingAttribution,
  validateTimingAttribution,
} from './lib/phase32-timing-attribution.mjs';

const OUT_DIR = '/tmp/phase32-timing-attribution-smoke';

function main() {
  assertAllowedOutputPath(OUT_DIR);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const timing = buildTimingAttribution({
    probe_started_at: '2026-07-10T16:00:00.000Z',
    probe_finished_at: '2026-07-10T16:00:01.250Z',
    curl_time_total_ms: 420.5,
    rag_total_ms: 318.2,
    coordinator_wait_ms: 12,
    window_reset_ms: 55,
    pre_probe_gate_verify_ms: 8,
    retry_count: 1,
    retry_delay_ms: 250,
    kpi_query_write_ms: 40,
    kpi_usefulness_write_ms: 0,
    jsonl_write_ms: 1.2,
  });
  validateTimingAttribution(timing);

  const row = attachTimingToProbeRow(
    {
      probe_id: 1,
      protocol_label: 'HTTP/1.1',
      matrix_protocol: 'h1',
      window: 13,
      run: 3,
      case_id: 'final_tagged_plan',
      user_class: 'real_participant',
      expected_gate_reason: 'preview_opt_in',
      gate_reason: 'preview_opt_in',
      http_status: 200,
      evidence_label: 'phase32-timing-attribution-smoke',
    },
    timing,
  );
  assertRedactedProbeRow(row);

  const outPath = path.join(OUT_DIR, 'phase32-timing-attribution-smoke.json');
  fs.writeFileSync(outPath, `${JSON.stringify({ status: 'PASS', row }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', out: outPath, timing }, null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
