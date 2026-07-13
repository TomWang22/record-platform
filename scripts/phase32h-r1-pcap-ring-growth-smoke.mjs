#!/usr/bin/env node
/**
 * Phase 32H-R1 — live PCAP ring rotation smoke (small ring + real triplet probes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildR1Manifest } from './phase32h-build-r1-manifest.mjs';
import { groupManifestIntoTriplets } from './lib/phase32h-triplet-manifest.mjs';
import { R1_EVIDENCE_LABEL_BASELINE } from './lib/phase32h-r1-config.mjs';
import { assertCollectorExclusivityPreflight } from './lib/phase32h-collector-exclusivity.mjs';
import { registerPcapCollector } from './lib/phase32h-collector-registry.mjs';
import { supervisorTick } from './phase32h-collector-supervisor.mjs';
import {
  deriveRingOutputSpec,
  discoverRingSegments,
  evaluateRingGrowthHealth,
  PCAP_GROWTH_STATE,
} from './lib/phase32h-pcap-ring-segments.mjs';
import { finalizeSmokeWithFreeze, withSmokeCollectorCleanup } from './lib/phase32h-smoke-collector-cleanup.mjs';
import { listRootScopedProcesses } from './lib/phase32h-freeze-integrity.mjs';
import { initRunState, generateRunId } from './lib/phase32h-run-integrity.mjs';
import { runTripletMatrix } from './phase32h-r1-triplet-runner.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = '/tmp/phase32h-r1-pcap-ring-growth-smoke-v1';
const SMALL_RING_KB = Number(process.env.PHASE32H_PCAP_RING_FILESIZE_KB || 16);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('ring growth smoke out must be under /tmp');
  assertCollectorExclusivityPreflight();
  if (fs.existsSync(opts.out)) {
    throw new Error(`evidence root ${opts.out} must be absent before smoke`);
  }

  return withSmokeCollectorCleanup(
    opts.out,
    async () => {
      fs.mkdirSync(opts.out, { recursive: true });
      const full = buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE });
      const batches = groupManifestIntoTriplets(full).slice(0, 1);
      const rows = batches.flatMap((b) => [b.h1, b.h2, b.h3]);
      const manifestPath = path.join(opts.out, 'phase32h-r1-manifest.jsonl');
      fs.writeFileSync(manifestPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');

      const runId = generateRunId();
      const launchHead = gitSha();
      initRunState(opts.out, { runId, launchHead, evidenceLabel: R1_EVIDENCE_LABEL_BASELINE, manifestPath });

      const env = {
        ...process.env,
        PHASE32H_MATRIX_ROOT: opts.out,
        PHASE32H_PCAP_RING_FILESIZE_KB: String(SMALL_RING_KB),
        PHASE32H_PCAP_RING_FILES: '8',
        T20_EVAL_RAG_PAUSE_SEC: '0.15',
      };
      const start = spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
        cwd: REPO_ROOT,
        env,
      });
      const statusPath = path.join(opts.out, 'pcap/capture-status.json');
      if (!fs.existsSync(statusPath)) {
        console.error(JSON.stringify({ status: 'BLOCKED', reason: 'capture-status missing' }, null, 2));
        process.exit(2);
      }
      const captureStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      if (captureStatus.status !== 'ACTIVE') {
        console.error(JSON.stringify({ status: 'BLOCKED', reason: captureStatus.reason || 'pcap not active' }, null, 2));
        process.exit(2);
      }

      registerPcapCollector(opts.out, { run_id: runId, launch_head: launchHead });
      startDetached(process.execPath, [path.join(REPO_ROOT, 'scripts/phase32h-collector-supervisor.mjs'), '--out', opts.out], env);

      await runTripletMatrix({
        out: opts.out,
        arm: 'baseline',
        evidenceLabel: R1_EVIDENCE_LABEL_BASELINE,
        expectedTotal: 3,
        expectedPerProtocol: 1,
        limit: 1,
      });

      await sleep(2000);

      const ringSpec = deriveRingOutputSpec(captureStatus.file, captureStatus, opts.out);
      const discovery = discoverRingSegments(opts.out, ringSpec);
      const rotations = discovery.segment_count ?? 0;
      const growth = evaluateRingGrowthHealth(opts.out, ringSpec, { probesActive: true });
      const health = supervisorTick(opts.out, { probesActive: true, smokeMode: true });
      const pcapRole = health.roles?.pcap_collector;
      const falseOutputNotGrowing = pcapRole?.failure_class === 'PCAP_OUTPUT_NOT_GROWING';

      spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh'), opts.out], { cwd: REPO_ROOT });
      await sleep(1000);

      const pass =
        Boolean(discovery.active_segment) &&
        discovery.segment_count >= 1 &&
        rotations >= 2 &&
        !falseOutputNotGrowing &&
        growth.growth_state !== PCAP_GROWTH_STATE.OUTPUT_NOT_GROWING &&
        (captureStatus.drops ?? 0) === 0;

      const report = {
        status: pass ? 'PASS' : 'BLOCKED',
        terminal: pass ? 'FROZEN_PASS' : 'BLOCKED',
        out: opts.out,
        configured_output_base: captureStatus.file,
        active_segment: discovery.active_segment,
        segments_observed: discovery.segment_count,
        rotations_observed: rotations,
        ring_growth_state: growth.growth_state,
        supervisor_pcap_failure_class: pcapRole?.failure_class ?? null,
        false_output_not_growing: falseOutputNotGrowing,
        pcap_drops: captureStatus.drops ?? 0,
        small_ring_filesize_kb: SMALL_RING_KB,
        triplet_probes: 3,
      };
      fs.writeFileSync(path.join(opts.out, 'phase32h-r1-pcap-ring-growth-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);

      const shutdown = finalizeSmokeWithFreeze(opts.out, {
        repoRoot: REPO_ROOT,
        pass,
        hashManifestName: 'phase32h-r1-pcap-ring-growth-smoke-sha256.txt',
        hashExcludeSuffixes: ['phase32h-r1-pcap-ring-growth-smoke-sha256.txt', 'FROZEN_PASS_EVIDENCE'],
        markerName: 'FROZEN_PASS_EVIDENCE',
        markerContent: `${new Date().toISOString()}\nPCAP_RING_GROWTH_SMOKE_PASS\n`,
        jsonlPaths: ['h1', 'h2', 'h3'].map((s) => path.join(opts.out, `shard-${s}`, 'phase32h-matrix.jsonl')),
      });
      report.shutdown = shutdown;
      report.post_smoke_process_count = listRootScopedProcesses(opts.out).filter((p) => p.pid !== process.pid).length;
      report.freeze_integrity = shutdown.freeze?.status || (shutdown.freezeReady ? 'PASS' : 'BLOCKED');
      report.marker_written_last = shutdown.freeze?.marker_written_last ?? false;

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
