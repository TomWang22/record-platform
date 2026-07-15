/**
 * Phase 33D package verifier — policy, scenarios, hard stops, routes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateScenario } from './phase33d-intelligence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AI = path.join(ROOT, 'ai-platform');

export function verifyPhase33d({ capabilityFilter = null } = {}) {
  const violations = [];
  const policyPath = path.join(AI, 'phase33d-acceptance-policy.json');
  if (!fs.existsSync(policyPath)) violations.push('missing_policy');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  if (policy.automatic_send_allowed !== false) violations.push('policy_auto_send');
  if (policy.production_authorized !== false) violations.push('policy_production');

  const invPath = path.join(AI, 'phase33d-scenarios', 'inventory.json');
  if (!fs.existsSync(invPath)) violations.push('missing_inventory_run_generator');
  const inventory = JSON.parse(fs.readFileSync(invPath, 'utf8'));
  if (inventory.negotiation < (policy.scenario_minimums?.negotiation_assistance || 300)) {
    violations.push('negotiation_scenario_minimum');
  }
  if (inventory.recommendations < (policy.scenario_minimums?.recommendations || 300)) {
    violations.push('recommendation_scenario_minimum');
  }
  if (inventory.total < (policy.scenario_minimums?.total || 600)) {
    violations.push('total_scenario_minimum');
  }

  const packs = [];
  if (!capabilityFilter || capabilityFilter === 'negotiation_assistance') {
    packs.push(JSON.parse(fs.readFileSync(path.join(AI, 'phase33d-scenarios/negotiation.json'), 'utf8')));
  }
  if (!capabilityFilter || capabilityFilter === 'recommendations') {
    packs.push(JSON.parse(fs.readFileSync(path.join(AI, 'phase33d-scenarios/recommendations.json'), 'utf8')));
  }

  let pass = 0;
  let fail = 0;
  let hard = 0;
  for (const pack of packs) {
    for (const sc of pack.scenarios) {
      if (capabilityFilter && sc.capability_id !== capabilityFilter && !(capabilityFilter === 'negotiation_assistance' && sc.capability_id === 'negotiation')) {
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
  if (!routesText.includes('/intelligence/negotiation')) violations.push('missing_route_negotiation');
  if (!routesText.includes('/intelligence/recommendations')) violations.push('missing_route_recommendations');

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
