#!/usr/bin/env node
import fs from 'node:fs';
import { evaluateTripletParity, compareNormalizedCapabilityOutputs } from '../lib/phase33f-protocol-parity.mjs';

const OUT = '/tmp/phase33f-capability-gauntlet-comparison';

function demoFixtures() {
  const base = {
    capability: 'valuation',
    capability_mode: 'exact_pressing',
    schema_version: 'phase33f-valuation-1',
    subject: { pressing_id: 'p1', release_id: 'r1' },
    exact_pressing_claim: true,
    numeric_result: 30.0,
    confidence: 0.71,
    abstention: { abstained: false, reason_codes: [] },
    limitations: ['OBSERVED_NOT_CAUSAL'],
    safety_decision: 'advisory_only',
    privacy_decision: 'authorized',
    ranking_order: ['a', 'b'],
    retrieval_mode: 'keyword_metadata',
    memory_selection: [],
    evidence_ids: ['e1', 'e2'],
    summary_text: 'Median sold price is 30 USD.',
  };
  return {
    h1: { ...base, summary_text: 'Median sold price is 30 USD.' },
    h2: { ...base, summary_text: 'Sold median ≈ $30.' },
    h3: { ...base, evidence_ids: ['e2', 'e1'], summary_text: 'About 30 dollars median sold.' },
  };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const triplet = demoFixtures();
  const parity = evaluateTripletParity(triplet);
  const materialDemo = compareNormalizedCapabilityOutputs(
    { ...triplet.h1, numeric_result: 30 },
    { ...triplet.h1, numeric_result: 99 },
  );
  const report = {
    status: parity.status,
    material_mismatch_acceptance: 0,
    demo_presentation_and_order_only: parity,
    demo_material_mismatch_detected: materialDemo.status === 'FAIL',
    note: 'Live canary parity uses frozen probe normalized outputs; not run in CI.',
  };
  fs.writeFileSync(`${OUT}/protocol-parity.json`, `${JSON.stringify(report, null, 2)}\n`);
  // also mirror under readiness for required report name
  fs.mkdirSync('/tmp/phase33f-capability-gauntlet-readiness', { recursive: true });
  fs.writeFileSync(
    '/tmp/phase33f-capability-gauntlet-readiness/protocol-parity.json',
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(parity.status === 'PASS' && materialDemo.status === 'FAIL' ? 0 : 2);
}

main();
