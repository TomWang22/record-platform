#!/usr/bin/env node
/**
 * Stdin/stdout runner for Phase 33D deterministic engines.
 * Input JSON: { "capability": "negotiation_assistance|recommendations", "input": {} }
 */
import { runCapability, validateCapabilityResultShape } from '../lib/phase33d-intelligence.mjs';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function main() {
  return readStdin().then((raw) => {
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      process.stderr.write('invalid_json_input\n');
      process.stdout.write(JSON.stringify({ status: 'FAIL', error: 'invalid_json_input' }));
      process.exit(1);
    }
    const capability = body.capability;
    try {
      const out = runCapability(capability, body.input || {});
      const schema_violations = validateCapabilityResultShape(capability, out.result);
      const status = schema_violations.length ? 'FAIL' : 'PASS';
      process.stdout.write(
        JSON.stringify({
          status,
          capability,
          envelope: out.envelope,
          result: out.result,
          diagnostics: out.diagnostics,
          schema_violations,
        }),
      );
      process.exit(status === 'PASS' ? 0 : 1);
    } catch (err) {
      process.stderr.write(String(err?.stack || err) + '\n');
      process.stdout.write(
        JSON.stringify({ status: 'FAIL', error: String(err?.message || err), capability }),
      );
      process.exit(1);
    }
  });
}

main();
