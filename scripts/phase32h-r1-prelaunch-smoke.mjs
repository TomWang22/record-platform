#!/usr/bin/env node
/**
 * Phase 32H-R1-T — prelaunch smoke: capture + synchronized triplets + lifecycle mini-matrix.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { login, loadN5Participants } from './lib/phase22-full-replay-common.mjs';
import { buildPhase32hSmokeManifest } from './lib/phase32h-smoke-manifest.mjs';
import { assertManifestContract } from './lib/phase32h-manifest-contract.mjs';
import { writeTransportCapabilities } from './lib/phase32h-transport-capabilities.mjs';
import { buildPcapCaptureIndex } from './lib/phase32h-probe-packet-index.mjs';
import {
  analyzePcapPacketSpace,
  applyClientZeroRttCapabilityFilter,
  classifyZeroRttOutcome,
  coldH3GatePass,
  correlateProbeToPackets,
  inferHandshakeEvidence,
  warmH3ReuseProof,
} from './lib/phase32h-quic-packet-space.mjs';
import { scanPrivateFields } from './lib/phase32h-targeted-summary.mjs';
import {
  buildLifecycleCfg,
  runH3Attempted0RttProbe,
  runH3ColdProbe,
  runH3Resumed1RttProbe,
  runH3WarmReuseProbe,
} from './lib/phase32h-quic-lifecycle.mjs';
import { groupManifestIntoTriplets } from './lib/phase32h-triplet-manifest.mjs';
import { executeTripletBatch } from './lib/phase32h-triplet-orchestrator.mjs';
import { evaluatePrelaunchGuard } from './lib/phase32h-r1-prelaunch-guard.mjs';
import {
  coordinatorRootFromRunnerOut,
  PreviewWindowCoordinator,
  resetAndVerifyWindowGates,
} from './lib/phase31-preview-window-coordinator.mjs';
import { DEFAULTS, PROTOCOLS, resolveCurlTarget } from './lib/phase22-full-replay-common.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { out: '/tmp/phase32h-r1-prelaunch-smoke' };
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

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('prelaunch smoke out must be under /tmp');
  fs.rmSync(opts.out, { recursive: true, force: true });
  fs.mkdirSync(opts.out, { recursive: true });

  const caps = writeTransportCapabilities(opts.out);
  const clientUnsupported = caps.payload.zero_rtt_client_support === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED';

  const pcapStart = spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
    cwd: REPO_ROOT,
  });
  if (pcapStart.status !== 0) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'pcap start failed' }, null, 2));
    process.exit(2);
  }

  const cfg = buildLifecycleCfg();
  const user = loadN5Participants()[0];
  const token = login(user.email, cfg);

  const lifecycle = {};
  lifecycle.cold = runH3ColdProbe({
    outRoot: opts.out,
    cfg,
    token,
    userId: user.uid,
    probeId: 'lifecycle-cold',
    pcapPath: null,
    capabilities: caps.payload,
  });
  sleepMs(2000);
  lifecycle.warm = runH3WarmReuseProbe({
    outRoot: opts.out,
    cfg,
    token,
    userId: user.uid,
    probeId: 'lifecycle-warm',
    pcapPath: null,
    capabilities: caps.payload,
  });
  sleepMs(2000);
  lifecycle.resumed = runH3Resumed1RttProbe({
    outRoot: opts.out,
    cfg,
    token,
    userId: user.uid,
    probeId: 'lifecycle-resumed',
    pcapPath: null,
    capabilities: caps.payload,
  });
  sleepMs(2000);
  lifecycle.attempted_0rtt = runH3Attempted0RttProbe({
    outRoot: opts.out,
    cfg,
    token,
    userId: user.uid,
    probeId: 'lifecycle-0rtt',
    pcapPath: null,
    capabilities: caps.payload,
  });

  const previewUser = loadN5Participants().find((u) => u.user_class === 'real_participant');
  const smokeRows = buildPhase32hSmokeManifest(previewUser);
  assertManifestContract(smokeRows, {
    evidenceLabel: smokeRows[0]?.evidence_label,
    expectedTotal: 6,
    expectedPerProtocol: 2,
  });
  const tripletBatches = groupManifestIntoTriplets(smokeRows);
  const coldBatch = tripletBatches[0];
  const warmBatch = tripletBatches[0];

  const matrixCfg = {
    ...DEFAULTS,
    password: cfg.password,
    curlResolve: resolveCurlTarget(DEFAULTS.baseUrl),
    ragPauseMs: 50,
    mgmtProto: PROTOCOLS.h1,
  };
  const users = loadN5Participants();
  const getToken = (email) => login(email, matrixCfg);
  const coordinator = new PreviewWindowCoordinator(coordinatorRootFromRunnerOut(opts.out), {
    matrixId: 'phase32h-r1-prelaunch-smoke',
    windowSequence: [1],
    expectedProtocols: ['triplet'],
  });

  const tripletCold = await executeTripletBatch({
    outRoot: opts.out,
    batch: coldBatch,
    cfg: matrixCfg,
    runId: 'prelaunch-smoke',
    launchHead: gitSha(),
    manifestSha: 'smoke',
    evidenceLabel: 'Phase 32H-R1 prelaunch smoke',
    coordinator,
    probeContext: {
      resetAndVerify: () => resetAndVerifyWindowGates(users, getToken, matrixCfg),
    },
  });

  const tripletWarm = await executeTripletBatch({
    outRoot: opts.out,
    batch: warmBatch,
    cfg: matrixCfg,
    runId: 'prelaunch-smoke',
    launchHead: gitSha(),
    manifestSha: 'smoke',
    evidenceLabel: 'Phase 32H-R1 prelaunch smoke warm',
    coordinator,
    probeContext: {
      resetAndVerify: () => resetAndVerifyWindowGates(users, getToken, matrixCfg),
    },
  });

  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh'), opts.out], { cwd: REPO_ROOT });
  const pcapPath = latestPcap(opts.out);
  buildPcapCaptureIndex(opts.out);

  const pcapIndex = JSON.parse(
    fs.readFileSync(path.join(opts.out, 'pcap/capture-index.json'), 'utf8'),
  );

  if (pcapPath) {
    for (const [key, probeId] of [
      ['cold', 'lifecycle-cold'],
      ['warm', 'lifecycle-warm'],
      ['resumed', 'lifecycle-resumed'],
      ['attempted_0rtt', 'lifecycle-0rtt'],
    ]) {
      const prev = lifecycle[key];
      if (!prev) continue;
      const space = analyzePcapPacketSpace(pcapPath, {
        zeroRttAttempted: key === 'attempted_0rtt' && !clientUnsupported,
        clientUnsupported,
        connectionMode: prev.mode || key,
      });
      const narrowed = correlateProbeToPackets(
        space.packets,
        prev.result.started_epoch,
        prev.result.finished_epoch,
      );
      narrowed.counts = applyClientZeroRttCapabilityFilter(narrowed.counts, {
        zeroRttAttempted: key === 'attempted_0rtt' && !clientUnsupported,
        clientUnsupported,
        connectionMode: prev.mode || key,
      });
      prev.record = {
        ...prev.record,
        initial_packets: narrowed.counts.initial_packets,
        handshake_packets: narrowed.counts.handshake_packets,
        zero_rtt_packets: narrowed.counts.zero_rtt_packets,
        zero_rtt_observed: narrowed.counts.zero_rtt_packets > 0,
        wire_zero_rtt_frames: narrowed.counts.wire_zero_rtt_frames,
        one_rtt_packets: narrowed.counts.one_rtt_packets,
        one_rtt_confirmed: narrowed.counts.one_rtt_packets > 0,
        classifier_contradiction: narrowed.counts.classifier_contradiction,
        classifier_notes: narrowed.counts.classifier_notes,
        correlation_status: narrowed.correlation_status,
        pcap_files: [pcapPath],
        quic_version:
          narrowed.packets.find((p) => p.quic_version_label)?.quic_version_label ||
          prev.record.quic_version,
      };
      fs.writeFileSync(
        path.join(opts.out, 'probe-packet-index', `${probeId}.json`),
        `${JSON.stringify(prev.record, null, 2)}\n`,
      );
      if (key === 'cold') {
        const handshakeEvidence = inferHandshakeEvidence({
          counts: narrowed.counts,
          connectionMode: 'cold',
          hasKeylog: caps.payload.keylog_support,
        });
        prev.handshake_evidence = handshakeEvidence;
        prev.record.handshake_evidence = handshakeEvidence.status;
        prev.record.handshake_inference_reason = handshakeEvidence.inference_reason;
        prev.gate = coldH3GatePass({
          httpStatus: prev.result.http_status,
          versionOk: prev.result.version_ok,
          counts: narrowed.counts,
          handshakeEvidence,
          classifierContradiction: narrowed.counts.classifier_contradiction,
          correlationStatus: narrowed.correlation_status,
        })
          ? 'PASS'
          : 'BLOCKED';
      }
      if (key === 'warm') {
        const pairStart = prev.pair_started_epoch ?? prev.result.started_epoch - 1;
        const pairEnd = prev.pair_finished_epoch ?? prev.result.finished_epoch;
        const primeNarrowed = correlateProbeToPackets(space.packets, pairStart, pairStart + 1);
        const reuseNarrowed = correlateProbeToPackets(
          space.packets,
          prev.result.started_epoch,
          pairEnd,
        );
        prev.warm_reuse_proof = warmH3ReuseProof(
          primeNarrowed.packets,
          reuseNarrowed.packets,
          { clientUnsupported, zeroRttAttempted: false },
        );
        prev.record.warm_reuse_proof = prev.warm_reuse_proof;
        prev.gate =
          prev.warm_reuse_proof?.pass &&
          prev.result.http_status === 200 &&
          !narrowed.counts.classifier_contradiction
            ? 'PASS'
            : 'BLOCKED';
      }
      if (key === 'resumed') {
        prev.gate =
          prev.classification === 'CLIENT_SESSION_RESUME_UNSUPPORTED' &&
          !narrowed.counts.classifier_contradiction
            ? 'PASS'
            : 'BLOCKED';
      }
      if (key === 'attempted_0rtt') {
        prev.classification = classifyZeroRttOutcome({
          zeroRttPackets: narrowed.counts.zero_rtt_packets,
          oneRttPackets: narrowed.counts.one_rtt_packets,
          httpStatus: prev.result.http_status,
          earlyDataAttempted: false,
          clientUnsupported,
          classifierContradiction: narrowed.counts.classifier_contradiction,
        });
        prev.gate =
          prev.classification === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED' &&
          !narrowed.counts.classifier_contradiction
            ? 'PASS'
            : 'BLOCKED';
      }
    }
  }

  const classifierContradiction = Object.values(lifecycle).some(
    (v) => v.record?.classifier_contradiction || v.classification === 'CLASSIFIER_CONTRADICTION',
  );

  const report = {
    status: 'PASS',
    phase: '32H-R1-T',
    out: opts.out,
    capabilities: caps.payload,
    classifier_contradiction: classifierContradiction,
    lifecycle,
    triplet_cold: {
      start_spread_ms: tripletCold.batchRecord.start_spread_ms,
      batch_timing_status: tripletCold.batchRecord.batch_timing_status,
      member_statuses: tripletCold.batchRecord.member_statuses,
    },
    triplet_warm: {
      start_spread_ms: tripletWarm.batchRecord.start_spread_ms,
      batch_timing_status: tripletWarm.batchRecord.batch_timing_status,
      member_statuses: tripletWarm.batchRecord.member_statuses,
    },
    pcap_continuity: pcapIndex.continuity_status,
    pcap_file_count: pcapIndex.file_count,
    private_field_scan: scanPrivateFields(
      Object.values(lifecycle).map((r) => r.record).filter(Boolean),
    ),
    production_enablement: 'NOT APPROVED',
  };

  const gates = {
    cold_h3: lifecycle.cold?.gate === 'PASS',
    warm_h3: lifecycle.warm?.gate === 'PASS',
    resumed_honest: lifecycle.resumed?.classification === 'CLIENT_SESSION_RESUME_UNSUPPORTED',
    zero_rtt_honest:
      lifecycle.attempted_0rtt?.classification === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED',
    no_classifier_contradiction: !classifierContradiction,
    triplet_cold: Object.values(tripletCold.batchRecord.member_statuses).every((s) => s === 'PASS'),
    triplet_warm: Object.values(tripletWarm.batchRecord.member_statuses).every((s) => s === 'PASS'),
    pcap_continuity: pcapIndex.continuity_status === 'PASS',
    private_scan: report.private_field_scan.pass,
  };

  report.gates = gates;
  report.status = Object.values(gates).every(Boolean) ? 'PASS' : 'BLOCKED';

  const guard = evaluatePrelaunchGuard({ smokeReport: report });
  report.prelaunch_guard = guard;

  fs.writeFileSync(path.join(opts.out, 'phase32h-r1-prelaunch-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === 'PASS' && guard.status === 'PASS' ? 0 : 2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
