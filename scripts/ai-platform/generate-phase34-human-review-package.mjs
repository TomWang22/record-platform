#!/usr/bin/env node
/**
 * Phase 34E — sanitized blinded human-review package generator.
 * Writes under /tmp/phase34-eval/…  No private identities or message bodies.
 * MODEL_WEIGHT_TRAINING: NO
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES } from './generate-phase34-prompt-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICY = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'phase34-eval-policy.json'), 'utf8'),
);
const DEFAULT_OUT = '/tmp/phase34-eval/human-review-package';

const SCORE_DIMENSIONS = [
  'factual_correctness',
  'evidence_support',
  'pressing_identity',
  'price_correctness',
  'usefulness',
  'clarity',
  'concision',
  'calibration',
  'limitation_disclosure',
  'abstention_quality',
  'safety',
  'privacy',
  'buyer_seller_tone',
  'next_step_usefulness',
];

function parseArgs(argv) {
  const out = { smoke: false, outDir: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--smoke') out.smoke = true;
    else if (a === '--out' && argv[i + 1]) out.outDir = argv[++i];
  }
  return out;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sanitizeSession(index, capabilityId) {
  return {
    review_item_id: `hr_${String(index).padStart(5, '0')}`,
    blind_label: `CASE_${String(index).padStart(5, '0')}`,
    capability_id: capabilityId,
    // No real PII / private message bodies — fixtures only.
    sanitized_prompt_excerpt: `[REDACTED_PRINCIPAL] asks about ${capabilityId} for [REDACTED_RELEASE].`,
    sanitized_response_excerpt: `Structured ${capabilityId} output with evidence placeholders E1..En.`,
    candidate_blind_ids: ['A', 'B'],
    score_sheet: Object.fromEntries(SCORE_DIMENSIONS.map((d) => [d, null])),
    private_fields_present: false,
    identity_fields_present: false,
  };
}

export function generateHumanReviewPackage({ smoke = false, outDir = DEFAULT_OUT } = {}) {
  if (!String(outDir).startsWith('/tmp/phase34-eval')) {
    throw new Error(`outDir_must_be_under_/tmp/phase34-eval: ${outDir}`);
  }

  const target = smoke ? 12 : POLICY.human_review.minimum_reviewed_sessions;
  const items = [];
  for (let i = 0; i < target; i++) {
    items.push(sanitizeSession(i, CAPABILITIES[i % CAPABILITIES.length]));
  }

  const packageDoc = {
    package_id: 'phase34-human-review-v1',
    smoke,
    MODEL_WEIGHT_TRAINING: 'NO',
    OPTIMIZATION: POLICY.OPTIMIZATION,
    minimum_reviewed_sessions_floor: POLICY.human_review.minimum_reviewed_sessions,
    items_in_package: items.length,
    meets_minimum_floor: !smoke && items.length >= POLICY.human_review.minimum_reviewed_sessions,
    score_dimensions: SCORE_DIMENSIONS,
    blinding: {
      candidate_labels: ['A', 'B'],
      identities_redacted: true,
      private_messages_excluded: true,
    },
    instructions: [
      'Score each dimension 1–5 or mark N/A.',
      'Do not attempt to deanonymize principals.',
      'Flag safety/privacy failures immediately.',
      'Pairwise: prefer A or B without seeing prompt hashes.',
    ],
  };

  writeJson(path.join(outDir, 'review-package.json'), packageDoc);
  writeJson(path.join(outDir, 'review-items.json'), { items });
  writeJson(path.join(outDir, 'score-template.json'), {
    score_dimensions: SCORE_DIMENSIONS,
    pairwise_preference: null,
    free_text_failure_category: null,
  });

  return { outDir, packageDoc };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = generateHumanReviewPackage(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'WROTE',
        outDir: result.outDir,
        smoke: args.smoke,
        items_in_package: result.packageDoc.items_in_package,
        meets_minimum_floor: result.packageDoc.meets_minimum_floor,
      },
      null,
      2,
    )}\n`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
