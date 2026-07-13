#!/usr/bin/env node
/**
 * Phase 32H-R1 — adversarial process-identity classifier smoke.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertCollectorExclusivityPreflight } from './lib/phase32h-collector-exclusivity.mjs';
import {
  evaluatePcapCollectorIdentity,
  FOREIGN_COLLECTOR_MARKER,
  DUPLICATE_COLLECTOR_MARKER,
  readCollectorRegistry,
  registerPcapCollector,
} from './lib/phase32h-collector-registry.mjs';
import { listPhase32hCaptureProcesses } from './lib/phase32h-process-list.mjs';
import { buildProcessInspection } from './lib/phase32h-process-identity.mjs';
import { initRunState, generateRunId } from './lib/phase32h-run-integrity.mjs';
import { finalizeSmokeWithFreeze, withSmokeCollectorCleanup } from './lib/phase32h-smoke-collector-cleanup.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = '/tmp/phase32h-r1-process-identity-smoke-v1';
const NEGATIVE_ROOT = '/tmp/phase32h-r1-process-identity-smoke-negative-v1';

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function runDiagnosticContamination(outRoot) {
  const capture = JSON.parse(fs.readFileSync(path.join(outRoot, 'pcap/capture-status.json'), 'utf8'));
  const ringSeg = fs
    .readdirSync(path.join(outRoot, 'pcap'))
    .find((n) => n.includes('_00001_') && n.endsWith('.pcapng'));
  const cmds = [
    `bash -c "ps -axo pid=,args= | rg dumpcap ${outRoot}"`,
    `bash -c "echo dumpcap -w ${capture.file}"`,
    `rg 'dumpcap|${path.basename(outRoot)}' ${outRoot} || true`,
    `ps -axo pid=,args= | grep ${outRoot} | grep dumpcap || true`,
    `node ${path.join(REPO_ROOT, 'scripts/phase32h-runtime-status-readonly.mjs')} --out ${outRoot}`,
  ];
  if (ringSeg) {
    cmds.push(`bash -c "wc -c ${path.join(outRoot, 'pcap', ringSeg)}"`);
  }
  const inspections = [];
  for (const cmd of cmds) {
    spawnSync('bash', ['-lc', cmd], { cwd: REPO_ROOT, encoding: 'utf8' });
    inspections.push(cmd);
  }
  return inspections;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('smoke out must be under /tmp');
  assertCollectorExclusivityPreflight();
  if (fs.existsSync(opts.out)) fs.rmSync(opts.out, { recursive: true, force: true });
  if (fs.existsSync(NEGATIVE_ROOT)) fs.rmSync(NEGATIVE_ROOT, { recursive: true, force: true });

  return withSmokeCollectorCleanup(
    opts.out,
    async () => {
      fs.mkdirSync(opts.out, { recursive: true });
      const runId = generateRunId();
      const launchHead = gitSha();
      initRunState(opts.out, { runId, launchHead, evidenceLabel: 'process-identity-smoke' });
      spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], { cwd: REPO_ROOT });
      registerPcapCollector(opts.out, { run_id: runId, launch_head: launchHead });
      await new Promise((r) => setTimeout(r, 5000));
      const beforeSize = fs
        .readdirSync(path.join(opts.out, 'pcap'))
        .filter((n) => n.endsWith('.pcapng'))
        .reduce((sum, n) => sum + fs.statSync(path.join(opts.out, 'pcap', n)).size, 0);
      const diagnostics = runDiagnosticContamination(opts.out);
      let registry = readCollectorRegistry(opts.out);
      let diagIdentity = evaluatePcapCollectorIdentity(
        opts.out,
        listPhase32hCaptureProcesses(),
        registry,
        { probesActive: true, runId, launchHead },
      );
      const pcapFiles = fs
        .readdirSync(path.join(opts.out, 'pcap'))
        .filter((n) => n.endsWith('.pcapng'));
      const afterSize = pcapFiles.reduce((sum, n) => sum + fs.statSync(path.join(opts.out, 'pcap', n)).size, 0);
      const pcapOk = afterSize > beforeSize || (pcapFiles.length > 0 && afterSize > 0);

      fs.mkdirSync(NEGATIVE_ROOT, { recursive: true });
      fs.mkdirSync(path.join(NEGATIVE_ROOT, 'pcap'), { recursive: true });
      spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), NEGATIVE_ROOT], { cwd: REPO_ROOT });
      await new Promise((r) => setTimeout(r, 2000));
      registry = readCollectorRegistry(opts.out);
      const foreignIdentity = evaluatePcapCollectorIdentity(
        opts.out,
        listPhase32hCaptureProcesses(),
        registry,
        { probesActive: true, runId, launchHead },
      );
      const negativeDetected = foreignIdentity.failure_class === 'FOREIGN_PHASE32H_PCAP_PROCESS';
      spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh'), NEGATIVE_ROOT], { cwd: REPO_ROOT });
      fs.rmSync(NEGATIVE_ROOT, { recursive: true, force: true });

      const shellInspections = listPhase32hCaptureProcesses()
        .filter((p) => p.pid !== registry?.collectors?.pcap_collector?.pid)
        .map((p) => buildProcessInspection(p).classification);
      const pass =
        !fs.existsSync(path.join(opts.out, FOREIGN_COLLECTOR_MARKER)) &&
        !fs.existsSync(path.join(opts.out, DUPLICATE_COLLECTOR_MARKER)) &&
        diagIdentity.failure_class === 'ACTIVE' &&
        pcapOk &&
        negativeDetected;

      const report = {
        status: pass && negativeDetected ? 'PASS' : 'BLOCKED',
        out: opts.out,
        diagnostics,
        identity: diagIdentity,
        foreign_identity: foreignIdentity,
        negative_detected: negativeDetected,
        pcap_growth: pcapOk,
        shell_classifications: shellInspections,
      };
      fs.writeFileSync(path.join(opts.out, 'phase32h-r1-process-identity-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);

      const shutdown = finalizeSmokeWithFreeze(opts.out, {
        repoRoot: REPO_ROOT,
        pass: pass && negativeDetected,
        hashManifestName: 'phase32h-r1-process-identity-smoke-sha256.txt',
        markerName: 'FROZEN_PASS_EVIDENCE',
        markerContent: `${new Date().toISOString()}\nPROCESS_IDENTITY_SMOKE_PASS\n`,
        jsonlPaths: [],
      });
      report.shutdown = shutdown;
      console.log(JSON.stringify(report, null, 2));
      process.exit(pass && negativeDetected && shutdown.freezeReady ? 0 : 2);
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
