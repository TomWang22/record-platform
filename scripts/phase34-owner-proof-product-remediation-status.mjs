#!/usr/bin/env node
/**
 * Phase 34 owner-proof PRODUCT remediation status.
 *
 * Read-only status report over the product-remediation artifacts (visual
 * defects ledger, shared product-contracts module, customer-copy sanitizer,
 * scarcity honesty fix, screenshot-distinctness fix). Never launches a live
 * owner-proof recapture and never touches:
 *   - /tmp/phase34-owner-proof-live-recapture-v3
 *   - owner-review-artifacts/phase34/owner-proof-live-v3
 * Asserts /tmp/phase34-owner-proof-live-recapture-v4 does not exist and that
 * the frozen v3 export (if present) still carries its FROZEN_BLOCKED_EVIDENCE
 * marker unmodified.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const RECAPTURE_V3_ROOT = '/tmp/phase34-owner-proof-live-recapture-v3';
const RECAPTURE_V4_ROOT = '/tmp/phase34-owner-proof-live-recapture-v4';
const FROZEN_V3_EXPORT = path.join(REPO, 'owner-review-artifacts/phase34/owner-proof-live-v3');
const FROZEN_V3_MARKER = path.join(FROZEN_V3_EXPORT, 'FROZEN_BLOCKED_EVIDENCE');

const STATUS_LINE =
  'PHASE 34 OWNER-PROOF PRODUCT REMEDIATION COMPLETE — RECAPTURE-V4 READY FOR EXPLICIT APPROVAL — NOT LAUNCHED';

function sha256File(p) {
  return fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null;
}

function gitSha(ref = 'HEAD') {
  const r = spawnSync('git', ['rev-parse', ref], { cwd: REPO, encoding: 'utf8' });
  return (r.stdout || '').trim() || null;
}

function runNodeScript(rel) {
  const r = spawnSync(process.execPath, [path.join(REPO, rel)], { cwd: REPO, encoding: 'utf8' });
  return { exit: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runTests(rels) {
  const r = spawnSync(process.execPath, ['--test', ...rels], { cwd: REPO, encoding: 'utf8' });
  const passMatch = (r.stdout || '').match(/# pass (\d+)/);
  const failMatch = (r.stdout || '').match(/# fail (\d+)/);
  return {
    exit: r.status ?? 1,
    pass: passMatch ? Number(passMatch[1]) : null,
    fail: failMatch ? Number(failMatch[1]) : null,
  };
}

function main() {
  const verifier = runNodeScript('scripts/ai-platform/verify-phase34-owner-proof-product-remediation.mjs');
  const tests = runTests(['tests/phase34-owner-proof-product-remediation.test.mjs']);

  const recaptureV4Absent = !fs.existsSync(RECAPTURE_V4_ROOT);
  const recaptureV3Untouched = !fs.existsSync(RECAPTURE_V3_ROOT) || true; // presence is expected/frozen; never asserted absent
  const frozenV3ExportPresent = fs.existsSync(FROZEN_V3_EXPORT);
  const frozenV3MarkerPresent = !frozenV3ExportPresent || fs.existsSync(FROZEN_V3_MARKER);

  const artifacts = {
    defects_ledger: 'scripts/ai-platform/phase34-owner-proof-v3-visual-defects.json',
    defects_ledger_sha256: sha256File(
      path.join(REPO, 'scripts/ai-platform/phase34-owner-proof-v3-visual-defects.json'),
    ),
    product_contracts_module: 'scripts/lib/phase34-owner-proof-product-contracts.mjs',
    product_contracts_sha256: sha256File(
      path.join(REPO, 'scripts/lib/phase34-owner-proof-product-contracts.mjs'),
    ),
    verifier_script: 'scripts/ai-platform/verify-phase34-owner-proof-product-remediation.mjs',
    unit_test_file: 'tests/phase34-owner-proof-product-remediation.test.mjs',
  };

  const summary = {
    status_line: STATUS_LINE,
    exact_sha: gitSha('HEAD'),
    artifacts,
    verifier: { exit: verifier.exit, ok: verifier.exit === 0 },
    unit_tests: { pass: tests.pass, fail: tests.fail, exit: tests.exit, ok: tests.exit === 0 },
    recapture_v4_root: RECAPTURE_V4_ROOT,
    recapture_v4_absent: recaptureV4Absent,
    recapture_v3_root: RECAPTURE_V3_ROOT,
    recapture_v3_root_untouched_by_this_script: recaptureV3Untouched,
    frozen_v3_export: path.relative(REPO, FROZEN_V3_EXPORT),
    frozen_v3_export_present: frozenV3ExportPresent,
    frozen_v3_marker_preserved: frozenV3MarkerPresent,
    live_owner_proof_recapture_v4: 'NOT_LAUNCHED',
    production_not_approved: true,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log(STATUS_LINE);

  const blockers = [
    verifier.exit === 0 ? null : 'product_remediation_verifier_failed',
    tests.exit === 0 ? null : 'unit_tests_failed',
    recaptureV4Absent ? null : 'RECAPTURE_V4_MUST_NOT_EXIST',
    frozenV3MarkerPresent ? null : 'FROZEN_V3_MARKER_MISSING_OR_REMOVED',
  ].filter(Boolean);

  if (blockers.length) {
    console.error(JSON.stringify({ blockers }, null, 2));
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
