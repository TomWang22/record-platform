/**
 * Phase 32H — diagnostic evidence correlation helpers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXTREME_THRESHOLD_MS } from './phase32h-targeted-reproduction-config.mjs';

export function curlPhaseDecomposition(timing = {}) {
  const lookup = timing.curl_time_namelookup_ms ?? 0;
  const connect = timing.curl_time_connect_ms ?? 0;
  const appconnect = timing.curl_time_appconnect_ms ?? 0;
  const pretransfer = timing.curl_time_pretransfer_ms ?? 0;
  const starttransfer = timing.curl_time_starttransfer_ms ?? 0;
  const curlTotal = timing.curl_time_total_ms ?? 0;
  const phases = {
    dns_ms: lookup,
    tcp_connect_ms: connect - lookup,
    tls_ms: appconnect - connect,
    request_to_first_byte_ms: starttransfer - pretransfer,
    body_transfer_ms: curlTotal - starttransfer,
  };
  let classification = 'unknown';
  const rtfb = phases.request_to_first_byte_ms;
  if (rtfb >= EXTREME_THRESHOLD_MS * 0.8) classification = 'request-to-first-byte dominated';
  else if (phases.dns_ms >= EXTREME_THRESHOLD_MS * 0.5) classification = 'DNS dominated';
  else if (phases.tcp_connect_ms >= EXTREME_THRESHOLD_MS * 0.5)
    classification = 'TCP connect dominated';
  else if (phases.tls_ms >= EXTREME_THRESHOLD_MS * 0.5) classification = 'TLS dominated';
  else if (phases.body_transfer_ms >= EXTREME_THRESHOLD_MS * 0.5)
    classification = 'response-body transfer dominated';
  else if ((timing.unattributed_ms ?? 0) >= 10_000) classification = 'client/process stall';
  return { phases, classification };
}

export function clusterOverlapping(rows) {
  const extremes = rows
    .filter((r) => (r.timing?.wall_total_ms ?? 0) >= EXTREME_THRESHOLD_MS)
    .map((r) => ({
      ...r,
      start: Date.parse(r.timing?.probe_started_at ?? ''),
      end: Date.parse(r.timing?.probe_finished_at ?? ''),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end));
  const clusters = [];
  for (const row of extremes) {
    let placed = false;
    for (const cluster of clusters) {
      const overlaps = cluster.rows.some(
        (r) => row.start <= r.end && r.start <= row.end,
      );
      if (overlaps) {
        cluster.rows.push(row);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ rows: [row] });
  }
  return clusters
    .map((c) => ({
      count: c.rows.length,
      protocols: [...new Set(c.rows.map((r) => r.protocol_label))],
      all_three_protocols: new Set(c.rows.map((r) => r.protocol_label)).size === 3,
      start_min: new Date(Math.min(...c.rows.map((r) => r.start))).toISOString(),
      end_max: new Date(Math.max(...c.rows.map((r) => r.end))).toISOString(),
      probe_ids: c.rows.map((r) => ({
        id: r.probe_id,
        protocol: r.protocol_label,
        wall: r.timing?.wall_total_ms,
      })),
    }))
    .sort((a, b) => b.count - a.count);
}

export function buildRootCauseVerdict(rows, captureStatus = {}) {
  const extremes = rows.filter((r) => (r.timing?.wall_total_ms ?? 0) >= EXTREME_THRESHOLD_MS);
  const clusters = clusterOverlapping(rows);
  const curlClasses = {};
  for (const row of extremes) {
    const { classification } = curlPhaseDecomposition(row.timing);
    curlClasses[classification] = (curlClasses[classification] ?? 0) + 1;
  }
  return {
    generated_at: new Date().toISOString(),
    extreme_count: extremes.length,
    synchronized_all_three_clusters: clusters.filter((c) => c.all_three_protocols).length,
    largest_cluster: clusters[0] ?? null,
    curl_phase_classification: curlClasses,
    capture_status: captureStatus,
    underlying_root_cause: 'UNRESOLVED',
    verdict_choice: 'F',
    verdict_label: 'Reproduced but still unresolved',
    production_enablement: 'NOT APPROVED',
  };
}

export function writeCorrelationArtifacts(outRoot, rows, captureStatus) {
  fs.mkdirSync(outRoot, { recursive: true });
  const verdict = buildRootCauseVerdict(rows, captureStatus);
  const paths = {
    extreme_events: path.join(outRoot, 'phase32h-extreme-events.json'),
    extreme_clusters: path.join(outRoot, 'phase32h-extreme-clusters.json'),
    root_cause_verdict: path.join(outRoot, 'phase32h-root-cause-verdict.json'),
  };
  const extremes = rows.filter((r) => (r.timing?.wall_total_ms ?? 0) >= EXTREME_THRESHOLD_MS);
  fs.writeFileSync(paths.extreme_events, `${JSON.stringify(extremes, null, 2)}\n`);
  fs.writeFileSync(
    paths.extreme_clusters,
    `${JSON.stringify(clusterOverlapping(rows), null, 2)}\n`,
  );
  fs.writeFileSync(paths.root_cause_verdict, `${JSON.stringify(verdict, null, 2)}\n`);
  return { verdict, paths };
}
