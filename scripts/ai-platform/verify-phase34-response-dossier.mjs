#!/usr/bin/env node
/**
 * Verify Phase 34 response dossier library against synthetic fixtures.
 * Does not launch live owner-proof or claim product acceptance.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  validateResponseDossier,
  renderResponseDossierMarkdown,
  validateNegotiationTranscript,
  scoreResponseQuality,
  assertGoldenAcceptance,
  assertCrossResponseChecks,
  DOSSIER_JSON_REQUIRED_FIELDS,
} from '../lib/phase34-response-dossier.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures/phase34-response-dossiers');
const LIB = path.join(__dirname, '../lib/phase34-response-dossier.mjs');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg);
    err.code = 'RESPONSE_DOSSIER_VERIFY_FAIL';
    throw err;
  }
}

function loadJson(name) {
  const p = path.join(FIXTURE_DIR, name);
  assert(fs.existsSync(p), `missing fixture ${name}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  assert(fs.existsSync(FIXTURE_DIR), 'missing fixtures directory');
  assert(DOSSIER_JSON_REQUIRED_FIELDS.length >= 30, 'required fields list too short');

  const scarcity = loadJson('scarcity-success-exact-pressing.json');
  const honest = loadJson('valuation-honest-limit-weak-comps.json');
  const negotiationDoc = loadJson('negotiation-four-turn-transcript.json');

  validateResponseDossier(scarcity);
  validateResponseDossier(honest);
  assert(negotiationDoc.dossier, 'negotiation fixture missing dossier');
  validateResponseDossier(negotiationDoc.dossier);

  const md = renderResponseDossierMarkdown(scarcity);
  for (const heading of [
    '## User asked',
    '## Context used',
    '## AI answered',
    '## Key values',
    '## Why',
    '## Evidence',
    '## Uncertainty',
    '## What changed',
    '## Next action',
    '## Full response',
    '## Latency',
    '## Technical details',
  ]) {
    assert(md.includes(heading), `markdown missing section ${heading}`);
  }

  const transcript = validateNegotiationTranscript({ turns: negotiationDoc.turns });
  assert(transcript.exchange_count === 4, 'expected 4 negotiation exchanges');

  const scoresA = scoreResponseQuality(scarcity);
  const scoresB = scoreResponseQuality(honest);
  const scoresC = scoreResponseQuality(negotiationDoc.dossier);
  assertGoldenAcceptance(scoresA);
  assertGoldenAcceptance(scoresB);
  assertGoldenAcceptance(scoresC, { pressing_applicable: false });

  assertCrossResponseChecks([scarcity, honest, negotiationDoc.dossier]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        response_dossier_lib_hash: sha256File(LIB),
        fixture_dir: FIXTURE_DIR,
        fixtures: [
          'scarcity-success-exact-pressing.json',
          'valuation-honest-limit-weak-comps.json',
          'negotiation-four-turn-transcript.json',
        ],
        required_fields: DOSSIER_JSON_REQUIRED_FIELDS.length,
        negotiation_exchanges: transcript.exchange_count,
        chatgpt_tier_claim: false,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (err) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err.message,
        code: err.code || 'RESPONSE_DOSSIER_VERIFY_FAIL',
      },
      null,
      2,
    ),
  );
  process.exit(2);
}
