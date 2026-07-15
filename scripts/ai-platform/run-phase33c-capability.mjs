#!/usr/bin/env node
/**
 * Stdin/stdout runner for Phase 33C deterministic engines (service + tests).
 * Input JSON: { "capability": "scarcity|valuation|auction_intelligence", "input": {} }
 */
import { runCapability } from '../lib/phase33c-intelligence.mjs';
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
  const out = runCapability(capability, body.input || {});
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
