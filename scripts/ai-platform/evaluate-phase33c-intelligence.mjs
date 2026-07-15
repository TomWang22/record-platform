#!/usr/bin/env node
/**
 * Phase 33C offline intelligence evaluator. Reports under /tmp only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateScenario } from '../lib/phase33c-intelligence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = __dirname;
const OUT = '/tmp/phase33c-intelligence-evaluation';

function readScenarios(file) {
  return JSON.parse(fs.readFileSync(path.join(PACKAGE, 'phase33c-scenarios', file), 'utf8')).scenarios;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function summarize(reports) {
  const hard = {
    privacy_leakage: 0,
    cross_user_leakage: 0,
    deleted_source_retrieval: 0,
    wrong_pressing_exact_claims: 0,
    asking_as_sold_violations: 0,
    bidder_identity_exposure: 0,
    unsupported_manipulation_claims: 0,
    schema_invalid_outputs: 0,
    false_rarity_violations: 0,
    unsupported_rarity_claims: 0,
    unsupported_valuation_claims: 0,
  };
  let pass = 0;
  let abstainExpectedOk = 0;
  let abstainExpected = 0;
  for (const r of reports) {
    if (r.status === 'PASS') pass += 1;
    for (const [k, v] of Object.entries(r.hard)) hard[k] = (hard[k] || 0) + v;
    if (r.abstained) abstainExpectedOk += 1;
  }
  return {
    count: reports.length,
    pass,
    fail: reports.length - pass,
    pass_rate: reports.length ? pass / reports.length : 0,
    hard,
    abstention_rate: reports.length ? abstainExpectedOk / reports.length : 0,
    mean_confidence:
      reports.reduce((s, r) => s + (r.confidence || 0), 0) / Math.max(1, reports.length),
  };
}

function main() {
  const policy = JSON.parse(
    fs.readFileSync(path.join(PACKAGE, 'phase33c-acceptance-policy.json'), 'utf8'),
  );
  const scarcityScenarios = readScenarios('scarcity-scenarios.json');
  const valuationScenarios = readScenarios('valuation-scenarios.json');
  const auctionScenarios = readScenarios('auction-scenarios.json');

  const scarcityReports = scarcityScenarios.map(evaluateScenario);
  const valuationReports = valuationScenarios.map(evaluateScenario);
  const auctionReports = auctionScenarios.map(evaluateScenario);
  const all = [...scarcityReports, ...valuationReports, ...auctionReports];

  const scarcityMetrics = summarize(scarcityReports);
  const valuationMetrics = summarize(valuationReports);
  const auctionMetrics = summarize(auctionReports);
  const globalHard = summarize(all).hard;

  const hardViolations = [];
  for (const [k, max] of Object.entries(policy.hard_stops)) {
    if ((globalHard[k] || 0) > max) hardViolations.push(`${k}:${globalHard[k]}>${max}`);
  }

  fs.mkdirSync(OUT, { recursive: true });
  writeJson(path.join(OUT, 'scenario-summary.json'), {
    scarcity: scarcityScenarios.length,
    valuation: valuationScenarios.length,
    auction_intelligence: auctionScenarios.length,
    total: all.length,
  });
  writeJson(path.join(OUT, 'scarcity-metrics.json'), scarcityMetrics);
  writeJson(path.join(OUT, 'valuation-metrics.json'), valuationMetrics);
  writeJson(path.join(OUT, 'auction-intelligence-metrics.json'), auctionMetrics);
  writeJson(path.join(OUT, 'grounding-results.json'), {
    retrieval_mode: 'keyword_metadata',
    semantic_default: 'NOT_ENABLED',
    phase33b_interpretation: policy.phase33b_metric_interpretation,
  });
  writeJson(path.join(OUT, 'abstention-results.json'), {
    scarcity_abstention_rate: scarcityMetrics.abstention_rate,
    valuation_abstention_rate: valuationMetrics.abstention_rate,
    auction_abstention_rate: auctionMetrics.abstention_rate,
  });
  writeJson(path.join(OUT, 'confidence-calibration.json'), {
    scarcity_mean_confidence: scarcityMetrics.mean_confidence,
    valuation_mean_confidence: valuationMetrics.mean_confidence,
    auction_mean_confidence: auctionMetrics.mean_confidence,
    note: 'Deterministic factors only; not LLM-generated',
  });
  writeJson(path.join(OUT, 'privacy-isolation-results.json'), {
    privacy_leakage: globalHard.privacy_leakage,
    cross_user_leakage: globalHard.cross_user_leakage,
  });
  writeJson(path.join(OUT, 'overclaim-results.json'), {
    false_rarity_violations: globalHard.false_rarity_violations,
    unsupported_rarity_claims: globalHard.unsupported_rarity_claims,
    unsupported_valuation_claims: globalHard.unsupported_valuation_claims,
    unsupported_manipulation_claims: globalHard.unsupported_manipulation_claims,
  });
  writeJson(path.join(OUT, 'schema-validation-results.json'), {
    schema_invalid_outputs: globalHard.schema_invalid_outputs,
    scarcity_pass_rate: scarcityMetrics.pass_rate,
    valuation_pass_rate: valuationMetrics.pass_rate,
    auction_pass_rate: auctionMetrics.pass_rate,
  });
  writeJson(path.join(OUT, 'owner-approval-package.json'), {
    phase: '33C',
    status: hardViolations.length || all.some((r) => r.status === 'FAIL')
      ? 'NEEDS_OWNER_REVIEW_OR_FIXES'
      : 'READY_FOR_OWNER_REVIEW',
    hard_violations: hardViolations,
    production: policy.production_hard_stops,
    selected_routes: policy.selected_routes,
    note: 'Fixture-only PASS does not authorize production',
    next: 'Owner review before Phase 33D',
  });

  const md = [
    '# Phase 33C Intelligence Evaluation',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Scenarios: ${all.length}`,
    `- Hard violations: ${hardViolations.length}`,
    `- Production embedding writes: NO`,
    `- Live gauntlet: NOT LAUNCHED`,
    '',
    `## Scarcity pass_rate=${scarcityMetrics.pass_rate.toFixed(4)}`,
    `## Valuation pass_rate=${valuationMetrics.pass_rate.toFixed(4)}`,
    `## Auction pass_rate=${auctionMetrics.pass_rate.toFixed(4)}`,
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'final-report.md'), `${md.join('\n')}\n`);

  const failed = all.filter((r) => r.status === 'FAIL').slice(0, 20);
  const summary = {
    status: hardViolations.length || failed.length ? 'FAIL' : 'PASS',
    counts: {
      scarcity: scarcityScenarios.length,
      valuation: valuationScenarios.length,
      auction: auctionScenarios.length,
      total: all.length,
    },
    metrics: {
      scarcity: scarcityMetrics,
      valuation: valuationMetrics,
      auction: auctionMetrics,
    },
    hard: globalHard,
    hard_violations: hardViolations,
    sample_failures: failed.map((f) => ({
      scenario_id: f.scenario_id,
      behavior_violations: f.behavior_violations,
      schema_violations: f.schema_violations,
      hard: f.hard,
    })),
    out: OUT,
  };
  console.error(`failed=${failed.length} hard_violations=${hardViolations.length}`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.status === 'PASS' ? 0 : 2);
}

main();
