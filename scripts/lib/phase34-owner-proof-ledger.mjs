/**
 * Bounded owner-proof execution ledger (no auth material / private bodies).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  summarizeLatency as summarizeLatencyV2,
} from './phase34-latency-summary.mjs';

export function createOwnerProofLedger(outRoot) {
  const file = path.join(outRoot, 'reports', 'owner-proof-execution.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  return {
    file,
    append(row) {
      const safe = sanitizeLedgerRow(row);
      fs.appendFileSync(file, `${JSON.stringify(safe)}\n`);
      return safe;
    },
    readAll() {
      const text = fs.readFileSync(file, 'utf8').trim();
      if (!text) return [];
      return text.split('\n').map((line) => JSON.parse(line));
    },
  };
}

export function sanitizeLedgerRow(row) {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (/token|password|authorization|cookie|bearer/i.test(k)) delete out[k];
  }
  if (typeof out.visible_user_intent === 'string' && out.visible_user_intent.length > 500) {
    out.visible_user_intent = `${out.visible_user_intent.slice(0, 500)}…`;
  }
  // Never persist raw message bodies
  delete out.message_bodies;
  delete out.private_message_bodies;
  return out;
}

export function hashResultSummary(summary) {
  return crypto.createHash('sha256').update(String(summary || '')).digest('hex');
}

export function buildLatencyRow(partial = {}) {
  const keys = [
    'browser_action_to_request_ms',
    'browser_request_total_ms',
    'browser_action_to_panel_ready_ms',
    'H1_total_ms',
    'H2_total_ms',
    'H3_total_ms',
    'gateway_ms',
    'service_ms',
    'authorization_ms',
    'prompt_assembly_ms',
    'embedding_ms',
    'retrieval_ms',
    'reranking_ms',
    'tool_execution_ms',
    'model_queue_ms',
    'model_first_token_ms',
    'model_generation_ms',
    'schema_validation_ms',
    'evidence_validation_ms',
    'render_ms',
    'unattributed_ms',
  ];
  const row = {};
  for (const k of keys) {
    if (partial[k] == null) {
      row[k] = null;
      row[`${k}_status`] = 'NOT_INSTRUMENTED';
    } else {
      row[k] = partial[k];
      row[`${k}_status`] = 'MEASURED';
    }
  }
  return row;
}

/**
 * Owner-proof latency summary.
 *
 * Prefer passing an options bag with plannedTurns / runAborted.
 * Legacy callers may pass only row objects; those are treated as a partial
 * sample with plannedTurns=27 and no completion claim.
 *
 * @param {Array<object|number>} rowsOrSamples
 * @param {{
 *   plannedTurns?: number,
 *   runCompleted?: boolean,
 *   runAborted?: boolean,
 *   metricName?: string,
 *   runId?: string | null,
 * }=} options
 */
export function summarizeLatency(rowsOrSamples, options = {}) {
  const samples = Array.isArray(rowsOrSamples)
    ? rowsOrSamples
        .map((row) =>
          typeof row === 'number'
            ? row
            : row?.browser_action_to_panel_ready_ms ??
              row?.browser_action_to_terminal_ready_ms,
        )
        .filter((n) => typeof n === 'number' && Number.isFinite(n))
    : [];

  const plannedTurns = Number.isInteger(options.plannedTurns)
    ? options.plannedTurns
    : 27;

  return summarizeLatencyV2(samples, {
    plannedTurns,
    runCompleted: options.runCompleted === true,
    runAborted:
      options.runAborted === true ||
      (options.runCompleted !== true && samples.length < plannedTurns),
    metricName: options.metricName || 'browser_action_to_terminal_ready_ms',
    runId: options.runId ?? null,
  });
}
