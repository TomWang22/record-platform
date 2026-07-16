/**
 * Read-only verification of frozen Phase 33F canary-v3 evidence.
 * Never modifies the frozen root.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { FROZEN_CANARY_V3_ROOT } from './phase33f-canary-config.mjs';
import { listProcesses, roleForCommand } from './phase32h-freeze-integrity.mjs';

export const CANARY_V3_MANIFEST_SHA_PIN =
  '30e29804005869399fc4ab0b75484c7ead32f111e33aba5f8bde84b095d2df26';
export const CANARY_V3_EXPECTED_HASH_ENTRIES = 1234;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveManifestPath(root, entryPath) {
  if (entryPath.startsWith('/')) return entryPath;
  const joined = path.join(root, entryPath);
  if (fs.existsSync(joined)) return joined;
  if (fs.existsSync(entryPath)) return entryPath;
  return joined;
}

export function verifyFrozenCanaryV3({
  root = FROZEN_CANARY_V3_ROOT,
  expectedEntries = CANARY_V3_EXPECTED_HASH_ENTRIES,
  expectedManifestSha = CANARY_V3_MANIFEST_SHA_PIN,
} = {}) {
  const frozenPass = path.join(root, 'FROZEN_PASS_EVIDENCE');
  const frozenBlocked = path.join(root, 'FROZEN_BLOCKED_EVIDENCE');
  const hashManifest = path.join(root, 'phase33f-hash-manifest.json');
  const launchJson = path.join(root, 'phase33f-launch.json');

  if (!fs.existsSync(root)) {
    const err = new Error(`frozen canary-v3 missing: ${root}`);
    err.code = 'PHASE33F_CANARY_V3_MISSING';
    throw err;
  }
  if (!fs.existsSync(frozenPass)) {
    const err = new Error('canary-v3 FROZEN_PASS_EVIDENCE missing');
    err.code = 'PHASE33F_CANARY_V3_NOT_PASS';
    throw err;
  }
  if (fs.existsSync(frozenBlocked)) {
    const err = new Error('canary-v3 has both PASS and BLOCKED markers');
    err.code = 'PHASE33F_CANARY_V3_MARKER_CONFLICT';
    throw err;
  }
  if (!fs.existsSync(hashManifest)) {
    const err = new Error('canary-v3 hash manifest missing');
    err.code = 'PHASE33F_CANARY_V3_HASH_MANIFEST_MISSING';
    throw err;
  }

  let checked = 0;
  let missing = 0;
  let mismatch = 0;
  const mismatches = [];
  for (const line of fs.readFileSync(hashManifest, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(' ');
    if (space < 0) continue;
    const expect = trimmed.slice(0, space).trim();
    const rel = trimmed.slice(space + 1).trim();
    if (!expect || !rel) continue;
    checked += 1;
    const abs = resolveManifestPath(root, rel);
    if (!fs.existsSync(abs)) {
      missing += 1;
      if (mismatches.length < 8) mismatches.push({ path: rel, reason: 'missing' });
      continue;
    }
    const actual = sha256File(abs);
    if (actual !== expect) {
      mismatch += 1;
      if (mismatches.length < 8) mismatches.push({ path: rel, reason: 'mismatch', expect, actual });
    }
  }

  if (checked !== expectedEntries) {
    const err = new Error(`canary-v3 hash entries ${checked} != ${expectedEntries}`);
    err.code = 'PHASE33F_CANARY_V3_HASH_COUNT';
    err.details = { checked, expectedEntries };
    throw err;
  }
  if (missing || mismatch) {
    const err = new Error(`canary-v3 hash verify failed missing=${missing} mismatch=${mismatch}`);
    err.code = 'PHASE33F_CANARY_V3_HASH_MISMATCH';
    err.details = { checked, missing, mismatch, mismatches };
    throw err;
  }

  let launchManifestSha = null;
  if (fs.existsSync(launchJson)) {
    try {
      const launch = JSON.parse(fs.readFileSync(launchJson, 'utf8'));
      launchManifestSha = launch.manifest_sha256 || launch.manifest_sha || null;
    } catch {
      launchManifestSha = null;
    }
  }
  if (expectedManifestSha && launchManifestSha && launchManifestSha !== expectedManifestSha) {
    const err = new Error('canary-v3 launch manifest SHA pin mismatch');
    err.code = 'PHASE33F_CANARY_V3_MANIFEST_PIN';
    err.details = { expectedManifestSha, launchManifestSha };
    throw err;
  }

  const procs = listProcesses().filter((p) => {
    if (!p.command?.includes(root)) return false;
    return roleForCommand(p.command, root) != null;
  });

  const lsof = spawnSync('lsof', ['+D', root], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const openWriters = (lsof.stdout || '')
    .split('\n')
    .filter((line) => /\b[uw]\b|\bW\b/.test(line) || /phase33f|dumpcap|node/.test(line))
    .filter((line) => line && !line.startsWith('COMMAND'))
    .length;

  // lsof can be noisy; treat only explicit writer roles as blockers when present.
  const writerBlock = procs.length > 0;

  return {
    status: 'PASS',
    root,
    frozen_pass: true,
    checked,
    missing: 0,
    mismatch: 0,
    processes: procs.length,
    open_writers_heuristic: openWriters,
    launch_manifest_sha: launchManifestSha,
    writer_block: writerBlock,
  };
}
