#!/usr/bin/env node
/**
 * Validate Phase 34 owner-proof scenarios against the executable schema
 * and capability/route/endpoint identity rules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  loadOwnerProofScenarios,
  validateOwnerProofExecutableRegistry,
} from '../lib/phase34-owner-proof-scenarios.mjs';
import { CAPABILITY_SURFACE_REGISTRY } from '../lib/phase34-product-journeys/adapters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const SCHEMA_PATH = path.join(__dirname, 'phase34-owner-proof-scenario.schema.json');

function validateWithAjv(doc) {
  let Ajv;
  try {
    const require = createRequire(import.meta.url);
    Ajv = require('ajv').default || require('ajv');
  } catch {
    return { skipped: true, reason: 'ajv_not_installed' };
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = ajv.compile(schema);
  const ok = validate(doc);
  return { skipped: false, ok, errors: validate.errors || [] };
}

function assertRouteMounted(scenario) {
  const reg = CAPABILITY_SURFACE_REGISTRY[scenario.capability];
  if (!reg) throw new Error(`no_registry:${scenario.capability}`);
  const route = scenario.canonical_route;
  const surfaces = reg.mounted_surfaces || [];
  const hit = surfaces.some((s) => {
    if (s.status !== 'MOUNTED') return false;
    if (s.route === route) return true;
    // template match /listings/[id]/edit
    const pattern = String(s.route).replace(/\[.*?\]/g, '[^/]+');
    return new RegExp(`^${pattern}$`).test(route.replace(/\[.*?\]/g, 'x'));
  });
  // Also allow exact template equality
  const templateHit = surfaces.some((s) => s.status === 'MOUNTED' && s.route === route);
  if (!hit && !templateHit) {
    // soft: route string equals one of registry routes list
    if (!(reg.routes || []).includes(route)) {
      throw new Error(`canonical_route_not_mounted:${scenario.scenario_id}:${route}`);
    }
  }
  if (!scenario.expected_endpoint.includes('/api/ai/intelligence/')) {
    throw new Error(`bad_endpoint:${scenario.scenario_id}`);
  }
  if (scenario.expected_request_capability !== scenario.capability) {
    throw new Error(`capability_endpoint_mismatch:${scenario.scenario_id}`);
  }
  if (!scenario.terminal_panel_selector.includes('intelligence-')) {
    throw new Error(`terminal_selector:${scenario.scenario_id}`);
  }
  if (!scenario.input_control_selector || !scenario.initiating_action_selector) {
    throw new Error(`intent_or_action_missing:${scenario.scenario_id}`);
  }
  if (scenario.scenario_class === 'A_success' && scenario.allow_empty_evidence) {
    throw new Error(`success_allows_empty:${scenario.scenario_id}`);
  }
}

function main() {
  const doc = loadOwnerProofScenarios();
  validateOwnerProofExecutableRegistry(doc);
  const ajvResult = validateWithAjv(doc);
  const issues = [];
  for (const s of doc.scenarios) {
    try {
      assertRouteMounted(s);
    } catch (err) {
      issues.push(String(err.message || err));
    }
  }
  if (ajvResult.skipped === false && !ajvResult.ok) {
    for (const e of ajvResult.errors) {
      issues.push(`schema:${e.instancePath} ${e.message}`);
    }
  }
  const report = {
    status: issues.length ? 'FAIL' : 'PASS',
    schema_path: path.relative(REPO, SCHEMA_PATH),
    ajv: ajvResult,
    scenario_count: doc.scenarios.length,
    issues,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(issues.length ? 2 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
