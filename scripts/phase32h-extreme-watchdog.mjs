#!/usr/bin/env node
/**
 * Phase 32H — independent in-flight extreme watchdog (triggers diagnostics at 60s while request pending).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  elapsedMs,
  readAllInflight,
} from './lib/phase32h-inflight-probe-registry.mjs';
import {
  WATCHDOG_TRIGGER_MS,
  resolvePhase32hRoot,
} from './lib/phase32h-targeted-reproduction-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TRIGGER_SCRIPT = path.join(REPO_ROOT, 'scripts/phase32h-start-diagnostic-capture.sh');

function parseArgs(argv) {
  const opts = { out: resolvePhase32hRoot(), once: false, intervalMs: 1000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--once') opts.once = true;
    else if (argv[i] === '--interval-ms') opts.intervalMs = Number(argv[++i]);
  }
  return opts;
}

function triggeredPath(outRoot, probeId, protocol) {
  return path.join(outRoot, 'diagnostics', `.triggered-${protocol}-${probeId}`);
}

function alreadyTriggered(outRoot, record) {
  const marker = triggeredPath(outRoot, record.probe_id, record.protocol);
  return fs.existsSync(marker);
}

function markTriggered(outRoot, record, diagDir) {
  const marker = triggeredPath(outRoot, record.probe_id, record.protocol);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${diagDir}\n`);
}

function triggerDiagnostic(outRoot, record) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const proto = String(record.protocol).replace(/\//g, '');
  const diagDir = path.join(outRoot, 'diagnostics', `${ts}-${proto}-${record.probe_id}`);
  fs.mkdirSync(diagDir, { recursive: true });
  fs.writeFileSync(
    path.join(diagDir, 'trigger.json'),
    `${JSON.stringify({ ...record, triggered_at: new Date().toISOString(), elapsed_ms: elapsedMs(record) }, null, 2)}\n`,
  );
  spawnSync('bash', [TRIGGER_SCRIPT, outRoot, diagDir, String(record.probe_id)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  markTriggered(outRoot, record, diagDir);
  return diagDir;
}

export function watchdogTick(outRoot) {
  const inflight = readAllInflight(outRoot).filter((r) => r.status === 'in_flight');
  const triggered = [];
  for (const record of inflight) {
    if (elapsedMs(record) < WATCHDOG_TRIGGER_MS) continue;
    if (alreadyTriggered(outRoot, record)) continue;
    triggered.push(triggerDiagnostic(outRoot, record));
  }
  const hbPath = path.join(outRoot, 'heartbeats', 'watchdog.jsonl');
  fs.mkdirSync(path.dirname(hbPath), { recursive: true });
  fs.appendFileSync(
    hbPath,
    `${JSON.stringify({ ts: new Date().toISOString(), inflight: inflight.length, triggered: triggered.length })}\n`,
  );
  return { inflight: inflight.length, triggered };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('watchdog out must be under /tmp');
  if (opts.once) {
    console.log(JSON.stringify(watchdogTick(opts.out), null, 2));
    return;
  }
  process.stderr.write(`phase32h watchdog started interval=${opts.intervalMs}ms out=${opts.out}\n`);
  setInterval(() => {
    try {
      watchdogTick(opts.out);
    } catch (err) {
      process.stderr.write(`phase32h watchdog error: ${err.message}\n`);
    }
  }, opts.intervalMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
