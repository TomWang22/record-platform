/**
 * Unit coverage for authorized evidence + pipeline/response contracts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  buildAuthorizedEvidenceBundle,
  assertMaterialClaimsTraceable,
  findUntraceableMaterialClaims,
} from '../scripts/lib/phase34-authorized-evidence-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

test('authorized evidence bundle is deterministic and hashed', () => {
  const a = buildAuthorizedEvidenceBundle({
    capability: 'valuation',
    deterministic_metrics: { fair_low: 30, fair_high: 45, sold_count: 3 },
    sold_comparables: [{ price: 32 }, { price: 40 }, { price: 44 }],
    subject_identity: { listing_id: 'L1' },
  });
  const b = buildAuthorizedEvidenceBundle({
    capability: 'valuation',
    deterministic_metrics: { fair_low: 30, fair_high: 45, sold_count: 3 },
    sold_comparables: [{ price: 32 }, { price: 40 }, { price: 44 }],
    subject_identity: { listing_id: 'L1' },
  });
  assert.equal(a.evidence_snapshot_hash, b.evidence_snapshot_hash);
  assert.ok(a.evidence_snapshot_id);
});

test('untraceable material claims fail closed', () => {
  const bundle = buildAuthorizedEvidenceBundle({
    deterministic_metrics: { fair_low: 30, fair_high: 45 },
    sold_comparables: [{ price: 32 }],
  });
  assert.equal(findUntraceableMaterialClaims('Fair range $30–$45 from sold $32.', bundle).length, 0);
  assert.ok(findUntraceableMaterialClaims('This will appreciate to $999 next year.', bundle).length > 0);
  assert.throws(
    () => assertMaterialClaimsTraceable('Secret floor is $888.', bundle),
    /UNTRACEABLE_MATERIAL_CLAIMS/,
  );
});

test('pipeline and response-quality verifiers exit 0', () => {
  execFileSync('node', ['scripts/ai-platform/verify-phase34-intelligence-pipeline.mjs'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  execFileSync('node', ['scripts/ai-platform/verify-phase34-response-quality.mjs'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.ok(fs.existsSync(path.join(REPO, 'docs/ai-platform/PHASE_34_INTELLIGENCE_PIPELINE.md')));
});
