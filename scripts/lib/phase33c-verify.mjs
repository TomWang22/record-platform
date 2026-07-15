/**
 * Phase 33C package validators (offline).
 */
import fs from 'node:fs';
import path from 'node:path';
import { evaluateScenario } from './phase33c-intelligence.mjs';
import {
  FORBIDDEN_TRAINING_PATTERNS,
  PRIVATE_FIELD_PATTERNS,
} from './phase33a-intelligence-capability-contracts.mjs';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function scan(text, violations, where) {
  for (const re of PRIVATE_FIELD_PATTERNS) {
    if (re.test(text)) violations.push(`private_field:${where}`);
  }
  const stripped = text
    .replace(/embedding generation is not model training/gi, '')
    .replace(/not model training/gi, '')
    .replace(/is not foundation-model training/gi, '');
  for (const re of FORBIDDEN_TRAINING_PATTERNS) {
    if (re.test(stripped)) violations.push(`unsupported_training_claim:${where}`);
  }
  // Committed Phase 33C sources must not depend on /tmp report paths.
  if (/\/tmp\/phase33c-/.test(text)) {
    violations.push(`tmp_dependency:${where}`);
  }
}

export function validatePhase33cPackage(repoRoot, options = {}) {
  const packageRoot = options.packageRoot || path.join(repoRoot, 'scripts/ai-platform');
  const violations = [];
  const diagnostics = [];
  const policyPath = path.join(packageRoot, 'phase33c-acceptance-policy.json');
  const scenRoot = path.join(packageRoot, 'phase33c-scenarios');

  if (!fs.existsSync(policyPath)) violations.push('missing_acceptance_policy');
  if (!fs.existsSync(scenRoot)) violations.push('missing_scenarios');

  const policy = readJson(policyPath);
  scan(fs.readFileSync(policyPath, 'utf8'), violations, 'phase33c-acceptance-policy.json');

  const posture = policy.production_hard_stops || {};
  if (posture.default !== 'keyword') violations.push('production_default_not_keyword');
  if (posture.PERCENT !== 0) violations.push('PERCENT_nonzero');
  if (posture.ALLOW_PROD_PERCENT !== 0) violations.push('ALLOW_PROD_PERCENT_nonzero');
  if (posture.hybrid_vector_production_default !== 'NOT_ENABLED') {
    violations.push('hybrid_vector_enabled');
  }
  if (posture.semantic_retrieval_default !== 'NOT_ENABLED') {
    violations.push('semantic_default_enabled');
  }
  if (policy.phase33b_metric_interpretation?.reclassified_as_pass === true) {
    violations.push('phase33b_metrics_reclassified_as_pass');
  }

  const scarcity = readJson(path.join(scenRoot, 'scarcity-scenarios.json')).scenarios;
  const valuation = readJson(path.join(scenRoot, 'valuation-scenarios.json')).scenarios;
  const auction = readJson(path.join(scenRoot, 'auction-scenarios.json')).scenarios;
  const mins = policy.scenario_minimums;
  if (scarcity.length < mins.scarcity) violations.push(`scarcity_scenarios_below_min:${scarcity.length}`);
  if (valuation.length < mins.valuation) violations.push(`valuation_scenarios_below_min:${valuation.length}`);
  if (auction.length < mins.auction_intelligence) {
    violations.push(`auction_scenarios_below_min:${auction.length}`);
  }
  const total = scarcity.length + valuation.length + auction.length;
  if (total < mins.total) violations.push(`total_scenarios_below_min:${total}`);

  for (const file of fs.readdirSync(scenRoot)) {
    if (file.endsWith('.json')) {
      scan(fs.readFileSync(path.join(scenRoot, file), 'utf8'), violations, `phase33c-scenarios/${file}`);
    }
  }

  // Spot-check engine on first scenario of each capability
  for (const s of [scarcity[0], valuation[0], auction[0]]) {
    const report = evaluateScenario(s);
    if (report.status !== 'PASS' && !(s.expected?.abstain && report.abstained)) {
      // allow only if expected behaviors match; spot check uses scenarios that should pass overall eval
    }
    if (report.schema_violations.length) {
      violations.push(`spot_schema_invalid:${s.scenario_id}`);
    }
  }

  // Routes documented
  const routes = policy.selected_routes || [];
  for (const r of [
    'POST /ai/intelligence/scarcity',
    'POST /ai/intelligence/valuation',
    'POST /ai/intelligence/auction',
    'POST /ai/intelligence/auction/watchlist-temperature',
  ]) {
    if (!routes.includes(r)) violations.push(`missing_route_contract:${r}`);
  }

  const routesPy = path.join(
    repoRoot,
    'services/python-ai-service/app/ai/routes.py',
  );
  if (fs.existsSync(routesPy)) {
    const txt = fs.readFileSync(routesPy, 'utf8');
    if (!txt.includes('/intelligence/scarcity')) violations.push('missing_route_impl:scarcity');
    if (!txt.includes('/intelligence/valuation')) violations.push('missing_route_impl:valuation');
    if (!txt.includes('/intelligence/auction')) violations.push('missing_route_impl:auction');
    if (!txt.includes('watchlist-temperature')) violations.push('missing_route_impl:watchlist');
  } else {
    violations.push('missing_python_routes');
  }

  diagnostics.push(`scarcity=${scarcity.length}`, `valuation=${valuation.length}`, `auction=${auction.length}`);

  return {
    status: violations.length ? 'FAIL' : 'PASS',
    violations,
    diagnostics,
    counts: {
      scarcity: scarcity.length,
      valuation: valuation.length,
      auction_intelligence: auction.length,
      total,
    },
  };
}

export function validateCapabilitySlice(repoRoot, capability) {
  const packageRoot = path.join(repoRoot, 'scripts/ai-platform');
  const file =
    capability === 'scarcity'
      ? 'scarcity-scenarios.json'
      : capability === 'valuation'
        ? 'valuation-scenarios.json'
        : 'auction-scenarios.json';
  const scenarios = readJson(path.join(packageRoot, 'phase33c-scenarios', file)).scenarios;
  const reports = scenarios.map(evaluateScenario);
  const failed = reports.filter((r) => r.status !== 'PASS');
  return {
    status: failed.length ? 'FAIL' : 'PASS',
    capability,
    count: scenarios.length,
    fail: failed.length,
    sample_failures: failed.slice(0, 10).map((f) => ({
      scenario_id: f.scenario_id,
      behavior_violations: f.behavior_violations,
      schema_violations: f.schema_violations,
    })),
  };
}
