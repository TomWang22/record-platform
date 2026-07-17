import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  CAPABILITIES,
  REQUIRED_DIMENSION_COVERAGE,
  buildRegistry,
  validateRegistry,
  writeRegistry,
} from '../scripts/ai-platform/generate-phase34-prompt-registry.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_DIR = path.join(REPO_ROOT, 'scripts/ai-platform/phase34-prompt-registry');
const GEN = path.join(REPO_ROOT, 'scripts/ai-platform/generate-phase34-prompt-registry.mjs');
const POLICY = path.join(REPO_ROOT, 'scripts/ai-platform/phase34-eval-policy.json');

describe('phase34 prompt registry', () => {
  it('builds >=96 material candidates with unique hashes and dimension coverage', () => {
    const registry = buildRegistry();
    const report = validateRegistry(registry);
    assert.equal(report.status, 'PASS', report.violations.join('\n'));
    assert.ok(report.counts.total_candidates >= 96);
    assert.equal(report.counts.unique_hashes, report.counts.total_candidates);
    assert.equal(CAPABILITIES.length, 8);
    for (const dim of REQUIRED_DIMENSION_COVERAGE) {
      assert.ok(
        registry.index.dimension_coverage_present.includes(dim),
        `missing dimension ${dim}`,
      );
    }
  });

  it('writes registry and validates on disk', () => {
    const result = writeRegistry(REGISTRY_DIR);
    assert.equal(result.validation.status, 'PASS');
    assert.ok(fs.existsSync(path.join(REGISTRY_DIR, 'index.json')));
    for (const capabilityId of CAPABILITIES) {
      const doc = JSON.parse(
        fs.readFileSync(path.join(REGISTRY_DIR, `${capabilityId}.json`), 'utf8'),
      );
      assert.ok(doc.candidates.length >= 12);
      const primaries = new Set(doc.candidates.map((c) => c.primary_dimension));
      assert.equal(primaries.size, doc.candidates.length);
      for (const c of doc.candidates) {
        assert.ok(c.content_sha256 && c.content_sha256.length === 64);
        assert.ok(c.prompts.system.length > 120);
        assert.equal(c.policies.MODEL_WEIGHT_TRAINING, 'NO');
      }
    }
  });

  it('CLI --validate passes', () => {
    writeRegistry(REGISTRY_DIR);
    const result = spawnSync(process.execPath, [GEN, '--validate'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'PASS');
  });

  it('documents only two available model tiers (no invented third)', () => {
    const policy = JSON.parse(fs.readFileSync(POLICY, 'utf8'));
    assert.equal(policy.available_model_tiers.tier_count, 2);
    assert.equal(policy.available_model_tiers.three_tier_comparison, 'NOT_AVAILABLE');
    const ids = policy.available_model_tiers.tiers.map((t) => t.tier_id).sort();
    assert.deepEqual(ids, ['ollama_optional', 'rule_deterministic']);
    assert.equal(policy.MODEL_WEIGHT_TRAINING, 'NO');
    assert.equal(
      policy.OPTIMIZATION,
      'PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION',
    );
  });

  it('preserves owner retrieval and capability floors (not lowered)', () => {
    const policy = JSON.parse(fs.readFileSync(POLICY, 'utf8'));
    const r = policy.retrieval_floors_frozen_holdout;
    assert.equal(r['Recall@5_min'], 0.6);
    assert.equal(r['Recall@10_min'], 0.75);
    assert.equal(r.MRR_min, 0.45);
    assert.equal(r['nDCG@5_min'], 0.5);
    assert.equal(r['nDCG@10_min'], 0.55);
    assert.equal(r.exact_pressing_accuracy_min, 0.75);
    assert.equal(r.privacy_leakage_max, 0);

    const mt = policy.multi_turn_recall_floors;
    assert.equal(mt.recall_precision_min, 0.95);
    assert.equal(mt.correction_precedence_min, 1.0);
    assert.equal(mt.deletion_propagation_min, 1.0);
    assert.equal(mt.cross_user_leakage_max, 0);

    assert.equal(policy.capability_acceptance_floors.scarcity.macro_f1_min, 0.85);
    assert.equal(policy.capability_acceptance_floors.valuation.supported_case_median_ape_max, 0.2);
    assert.equal(
      policy.capability_acceptance_floors.negotiation_assistance.human_usefulness_min,
      4.2,
    );
    assert.equal(policy.capability_acceptance_floors.recommendations['Precision@5_min'], 0.6);
    assert.equal(policy.capability_acceptance_floors.market_analytics.arithmetic_correctness_min, 1.0);
  });

  it('rejects punctuation-only style duplicates via material primary dimensions', () => {
    const registry = buildRegistry();
    for (const capabilityId of CAPABILITIES) {
      const systems = registry.byCapability[capabilityId].candidates.map((c) => c.prompts.system);
      const unique = new Set(systems);
      assert.equal(unique.size, systems.length);
    }
  });
});
