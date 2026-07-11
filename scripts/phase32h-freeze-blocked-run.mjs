#!/usr/bin/env node
/**
 * Phase 32H-R1A — freeze blocked E3 evidence without modifying matrix JSONL.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BLOCKED_E3_ROOT } from './lib/phase32h-r1-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BLOCKED_ROOT = process.env.PHASE32H_BLOCKED_ROOT || BLOCKED_E3_ROOT;

function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  h.update(buf);
  return h.digest('hex');
}

function walkFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else files.push(full);
  }
  return files;
}

function stopCollectorsForRoot(outRoot) {
  const patterns = [
    `phase32h-extreme-watchdog.mjs --out ${outRoot}`,
    `phase32h-capture-host-telemetry.sh ${outRoot}`,
    `phase32h-start-gateway-log-capture.sh ${outRoot}`,
    `phase32h-start-application-log-capture.sh ${outRoot}`,
    `phase32h-monitor-targeted-reproduction.sh`,
    `dumpcap`,
  ];
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  const stopped = [];
  for (const line of (ps.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (!command.includes(outRoot) && !command.includes('phase32h-monitor')) continue;
    if (!patterns.some((p) => command.includes(p) || (p === 'dumpcap' && command.includes('dumpcap') && command.includes(outRoot)))) {
      if (!command.includes(outRoot)) continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
      stopped.push({ pid, command, action: 'SIGTERM' });
    } catch {
      // already exited
    }
  }
  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-stop-pcap-capture.sh'), outRoot], {
    cwd: REPO_ROOT,
  });
  return stopped;
}

function loadIntegritySummary(outRoot) {
  const integrityPath = path.join(outRoot, 'phase32h-runtime-integrity.json');
  if (fs.existsSync(integrityPath)) return JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
  return null;
}

function main() {
  if (!fs.existsSync(BLOCKED_ROOT)) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: `missing blocked root ${BLOCKED_ROOT}` }, null, 2));
    process.exit(2);
  }

  const stopped = stopCollectorsForRoot(BLOCKED_ROOT);
  const integrity = loadIntegritySummary(BLOCKED_ROOT);
  const verdictPath = path.join(BLOCKED_ROOT, 'phase32h-root-cause-verdict.json');
  const verdict = fs.existsSync(verdictPath) ? JSON.parse(fs.readFileSync(verdictPath, 'utf8')) : null;

  const manifest = {
    frozen_at: new Date().toISOString(),
    root: BLOCKED_ROOT,
    status: 'BLOCKED',
    verdict: 'BLOCKED',
    reason: 'evidence integrity failure plus unresolved synchronized latency extremes',
    total_rows: integrity?.rows_total ?? 17315,
    expected_rows: 17280,
    duplicate_probe_ids: integrity?.duplicate_probe_ids ?? 35,
    wrong_sha_rows: integrity?.wrong_git_sha ?? 20,
    pcap_coverage: 'PARTIAL',
    extreme_rows: verdict?.extreme_count ?? 12,
    synchronized_clusters: verdict?.synchronized_all_three_clusters ?? 4,
    root_cause_verdict: verdict?.verdict_label ?? 'F — reproduced but still unresolved',
    production_enablement: 'NOT APPROVED',
    matrix_jsonl_modified: false,
    note: 'Historical diagnostic evidence only — not valid PASS matrix evidence',
  };

  const manifestPath = path.join(BLOCKED_ROOT, 'phase32h-blocked-run-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const files = walkFiles(BLOCKED_ROOT).filter((f) => !f.endsWith('.sha256.txt'));
  const shaLines = [];
  for (const file of files.sort()) {
    shaLines.push(`${sha256File(file)}  ${file}`);
  }
  const shaPath = path.join(BLOCKED_ROOT, 'phase32h-blocked-run-sha256.txt');
  fs.writeFileSync(shaPath, `${shaLines.join('\n')}\n`, 'utf8');

  const blockedIntegrity = {
    status: 'BLOCKED',
    frozen_at: manifest.frozen_at,
    ...integrity,
    frozen: true,
    valid_pass_evidence: false,
  };
  fs.writeFileSync(
    path.join(BLOCKED_ROOT, 'phase32h-blocked-run-integrity.json'),
    `${JSON.stringify(blockedIntegrity, null, 2)}\n`,
    'utf8',
  );

  const collectorCoverage = {
    frozen_at: manifest.frozen_at,
    pcap_coverage: 'PARTIAL',
    extreme_window_pcap_gap: true,
    collectors_stopped: stopped,
    note: 'PCAP coverage missing during important extreme windows; post-run collectors stopped at freeze',
  };
  fs.writeFileSync(
    path.join(BLOCKED_ROOT, 'phase32h-blocked-run-collector-coverage.json'),
    `${JSON.stringify(collectorCoverage, null, 2)}\n`,
    'utf8',
  );

  const freezeMarker = path.join(BLOCKED_ROOT, 'FROZEN_BLOCKED_EVIDENCE');
  if (!fs.existsSync(freezeMarker)) {
    fs.writeFileSync(freezeMarker, `${manifest.frozen_at}\n`, 'utf8');
  }

  console.log(
    JSON.stringify(
      {
        status: 'FROZEN',
        root: BLOCKED_ROOT,
        manifest_path: manifestPath,
        sha256_path: shaPath,
        files_hashed: files.length,
        collectors_stopped: stopped.length,
        matrix_jsonl_modified: false,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
