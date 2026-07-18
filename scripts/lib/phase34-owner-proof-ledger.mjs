/**
 * Bounded owner-proof execution ledger (no auth material / private bodies).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

export function summarizeLatency(rows) {
  const values = rows
    .map((r) => r.browser_action_to_panel_ready_ms)
    .filter((n) => typeof n === 'number' && Number.isFinite(n))
    .sort((a, b) => a - b);
  const pct = (p) => {
    if (!values.length) return null;
    const idx = Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1);
    return values[Math.max(0, idx)];
  };
  return {
    n: values.length,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    p100: values.length ? values[values.length - 1] : null,
    p99_9: 'NOT_ESTIMABLE',
    note: 'For 27 turns / 81 protocol rows, p99.9+ is NOT_ESTIMABLE',
  };
}
