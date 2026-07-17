#!/usr/bin/env node
/**
 * Phase 34D — unique logical session corpus generator.
 * Writes ONLY under /tmp/phase34-eval/…
 * H1/H2/H3 protocol copies are NOT counted as unique logical sessions.
 * MODEL_WEIGHT_TRAINING: NO
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES } from './generate-phase34-prompt-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICY = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'phase34-eval-policy.json'), 'utf8'),
);

const DEFAULT_OUT = '/tmp/phase34-eval/unique-session-corpus';

const PROTOCOLS = ['http1', 'http2', 'http3'];
const ROLES = ['buyer', 'seller'];
const SCENARIO_FAMILIES = [
  'baseline',
  'adversarial_privacy',
  'exact_pressing_ambiguity',
  'weak_stale_missing_data',
  'multi_turn',
  'budget_change',
  'pressing_correction',
  'deletion',
  'cross_user_refusal',
];

function parseArgs(argv) {
  const out = {
    smoke: false,
    outDir: DEFAULT_OUT,
    seed: 'phase34-corpus-v1',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--smoke') out.smoke = true;
    else if (a === '--out' && argv[i + 1]) out.outDir = argv[++i];
    else if (a === '--seed' && argv[i + 1]) out.seed = argv[++i];
  }
  return out;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function targetsFor(smoke) {
  if (smoke) {
    return {
      development: 24,
      validation: 8,
      frozen_holdout: 8,
      multi_turn_conversations: 6,
      adversarial_privacy: 4,
      exact_pressing_ambiguity: 4,
      weak_stale_missing_data: 4,
      human_reviewed_pool: 4,
    };
  }
  return {
    development: POLICY.unique_session_minimums.development,
    validation: POLICY.unique_session_minimums.validation,
    frozen_holdout: POLICY.unique_session_minimums.frozen_holdout,
    multi_turn_conversations: POLICY.unique_session_minimums.multi_turn_conversations,
    adversarial_privacy: POLICY.unique_session_minimums.adversarial_privacy,
    exact_pressing_ambiguity: POLICY.unique_session_minimums.exact_pressing_ambiguity,
    weak_stale_missing_data: POLICY.unique_session_minimums.weak_stale_missing_data,
    human_reviewed_pool: POLICY.unique_session_minimums.human_reviewed,
  };
}

function buildLogicalSession({ split, index, seed, family, capabilityId, role }) {
  const logical_session_id = `ls_${split}_${String(index).padStart(6, '0')}_${capabilityId}_${role}_${family}`;
  const materialSeed = `${seed}|${logical_session_id}`;
  const turns =
    family === 'multi_turn' || family === 'budget_change' || family === 'pressing_correction'
      ? 4 + (index % 9)
      : 1 + (index % 3);

  const session = {
    logical_session_id,
    split,
    capability_id: capabilityId,
    role,
    scenario_family: family,
    material_seed: materialSeed,
    expected_behavior_tags: [family, capabilityId, role],
    turn_count: turns,
    // Transport copies are generated for reporting but do NOT mint new logical IDs.
    transport_protocol_copies: PROTOCOLS.map((protocol) => ({
      transport_probe_id: `tp_${logical_session_id}_${protocol}`,
      protocol,
      logical_session_id,
    })),
  };
  return session;
}

function allocateFamilies(count, targets, preferMultiTurn = false) {
  const families = [];
  let remaining = count;
  const push = (family, n) => {
    const take = Math.min(remaining, n);
    for (let i = 0; i < take; i++) families.push(family);
    remaining -= take;
  };

  if (preferMultiTurn) {
    push('multi_turn', Math.min(remaining, targets.multi_turn_conversations));
  }
  push('adversarial_privacy', Math.ceil(targets.adversarial_privacy * (count / (targets.development + targets.validation + targets.frozen_holdout))));
  push('exact_pressing_ambiguity', Math.ceil(targets.exact_pressing_ambiguity * (count / (targets.development + targets.validation + targets.frozen_holdout))));
  push('weak_stale_missing_data', Math.ceil(targets.weak_stale_missing_data * (count / (targets.development + targets.validation + targets.frozen_holdout))));
  push('budget_change', Math.ceil(count * 0.05));
  push('pressing_correction', Math.ceil(count * 0.05));
  push('deletion', Math.ceil(count * 0.04));
  push('cross_user_refusal', Math.ceil(count * 0.04));
  while (remaining > 0) {
    families.push('baseline');
    remaining -= 1;
  }
  return families;
}

function generateSplit(split, count, seed, targets) {
  const preferMulti = split === 'development' || split === 'validation';
  const families = allocateFamilies(count, targets, preferMulti);
  const sessions = [];
  for (let i = 0; i < count; i++) {
    const capabilityId = CAPABILITIES[i % CAPABILITIES.length];
    const role = ROLES[i % ROLES.length];
    const family = families[i] || 'baseline';
    sessions.push(buildLogicalSession({ split, index: i, seed, family, capabilityId, role }));
  }
  return sessions;
}

function summarize(sessions) {
  const logical = sessions.length;
  const transport_probes = sessions.reduce((n, s) => n + s.transport_protocol_copies.length, 0);
  const conversation_turns = sessions.reduce((n, s) => n + s.turn_count, 0);
  // Model invocations scaffold: one structured call per turn (not executed here).
  const model_invocations = conversation_turns;
  const byFamily = {};
  const byCapability = {};
  const byRole = {};
  for (const s of sessions) {
    byFamily[s.scenario_family] = (byFamily[s.scenario_family] || 0) + 1;
    byCapability[s.capability_id] = (byCapability[s.capability_id] || 0) + 1;
    byRole[s.role] = (byRole[s.role] || 0) + 1;
  }
  return {
    logical_sessions: logical,
    transport_probes,
    conversation_turns,
    model_invocations,
    // Explicitly document non-counting of H1/H2/H3 as unique logical sessions:
    unique_logical_sessions_excluding_protocol_copies: logical,
    protocol_copies_not_counted_as_logical: transport_probes - logical,
    by_family: byFamily,
    by_capability: byCapability,
    by_role: byRole,
  };
}

export function generateCorpus({ smoke = false, outDir = DEFAULT_OUT, seed = 'phase34-corpus-v1' } = {}) {
  if (!String(outDir).startsWith('/tmp/phase34-eval')) {
    throw new Error(`outDir_must_be_under_/tmp/phase34-eval: ${outDir}`);
  }

  const targets = targetsFor(smoke);
  const development = generateSplit('development', targets.development, seed, targets);
  const validation = generateSplit('validation', targets.validation, seed, targets);
  const frozen_holdout = generateSplit('frozen_holdout', targets.frozen_holdout, seed, targets);
  const all = [...development, ...validation, ...frozen_holdout];

  const ids = new Set(all.map((s) => s.logical_session_id));
  if (ids.size !== all.length) {
    throw new Error('duplicate_logical_session_id');
  }

  const report = {
    generator: 'generate-phase34-unique-session-corpus.mjs',
    smoke,
    seed,
    MODEL_WEIGHT_TRAINING: 'NO',
    OPTIMIZATION: POLICY.OPTIMIZATION,
    counting_rules: POLICY.counting_rules,
    targets,
    splits: {
      development: summarize(development),
      validation: summarize(validation),
      frozen_holdout: summarize(frozen_holdout),
      all: summarize(all),
    },
    floors_reference: {
      development_min: POLICY.unique_session_minimums.development,
      validation_min: POLICY.unique_session_minimums.validation,
      frozen_holdout_min: POLICY.unique_session_minimums.frozen_holdout,
      total_unique_logical_min: POLICY.unique_session_minimums.total_unique_logical,
    },
    meets_full_floors:
      !smoke &&
      development.length >= POLICY.unique_session_minimums.development &&
      validation.length >= POLICY.unique_session_minimums.validation &&
      frozen_holdout.length >= POLICY.unique_session_minimums.frozen_holdout &&
      all.length >= POLICY.unique_session_minimums.total_unique_logical,
    content_sha256: sha256(all.map((s) => s.logical_session_id).join('|')),
  };

  writeJson(path.join(outDir, 'development/sessions.json'), { split: 'development', sessions: development });
  writeJson(path.join(outDir, 'validation/sessions.json'), { split: 'validation', sessions: validation });
  writeJson(path.join(outDir, 'frozen_holdout/sessions.json'), { split: 'frozen_holdout', sessions: frozen_holdout });
  writeJson(path.join(outDir, 'corpus-report.json'), report);

  return { outDir, report, counts: report.splits.all };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = generateCorpus(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'WROTE',
        outDir: result.outDir,
        smoke: args.smoke,
        logical_sessions: result.counts.logical_sessions,
        transport_probes: result.counts.transport_probes,
        conversation_turns: result.counts.conversation_turns,
        model_invocations: result.counts.model_invocations,
        meets_full_floors: result.report.meets_full_floors,
      },
      null,
      2,
    )}\n`,
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
