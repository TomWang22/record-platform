import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clusterOverlapping,
  curlPhaseDecomposition,
  buildRootCauseVerdict,
} from '../scripts/lib/phase32h-diagnostic-correlation.mjs';

describe('phase32h diagnostic correlation', () => {
  it('classifies request-to-first-byte dominated stalls', () => {
    const { classification } = curlPhaseDecomposition({
      curl_time_namelookup_ms: 5,
      curl_time_connect_ms: 20,
      curl_time_appconnect_ms: 40,
      curl_time_pretransfer_ms: 45,
      curl_time_starttransfer_ms: 1_000_050,
      curl_time_total_ms: 1_000_100,
    });
    assert.equal(classification, 'request-to-first-byte dominated');
  });

  it('clusters overlapping extreme rows across protocols', () => {
    const start = '2026-07-11T06:40:06.000Z';
    const end = '2026-07-11T06:56:54.000Z';
    const rows = ['HTTP/1.1', 'HTTP/2', 'HTTP/3'].map((proto, i) => ({
      probe_id: 100 + i,
      protocol_label: proto,
      timing: {
        wall_total_ms: 1_008_000,
        probe_started_at: start,
        probe_finished_at: end,
      },
    }));
    const clusters = clusterOverlapping(rows);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].all_three_protocols, true);
    assert.equal(clusters[0].count, 3);
  });

  it('defaults root cause to UNRESOLVED verdict F', () => {
    const verdict = buildRootCauseVerdict([]);
    assert.equal(verdict.underlying_root_cause, 'UNRESOLVED');
    assert.equal(verdict.verdict_choice, 'F');
    assert.equal(verdict.production_enablement, 'NOT APPROVED');
  });
});
