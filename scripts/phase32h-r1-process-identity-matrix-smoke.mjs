#!/usr/bin/env node
/**
 * Phase 32H-R1 — 90-probe process-identity matrix smoke with read-only status polling.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildR1Manifest } from './phase32h-build-r1-manifest.mjs';
import { groupManifestIntoTriplets } from './lib/phase32h-triplet-manifest.mjs';
import { R1_EVIDENCE_LABEL_BASELINE } from './lib/phase32h-r1-config.mjs';
import {
  acquireLauncherLock,
  generateRunId,
  initRunState,
  sha256File,
} from './lib/phase32h-run-integrity.mjs';
import { assertCollectorExclusivityPreflight } from './lib/phase32h-collector-exclusivity.mjs';
import {
  evaluatePcapCollectorIdentity,
  enrichPcapProcessFromCaptureStatus,
  FOREIGN_COLLECTOR_MARKER,
  DUPLICATE_COLLECTOR_MARKER,
  readCollectorRegistry,
  registerPcapCollector,
} from './lib/phase32h-collector-registry.mjs';
import { verifyLaunchSpecAgainstProcess } from './lib/phase32h-collector-launch-spec.mjs';
import { listPhase32hCaptureProcesses } from './lib/phase32h-process-list.mjs';
import { readCorrelationQueueSnapshot } from './lib/phase32h-correlation-queue.mjs';
import { evaluatePacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import { runTripletMatrix } from './phase32h-r1-triplet-runner.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';
import { finalizeSmokeWithFreeze, withSmokeCollectorCleanup } from './lib/phase32h-smoke-collector-cleanup.mjs';
import { deriveRingOutputSpec, discoverRingSegments } from './lib/phase32h-pcap-ring-segments.mjs';
import { buildRuntimeStatus } from './phase32h-runtime-status-readonly.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = '/tmp/phase32h-r1-process-identity-matrix-smoke-v1';
const TARGET_BATCHES = 30;
const TARGET_PROBES = TARGET_BATCHES * 3;

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function startDetached(cmd, args, env = process.env) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

function runDiagnostics(outRoot) {
  const capture = JSON.parse(fs.readFileSync(path.join(outRoot, 'pcap/capture-status.json'), 'utf8'));
  const cmds = [
    `bash -c "ps -axo pid=,args= | rg dumpcap ${outRoot} || true"`,
    `bash -c "echo dumpcap -w ${capture.file}"`,
    `node ${path.join(REPO_ROOT, 'scripts/phase32h-runtime-status-readonly.mjs')} --out ${outRoot}`,
  ];
  for (const cmd of cmds) spawnSync('bash', ['-lc', cmd], { cwd: REPO_ROOT, encoding: 'utf8' });
  return buildRuntimeStatus(outRoot);
}

function evaluateRegistrySemantic(outRoot, runId, launchHead) {
  const registry = readCollectorRegistry(outRoot);
  const entry = registry?.collectors?.pcap_collector;
  const processes = listPhase32hCaptureProcesses().filter((p) => p.evidence_root === outRoot);
  const proc = enrichPcapProcessFromCaptureStatus(outRoot, processes.find((p) => p.pid === entry?.pid) || null);
  const identity = evaluatePcapCollectorIdentity(outRoot, listPhase32hCaptureProcesses(), registry, {
    probesActive: true,
    runId,
    launchHead,
  });
  const verification = proc
    ? verifyLaunchSpecAgainstProcess(
        { launch_spec: entry.launch_spec, run_id: entry.run_id, launch_head: entry.launch_head, evidence_root: outRoot },
        proc,
        { runId, launchHead },
      )
    : { pass: false, failure_class: 'EXPECTED_PCAP_PROCESS_MISSING' };
  const pcapStatus = JSON.parse(fs.readFileSync(path.join(outRoot, 'pcap/capture-status.json'), 'utf8'));
  const ringSpec = deriveRingOutputSpec(entry?.output_path || pcapStatus.file, pcapStatus, outRoot);
  const discovery = discoverRingSegments(outRoot, ringSpec);
  return {
    argv_semantic_match: verification.pass ? 'PASS' : 'FAIL',
    ring_segment_discovery:
      ringSpec.output_mode === 'ring_buffer' && discovery.segment_count >= 1 && discovery.active_segment ? 'PASS' : 'FAIL',
    active_segment_growth: identity.failure_class === 'PCAP_OUTPUT_NOT_GROWING' ? 'FAIL' : 'PASS',
    output_growth: identity.failure_class === 'PCAP_OUTPUT_NOT_GROWING' ? 'FAIL' : 'PASS',
    root_match: entry?.evidence_root === outRoot ? 'PASS' : 'FAIL',
    identity,
    verification,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('matrix smoke out must be under /tmp');
  assertCollectorExclusivityPreflight();
  if (fs.existsSync(opts.out)) throw new Error(`evidence root ${opts.out} must be absent before smoke`);

  return withSmokeCollectorCleanup(
    opts.out,
    async () => {
      fs.mkdirSync(opts.out, { recursive: true });
      const full = buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE });
      const batches = groupManifestIntoTriplets(full).slice(0, TARGET_BATCHES);
      const rows = batches.flatMap((b) => [b.h1, b.h2, b.h3]);
      const manifestPath = path.join(opts.out, 'phase32h-r1-manifest.jsonl');
      fs.writeFileSync(manifestPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');

      const runId = generateRunId();
      const launchHead = gitSha();
      const evidenceLabel = R1_EVIDENCE_LABEL_BASELINE;
      initRunState(opts.out, { runId, launchHead, evidenceLabel, manifestPath });
      acquireLauncherLock(opts.out, { pid: process.pid, run_id: runId, role: 'process-identity-matrix-smoke' });

      const env = { ...process.env, PHASE32H_MATRIX_ROOT: opts.out, T20_EVAL_RAG_PAUSE_SEC: '0.15' };
      spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], { cwd: REPO_ROOT });
      registerPcapCollector(opts.out, { run_id: runId, launch_head: launchHead, manifest_sha: sha256File(manifestPath) });
      startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-gateway-log-capture.sh'), opts.out], env);
      startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-application-log-capture.sh'), opts.out], env);
      startDetached(process.execPath, [path.join(REPO_ROOT, 'scripts/phase32h-extreme-watchdog.mjs'), '--out', opts.out], env);
      startDetached('bash', [path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'), opts.out], env);
      startDetached(process.execPath, [path.join(REPO_ROOT, 'scripts/phase32h-collector-supervisor.mjs'), '--out', opts.out], env);

      const statusSnapshots = [];
      const diagTimer = setInterval(() => {
        try {
          statusSnapshots.push(runDiagnostics(opts.out));
        } catch {
          // ignore transient read races
        }
      }, 10_000);
      runDiagnostics(opts.out);

      const matrixResult = await runTripletMatrix({
        out: opts.out,
        arm: 'baseline',
        evidenceLabel,
        expectedTotal: TARGET_PROBES,
        expectedPerProtocol: TARGET_BATCHES,
        limit: TARGET_BATCHES,
      });
      clearInterval(diagTimer);
      statusSnapshots.push(runDiagnostics(opts.out));

      const queue = readCorrelationQueueSnapshot(opts.out);
      const packetIndex = evaluatePacketIndexCoverage(opts.out, {
        expectedProbeIndexes: TARGET_PROBES,
        expectedBatchCorrelations: TARGET_BATCHES,
        requirePerProbeIndexes: true,
      });
      const pcapStatus = JSON.parse(fs.readFileSync(path.join(opts.out, 'pcap/capture-status.json'), 'utf8'));
      const registrySemantic = evaluateRegistrySemantic(opts.out, runId, launchHead);
      const falseMarkers =
        fs.existsSync(path.join(opts.out, FOREIGN_COLLECTOR_MARKER)) ||
        fs.existsSync(path.join(opts.out, DUPLICATE_COLLECTOR_MARKER));

      const pass =
        !falseMarkers &&
        matrixResult.completedBatches === TARGET_BATCHES &&
        queue.pending_count === 0 &&
        queue.running_count === 0 &&
        queue.complete_count === TARGET_BATCHES &&
        queue.failed_count === 0 &&
        packetIndex.probe_index_count === TARGET_PROBES &&
        packetIndex.batch_correlation_count === TARGET_BATCHES &&
        registrySemantic.argv_semantic_match === 'PASS' &&
        registrySemantic.ring_segment_discovery === 'PASS' &&
        registrySemantic.active_segment_growth === 'PASS' &&
        registrySemantic.output_growth === 'PASS' &&
        registrySemantic.root_match === 'PASS';

      const report = {
        status: pass ? 'PASS' : 'BLOCKED',
        terminal: pass ? 'FROZEN_PASS' : 'BLOCKED',
        out: opts.out,
        run_id: runId,
        launch_head: launchHead,
        matrix_result: matrixResult,
        queue,
        packet_index: packetIndex,
        registry_semantic: registrySemantic,
        runtime_status_invocations: statusSnapshots.length,
        false_positives: falseMarkers,
        pcap_continuity: packetIndex.continuity_status || 'PASS',
        pcap_drops: pcapStatus?.drops ?? 0,
      };
      fs.writeFileSync(path.join(opts.out, 'phase32h-r1-process-identity-matrix-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);

      const shutdown = finalizeSmokeWithFreeze(opts.out, {
        repoRoot: REPO_ROOT,
        pass,
        hashManifestName: 'phase32h-r1-process-identity-matrix-smoke-sha256.txt',
        markerName: 'FROZEN_PASS_EVIDENCE',
        markerContent: `${new Date().toISOString()}\nPROCESS_IDENTITY_MATRIX_SMOKE_PASS\n`,
        jsonlPaths: ['h1', 'h2', 'h3'].map((s) => path.join(opts.out, `shard-${s}`, 'phase32h-matrix.jsonl')),
      });
      report.shutdown = shutdown;
      report.post_smoke_process_count = shutdown.post_smoke_processes?.length ?? shutdown.cleanup?.remaining_processes?.length ?? 0;
      console.log(JSON.stringify(report, null, 2));
      process.exit(
        pass && shutdown.freezeReady && shutdown.freeze?.status === 'PASS' && report.post_smoke_process_count === 0 ? 0 : 2,
      );
    },
    { repoRoot: REPO_ROOT, skipCleanup: true },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
