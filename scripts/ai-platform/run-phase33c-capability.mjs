#!/usr/bin/env node
/**
 * Stdin/stdout runner for Phase 33C/34 capability engines.
 * Input JSON: { "capability": "...", "input": {} }
 *
 * When PHASE34_RUNTIME_INTEGRATION=1 (or input.runtime_integration),
 * empty candidates are loaded from intelligence.market_events and
 * eligibility/snapshot/claim artifacts are persisted.
 */
import { runCapability, runCapabilityAsync } from '../lib/phase33c-intelligence.mjs';
import { validateCapabilityResultShape } from '../lib/phase33c-intelligence.mjs';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = await readStdin();
let body;
try {
  body = JSON.parse(raw || '{}');
} catch (err) {
  process.stderr.write(`json_parse_error:${err.message}\n`);
  process.stdout.write(JSON.stringify({ status: 'FAIL', error: 'invalid_json' }));
  process.exit(2);
}

try {
  const capability = body.capability;
  const input = body.input || {};
  const useRuntime =
    input.runtime_integration === true ||
    process.env.PHASE34_RUNTIME_INTEGRATION === '1' ||
    process.env.PHASE34_RUNTIME_INTEGRATION === 'true';

  const out = useRuntime
    ? await runCapabilityAsync(capability, input)
    : runCapability(capability, input);

  const schema_violations = validateCapabilityResultShape(capability, out.result);
  if (schema_violations.length) {
    process.stderr.write(`schema_invalid:${schema_violations.join(',')}\n`);
    process.stdout.write(
      JSON.stringify({ status: 'FAIL', error: 'schema_invalid', schema_violations, ...out }),
    );
    process.exit(2);
  }
  process.stdout.write(
    JSON.stringify({
      status: 'PASS',
      capability,
      envelope: out.envelope,
      result: out.result,
      diagnostics: out.diagnostics,
      evidence_snapshot_id: out.evidence_snapshot_id,
      evidence_snapshot_hash: out.evidence_snapshot_hash,
      claim_ledger_id: out.claim_ledger_id,
      response_id: out.response_id,
      platform_envelope: out.platform_envelope
        ? {
            evidence_snapshot_id: out.platform_envelope.evidence_snapshot_id,
            evidence_snapshot_hash: out.platform_envelope.evidence_snapshot_hash,
            claim_ledger_id: out.platform_envelope.claim_ledger_id,
            customer_summary: out.platform_envelope.customer_summary,
            claim_ledger: out.platform_envelope.claim_ledger,
            included_event_ids:
              out.platform_envelope.evidence_snapshot?.included_event_ids || [],
          }
        : null,
      persistence: out.persistence || null,
      prompt: {
        capability,
        retrieval_mode: out.diagnostics?.retrieval_mode || 'keyword_metadata',
        evidence_count: out.result.evidence?.length || 0,
      },
    }),
  );
  process.exit(0);
} catch (err) {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.stdout.write(JSON.stringify({ status: 'FAIL', error: String(err.message || err) }));
  process.exit(2);
}
