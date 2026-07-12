#!/usr/bin/env node
/**
 * Record the baseline-r3 readiness ESM eval incident (redacted, immutable report).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = '/tmp/phase32h-r1-baseline-r3-readiness';

export const ESM_INCIDENT = {
  command_source: 'ad-hoc readiness shell during baseline-r3 verification (assistant session)',
  exact_command_redacted:
    'node -e "<REDACTED: top-level ESM import of buildBaselineLaunchPackage>"',
  parent_script_make_target: 'manual readiness launch-package extraction (not a committed Make target)',
  exit_code: 1,
  stderr_signature:
    "SyntaxError: Unexpected token '{' / ERR_EVAL_ESM_CANNOT_PRINT / evalTypeScriptModuleEntryPoint",
  output_consumed: false,
  failure_ignored: false,
  root_cause:
    'Top-level ESM import inside node -e is invalid; launch package must use committed .mjs CLI',
  replacement_cli: 'scripts/phase32h-launch-package-readonly.mjs',
  remediation_status: 'REPLACED',
};

function main() {
  const outDir = process.argv[2] || DEFAULT_OUT;
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'esm-eval-incident.json');
  fs.writeFileSync(outPath, `${JSON.stringify(ESM_INCIDENT, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ status: 'PASS', path: outPath }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
