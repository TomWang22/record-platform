/**
 * Phase 33E package verifier.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateScenario } from './phase33e-intelligence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AI = path.join(ROOT, 'ai-platform');

export function verifyPhase33e({ capabilityFilter = null } = {}) {
  const violations = [];
  const policyPath = path.join(AI, 'phase33e-acceptance-policy.json');
  if (!fs.existsSync(policyPath)) violations.push('missing_policy');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  if (policy.production_authorized !== false) violations.push('policy_production');
  if (policy.durable_private_memory_authorized !== false) violations.push('policy_durable_memory');

  const invPath = path.join(AI, 'phase33e-scenarios', 'inventory.json');
  if (!fs.existsSync(invPath)) violations.push('missing_inventory_run_generator');
  const inventory = JSON.parse(fs.readFileSync(invPath, 'utf8'));
  if (inventory.market_analytics < (policy.scenario_minimums?.market_analytics || 300)) {
    violations.push('analytics_scenario_minimum');
  }
  if (inventory.multi_turn_memory < (policy.scenario_minimums?.multi_turn_memory || 300)) {
    violations.push('memory_scenario_minimum');
  }
  if (inventory.total < (policy.scenario_minimums?.total || 600)) {
    violations.push('total_scenario_minimum');
  }

  const packs = [];
  if (!capabilityFilter || capabilityFilter === 'market_analytics') {
    packs.push(JSON.parse(fs.readFileSync(path.join(AI, 'phase33e-scenarios/market-analytics.json'), 'utf8')));
  }
  if (!capabilityFilter || capabilityFilter === 'multi_turn_memory') {
    packs.push(JSON.parse(fs.readFileSync(path.join(AI, 'phase33e-scenarios/memory.json'), 'utf8')));
  }

  let pass = 0;
  let fail = 0;
  let hard = 0;
  for (const pack of packs) {
    for (const sc of pack.scenarios) {
      if (
        capabilityFilter &&
        sc.capability_id !== capabilityFilter &&
        !(capabilityFilter === 'multi_turn_memory' && sc.capability_id === 'memory')
      ) {
        continue;
      }
      const r = evaluateScenario(sc);
      if (r.status === 'PASS') pass += 1;
      else fail += 1;
      hard += r.hard_violations.length;
    }
  }

  const routesPy = path.join(ROOT, '..', 'services/python-ai-service/app/ai/routes.py');
  const routesText = fs.readFileSync(routesPy, 'utf8');
  if (!routesText.includes('/intelligence/market-analytics')) violations.push('missing_route_analytics');
  if (!routesText.includes('/intelligence/memory/resolve')) violations.push('missing_route_memory_resolve');
  if (!routesText.includes('/intelligence/memory/forget')) violations.push('missing_route_memory_forget');

  if (hard > 0) violations.push(`hard_violations:${hard}`);
  const total = pass + fail;
  const passRate = pass / Math.max(1, total);
  if (passRate < 0.95) violations.push(`pass_rate_low:${passRate}`);

  return {
    status: violations.length ? 'FAIL' : 'PASS',
    pass,
    fail,
    hard_violations: hard,
    pass_rate: passRate,
    violations,
    inventory,
  };
}
