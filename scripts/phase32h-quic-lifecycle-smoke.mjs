#!/usr/bin/env node
/**
 * Phase 32H-R1 — QUIC lifecycle smoke: cold, warm reuse, resumed 1-RTT, safe 0-RTT attempt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { login, loadN5Participants } from './lib/phase22-full-replay-common.mjs';
import { writeTransportCapabilities, parseTransportCapabilities, curlVersionText } from './lib/phase32h-transport-capabilities.mjs';
import { buildPcapCaptureIndex } from './lib/phase32h-probe-packet-index.mjs';
import { analyzePcapPacketSpace, classifyZeroRttOutcome } from './lib/phase32h-quic-packet-space.mjs';
import { scanPrivateFields } from './lib/phase32h-targeted-summary.mjs';
import {
  buildLifecycleCfg,
  runH3Attempted0RttProbe,
  runH3ColdProbe,
  runH3Resumed1RttProbe,
  runH3WarmReuseProbe,
} from './lib/phase32h-quic-lifecycle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { out: '/tmp/phase32h-r1-quic-lifecycle-smoke' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function latestPcap(outRoot) {
  const pcapDir = path.join(outRoot, 'pcap');
  if (!fs.existsSync(pcapDir)) return null;
  const files = fs
    .readdirSync(pcapDir)
    .filter((f) => f.endsWith('.pcapng') || f.endsWith('.pcap'))
    .map((f) => path.join(pcapDir, f));
  if (!files.length) return null;
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function writeTransportSummaries(outRoot, results, space) {
  const transportDir = path.join(outRoot, 'transport');
  fs.mkdirSync(transportDir, { recursive: true });
  const versions = {
    generated_at: new Date().toISOString(),
    client_supported_versions: ['0x00000001', '0x6b3343cf'],
    observed_versions: space?.observed_versions || [],
    negotiated_version_per_connection: space?.negotiated_versions || [],
    version_negotiation_packets: space?.counts?.version_negotiation_observed ? 1 : 0,
    retry_packets: space?.counts?.retry_packet_observed ? 1 : 0,
  };
  fs.writeFileSync(path.join(transportDir, 'quic-version-summary.json'), `${JSON.stringify(versions, null, 2)}\n`);
  fs.writeFileSync(
    path.join(transportDir, 'quic-packet-space-summary.json'),
    `${JSON.stringify(space?.counts || {}, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(transportDir, 'zero-rtt-summary.json'),
    `${JSON.stringify({ classification: results.attempted_0rtt?.classification, gate: results.attempted_0rtt?.gate }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(transportDir, 'one-rtt-summary.json'),
    `${JSON.stringify({ cold: results.cold?.record?.one_rtt_packets, warm: results.warm?.record?.one_rtt_packets }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(transportDir, 'session-resumption-summary.json'),
    `${JSON.stringify({ resumed_1rtt: results.resumed?.gate }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(transportDir, 'probe-packet-correlation.json'),
    `${JSON.stringify(
      Object.fromEntries(
        Object.entries(results).map(([k, v]) => [k, v?.record?.correlation_status || 'MISSING']),
      ),
      null,
      2,
    )}\n`,
  );
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('lifecycle smoke out must be under /tmp');
  fs.rmSync(opts.out, { recursive: true, force: true });
  fs.mkdirSync(opts.out, { recursive: true });

  const caps = writeTransportCapabilities(opts.out);
  const cfg = buildLifecycleCfg();
  const user = loadN5Participants()[0];
  const token = login(user.email, cfg);

  const pcapStart = spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
    cwd: REPO_ROOT,
  });
  if (pcapStart.status !== 0) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'pcap start failed', detail: pcapStart.stderr }, null, 2));
    process.exit(2);
  }

  const results = {};
  results.cold = runH3ColdProbe({ outRoot: opts.out, cfg, token, userId: user.uid, probeId: 'lifecycle-cold', pcapPath: null });
  sleepMs(3000);
  results.warm = runH3WarmReuseProbe({
    outRoot: opts.out,
    cfg,
    token,
    userId: user.uid,
    probeId: 'lifecycle-warm',
    pcapPath: null,
    primeFirst: true,
  });
  sleepMs(3000);
  results.resumed = runH3Resumed1RttProbe({
    outRoot: opts.out,
    cfg,
    token,
    userId: user.uid,
    probeId: 'lifecycle-resumed',
    pcapPath: null,
    capabilities: caps.payload,
  });
  sleepMs(3000);
  results.attempted_0rtt = runH3Attempted0RttProbe({
    outRoot: opts.out,
    cfg,
    token,
    userId: user.uid,
    probeId: 'lifecycle-0rtt',
    pcapPath: null,
    capabilities: caps.payload,
  });

  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh'), opts.out], { cwd: REPO_ROOT });
  const pcapPath = latestPcap(opts.out);
  buildPcapCaptureIndex(opts.out);

  let space = { counts: {}, observed_versions: [], negotiated_versions: [] };
  if (pcapPath) {
    space = analyzePcapPacketSpace(pcapPath);
    for (const [key, probeId] of [
      ['cold', 'lifecycle-cold'],
      ['warm', 'lifecycle-warm'],
      ['resumed', 'lifecycle-resumed'],
      ['attempted_0rtt', 'lifecycle-0rtt'],
    ]) {
      const prev = results[key];
      if (!prev || !pcapPath) continue;
      const corr = analyzePcapPacketSpace(pcapPath);
      const narrowed = corr.packets.filter(
        (p) =>
          p.time_epoch >= prev.result.started_epoch - 2 &&
          p.time_epoch <= prev.result.finished_epoch + 2,
      );
      prev.record = {
        ...prev.record,
        initial_packets: narrowed.filter((p) => p.packet_space === 'initial').length,
        handshake_packets: narrowed.filter((p) => p.packet_space === 'handshake').length,
        zero_rtt_packets: narrowed.filter((p) => p.packet_space === '0rtt').length,
        one_rtt_packets: narrowed.filter((p) => p.packet_space === '1rtt').length,
        one_rtt_confirmed: narrowed.some((p) => p.packet_space === '1rtt'),
        retry_packet_observed: narrowed.some((p) => p.packet_space === 'retry'),
        version_negotiation_observed: narrowed.some((p) => p.packet_space === 'version_negotiation'),
        quic_version: narrowed.find((p) => p.quic_version_label)?.quic_version_label || prev.record.quic_version,
        correlation_status: narrowed.length ? 'PASS' : 'PARTIAL',
        pcap_files: [pcapPath],
      };
      fs.writeFileSync(
        path.join(opts.out, 'probe-packet-index', `${probeId}.json`),
        `${JSON.stringify(prev.record, null, 2)}\n`,
      );
      if (key === 'attempted_0rtt') {
        prev.classification = classifyZeroRttOutcome({
          zeroRttPackets: prev.record.zero_rtt_packets,
          oneRttPackets: prev.record.one_rtt_packets,
          httpStatus: prev.result.http_status,
          earlyDataAttempted: caps.payload.zero_rtt_client_support === 'PROBABLE',
          clientUnsupported: caps.payload.zero_rtt_client_support === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED',
        });
      }
      if (key === 'resumed' && prev.classification == null) {
        prev.classification = prev.record?.session_resume_classification || null;
      }
    }
  }

  writeTransportSummaries(opts.out, results, space);

  const privateScan = scanPrivateFields(
    Object.values(results).map((r) => r.record).filter(Boolean),
  );

  const finalGates = {
    cold:
      results.cold?.result?.http_status === 200 &&
      results.cold?.record?.initial_packets > 0 &&
      results.cold?.record?.one_rtt_packets > 0,
    warm: results.warm?.result?.http_status === 200 && results.warm?.record?.one_rtt_packets > 0,
    resumed:
      results.resumed?.gate === 'PASS' ||
      results.resumed?.classification === 'CLIENT_SESSION_RESUME_UNSUPPORTED' ||
      results.resumed?.classification === 'RESUMED_1RTT_CONFIRMED',
    attempted_0rtt:
      results.attempted_0rtt?.gate === 'PASS' ||
      results.attempted_0rtt?.classification === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED' ||
      results.attempted_0rtt?.classification === 'ZERO_RTT_ACCEPTED' ||
      results.attempted_0rtt?.classification === 'ZERO_RTT_REJECTED_REPLAYED_AS_1RTT' ||
      results.attempted_0rtt?.classification === 'FULL_HANDSHAKE',
  };
  for (const [key, pass] of Object.entries(finalGates)) {
    if (results[key]) results[key].gate = pass ? 'PASS' : 'BLOCKED';
  }

  const overallBlocked = Object.values(finalGates).some((g) => !g);
  const report = {
    status: overallBlocked ? 'BLOCKED' : 'PASS',
    out: opts.out,
    capabilities: caps.payload,
    results: Object.fromEntries(
      Object.entries(results).map(([k, v]) => [
        k,
        {
          gate: v.gate,
          http_status: v.result?.http_status,
          classification: v.classification || v.record?.session_resume_classification || null,
          correlation: v.record?.correlation_status,
          initial: v.record?.initial_packets,
          handshake: v.record?.handshake_packets,
          zero_rtt: v.record?.zero_rtt_packets,
          one_rtt: v.record?.one_rtt_packets,
          quic_version: v.record?.quic_version,
        },
      ]),
    ),
    pcap_path: pcapPath,
    observed_versions: space.observed_versions,
    private_field_scan: privateScan,
    production_enablement: 'NOT APPROVED',
  };
  fs.writeFileSync(path.join(opts.out, 'phase32h-quic-lifecycle-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === 'PASS' ? 0 : 2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
