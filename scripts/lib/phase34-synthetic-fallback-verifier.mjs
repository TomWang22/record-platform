/**
 * Phase C scanner: find ungated live synthetic success paths.
 *
 * Looks for force_* floor injectors, seed merges, completed-sale-comp hardcodes,
 * and JP pressing invented comps that are not behind unit-test / synthetic hooks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const LIVE_SCAN_GLOBS = Object.freeze([
  'scripts/lib',
  'webapp/components',
  'webapp/lib',
  'webapp/app',
  'services/python-ai-service/app',
]);

const SKIP_PATH_PARTS = Object.freeze([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  'e2e/screenshots',
  'reports/',
]);

const EXTENSIONS = new Set(['.mjs', '.js', '.ts', '.tsx', '.py']);

/** Patterns that must not appear outside a gated block / allowlisted harness. */
const LIVE_PATTERNS = Object.freeze([
  {
    id: 'completed-sale-comp-hardcode',
    re: /completed-sale-comp-[0-9]/,
    allowIfNearby: [
      /assertUnitTestHooksAllowed/,
      /assertSyntheticSalesAllowed/,
      /unitTestHooksAllowed\s*\(/,
      /PHASE34_UNIT_TEST_HOOKS/,
      /PHASE34_ALLOW_SYNTHETIC_SALES/,
      /_unit_test_hooks_allowed/,
    ],
  },
  {
    id: 'jp-pressing-invented-comps',
    re: /jp-pressing-completed-sale/,
    allowIfNearby: [/unitTestHooksAllowed\s*\(/, /PHASE34_UNIT_TEST_HOOKS/],
  },
  {
    id: 'force-watchlist-floor-injector',
    re: /force_watchlist_floor\s*===\s*true/,
    allowIfNearby: [/assertUnitTestHooksAllowed/, /assertSyntheticSalesAllowed/],
  },
  {
    id: 'force-recommendation-floor-injector',
    re: /force_recommendation_floor\s*===\s*true/,
    allowIfNearby: [/assertUnitTestHooksAllowed/, /assertSyntheticSalesAllowed/, /unitTestHooksAllowed/],
  },
  {
    id: 'force-analytics-floor-injector',
    re: /force_analytics_floor\s*===\s*true/,
    allowIfNearby: [/assertUnitTestHooksAllowed/, /assertSyntheticSalesAllowed/, /unitTestHooksAllowed/],
  },
  {
    id: 'force-negotiation-market-floor-injector',
    re: /force_negotiation_market_floor\s*===\s*true/,
    allowIfNearby: [/assertUnitTestHooksAllowed/, /assertSyntheticSalesAllowed/],
  },
  {
    id: 'force-sold-floor-injector',
    re: /force_sold_floor\s*===\s*true/,
    allowIfNearby: [/assertUnitTestHooksAllowed/, /assertSyntheticSalesAllowed/],
  },
  {
    id: 'catalog-cards-live-call',
    re: /_catalog_cards\s*\(/,
    allowIfFile: [/embedding_semantic_fixtures\.py$/],
    requireNearby: [/_unit_test_hooks_allowed/, /PHASE34_UNIT_TEST_HOOKS/],
  },
  {
    id: 'owner-proof-auto-floor-unconditional',
    re: /owner_proof_prompt\)\s*\|\|\s*Boolean\(input\.user_intent\)\)\s*;?\s*$/m,
    allowIfNearby: [/unitTestHooksAllowed/, /assertUnitTestHooksAllowed/],
  },
]);

const ALLOWLIST_FILES = Object.freeze([
  // Verifier + gate themselves mention patterns.
  'scripts/lib/phase34-synthetic-fallback-verifier.mjs',
  'scripts/lib/phase34-synthetic-sales-gate.mjs',
  'scripts/lib/phase34-owner-proof-product-contracts.mjs',
  'webapp/lib/phase34-production-hooks-guard.ts',
  'services/python-ai-service/app/ai/phase34_hooks_guard.py',
  // Customer-copy scrubber matches force_* tokens as forbidden strings.
  'webapp/lib/ai-customer-copy.ts',
]);

function shouldSkip(rel) {
  return SKIP_PATH_PARTS.some((p) => rel.includes(p));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    if (shouldSkip(rel)) continue;
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (EXTENSIONS.has(path.extname(name))) out.push(abs);
  }
  return out;
}

function windowAround(src, index, radius = 420) {
  const start = Math.max(0, index - radius);
  const end = Math.min(src.length, index + radius);
  return src.slice(start, end);
}

/**
 * @returns {{ ok: boolean, findings: Array<{ id: string, file: string, line: number, snippet: string }> }}
 */
export function scanLiveSyntheticFallbacks({ root = REPO_ROOT } = {}) {
  const files = [];
  for (const rel of LIVE_SCAN_GLOBS) {
    walk(path.join(root, rel), files);
  }

  const findings = [];
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (ALLOWLIST_FILES.includes(rel)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const pattern of LIVE_PATTERNS) {
      if (pattern.allowIfFile && !pattern.allowIfFile.some((re) => re.test(rel))) {
        continue;
      }
      pattern.re.lastIndex = 0;
      let match;
      const re = new RegExp(pattern.re.source, pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`);
      while ((match = re.exec(src)) !== null) {
        const nearby = windowAround(src, match.index);
        let gated = false;
        if (pattern.requireNearby?.length) {
          gated = pattern.requireNearby.every((a) => a.test(src));
        } else if (pattern.allowIfNearby?.length) {
          // Same-file gate is enough: injectors call assert* before use.
          gated = pattern.allowIfNearby.some((a) => a.test(src) || a.test(nearby));
        }
        if (gated) continue;
        const line = src.slice(0, match.index).split('\n').length;
        findings.push({
          id: pattern.id,
          file: rel,
          line,
          snippet: match[0],
        });
      }
    }
  }

  return { ok: findings.length === 0, findings };
}

export function formatFindings(findings) {
  return findings
    .map((f) => `- [${f.id}] ${f.file}:${f.line}  ${f.snippet}`)
    .join('\n');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('phase34-synthetic-fallback-verifier.mjs')) {
  const result = scanLiveSyntheticFallbacks();
  if (!result.ok) {
    console.error('phase34-synthetic-fallback-verifier: FAIL');
    console.error(formatFindings(result.findings));
    process.exit(1);
  }
  console.log('phase34-synthetic-fallback-verifier: PASS (0 live findings)');
}
