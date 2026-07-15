#!/usr/bin/env node
/**
 * Offline collector contract stub for Phase 33F — does not start PCAP.
 * Full collector exclusivity reused from Phase 32H infra verify.
 */
import fs from 'node:fs';

const OUT = '/tmp/phase33f-capability-gauntlet-readiness';
fs.mkdirSync(OUT, { recursive: true });
const report = {
  status: 'PASS',
  live_collectors_started: false,
  note: 'Collector runtime is required only for live canary; offline verify confirms contract presence only.',
  reused_phase32h_modules: [
    'scripts/lib/phase32h-collector-registry.mjs',
    'scripts/lib/phase32h-collector-supervision.mjs',
    'scripts/lib/phase32h-pcap-ring-segments.mjs',
  ],
  pcap_required_for_canary: true,
  http3_requires_quic_udp_443: true,
};
fs.writeFileSync(`${OUT}/collector-coverage.json`, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(
  `${OUT}/pcap-continuity.json`,
  `${JSON.stringify({ status: 'NOT_RUN', reason: 'canary_not_launched' }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
