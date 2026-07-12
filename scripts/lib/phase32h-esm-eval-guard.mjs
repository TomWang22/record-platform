/**
 * Phase 32H — guard against fragile node -e / -p ESM eval in readiness paths.
 */
import fs from 'node:fs';
import path from 'node:path';

const FRAGILE_EVAL_RE =
  /node\s+(?:--input-type=module\s+)?(?:-e|-p|--eval|--print)\s+['"`][^\n]*\bimport\b/m;

const SCAN_ROOTS = ['Makefile', 'scripts', 'tests', 'docs/ai-platform'];

const ALLOWLIST = new Set([
  'scripts/lib/phase32h-esm-eval-guard.mjs',
  'tests/phase32h-esm-readiness.test.mjs',
  'docs/ai-platform/PHASE_32H_R1_EVIDENCE_REPAIR.md',
  'scripts/phase32h-record-readiness-esm-incident.mjs',
]);

export function isFragileEvalLine(line) {
  return FRAGILE_EVAL_RE.test(line);
}

export function scanFragileEvalUsage(repoRoot, { roots = SCAN_ROOTS } = {}) {
  const violations = [];
  for (const relRoot of roots) {
    const absRoot = path.join(repoRoot, relRoot);
    if (!fs.existsSync(absRoot)) continue;
    const queue = [absRoot];
    while (queue.length) {
      const current = queue.pop();
      const stat = fs.statSync(current);
      if (stat.isDirectory()) {
        if (path.basename(current) === 'node_modules' || path.basename(current) === '.git') continue;
        for (const entry of fs.readdirSync(current)) queue.push(path.join(current, entry));
        continue;
      }
      const rel = path.relative(repoRoot, current).split(path.sep).join('/');
      if (!/\.(mjs|js|sh|md|Makefile)$/i.test(rel) && rel !== 'Makefile') continue;
      if (ALLOWLIST.has(rel)) continue;
      if (!rel.includes('phase32h') && !rel.includes('Makefile')) continue;
      const text = fs.readFileSync(current, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!isFragileEvalLine(lines[i])) continue;
        violations.push({
          file: rel,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 160),
        });
      }
    }
  }
  return violations;
}

export function assertNoFragileEvalUsage(repoRoot) {
  const violations = scanFragileEvalUsage(repoRoot);
  if (!violations.length) return { status: 'PASS', violations: [] };
  return { status: 'BLOCKED', violations };
}
