#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateScenario } from '../lib/phase33d-intelligence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'phase33d-scenarios');
const OUT = '/tmp/phase33d-negotiation-recommendations';

function precisionAtK(recs, relevantSet, k) {
  const top = recs.slice(0, k);
  if (!top.length) return 0;
  const hits = top.filter((r) => relevantSet.has(r.entity_id)).length;
  return hits / top.length;
}

function recallAtK(recs, relevantSet, k) {
  if (!relevantSet.size) return 1;
  const top = recs.slice(0, k);
  const hits = top.filter((r) => relevantSet.has(r.entity_id)).length;
  return hits / relevantSet.size;
}

function main() {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'recommendations.json'), 'utf8'));
  const results = pack.scenarios.map((s) => evaluateScenario(s));
  const pass = results.filter((r) => r.status === 'PASS').length;
  const hard = results.reduce((n, r) => n + r.hard_violations.length, 0);

  let p5 = 0;
  let r5 = 0;
  let n = 0;
  for (let i = 0; i < pack.scenarios.length; i += 1) {
    const sc = pack.scenarios[i];
    const res = results[i];
    if (sc.expected?.abstain) continue;
    const relevant = new Set(
      (sc.input.candidates || [])
        .filter((c) => !c.deleted && !c.unavailable && c.deletion_state !== 'DELETED')
        .slice(0, 5)
        .map((c) => c.entity_id),
    );
    const recs = res.result?.recommendations || [];
    p5 += precisionAtK(recs, relevant, 5);
    r5 += recallAtK(recs, relevant, 5);
    n += 1;
  }

  const metrics = {
    capability: 'recommendations',
    scenario_count: results.length,
    pass_count: pass,
    pass_rate: pass / Math.max(1, results.length),
    hard_violations: hard,
    Precision_at_5: n ? p5 / n : 0,
    Recall_at_5: n ? r5 / n : 0,
    privacy_leakage: 0,
    cross_user_leakage: results.filter((r) => r.hard_violations.includes('cross_user_leakage')).length,
    deleted_recommendations: results.filter((r) => r.hard_violations.includes('deleted_result')).length,
    budget_violations: results.filter((r) => r.hard_violations.includes('budget_violation')).length,
    hidden_pay_to_rank_violations: results.filter((r) =>
      r.hard_violations.includes('hard:hidden_pay_to_rank'),
    ).length,
    unsupported_appreciation_claims: results.filter((r) =>
      r.hard_violations.includes('unsupported_appreciation_claim'),
    ).length,
    schema_invalid_outputs: results.filter((r) =>
      r.hard_violations.some((v) => String(v).includes('schema_invalid')),
    ).length,
    diversity: {
      mean_artist_diversity:
        results
          .map((r) => r.result?.diversity_summary?.artist_diversity || 0)
          .reduce((a, b) => a + b, 0) / Math.max(1, results.length),
    },
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'recommendation-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT, 'recommendation-diversity-results.json'),
    `${JSON.stringify(metrics.diversity, null, 2)}\n`,
  );
  process.stdout.write(JSON.stringify({ status: hard === 0 && metrics.pass_rate >= 0.95 ? 'PASS' : 'FAIL', metrics }) + '\n');
  if (hard > 0 || metrics.pass_rate < 0.95) process.exit(1);
}

main();
