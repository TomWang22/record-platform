/**
 * Client-action contracts for the 24 owner-proof scenarios.
 * Declared in JSON; promoted to LIVE_* only by the live-action preflight.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadOwnerProofScenarios,
  ACTION_PROOF_STATUSES,
  OFFICIAL_REHEARSAL_MIN_ACTION_PROOF,
} from './phase34-owner-proof-scenarios.mjs';
import { CAPABILITY_SURFACE_REGISTRY } from './phase34-product-journeys/adapters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OWNER_PROOF_CLIENT_ACTION_CONTRACTS_PATH = path.join(
  __dirname,
  '../ai-platform/phase34-owner-proof-client-action-contracts.json',
);

function panelTestIdFromSelector(selector) {
  const m = String(selector || '').match(/data-testid=["']([^"']+)["']/);
  return m ? m[1] : null;
}

function actionTestIdFromSelector(selector) {
  const m = String(selector || '').match(/data-testid=["']([^"']+)["']/);
  return m ? m[1] : null;
}

export function buildClientActionContracts(doc = loadOwnerProofScenarios()) {
  const contracts = doc.scenarios.map((s) => {
    const reg = CAPABILITY_SURFACE_REGISTRY[s.capability];
    return {
      scenario_id: s.scenario_id,
      route: s.canonical_route,
      capability: s.capability,
      component_test_id: panelTestIdFromSelector(s.pre_action_selector || s.terminal_panel_selector),
      intent_control_test_id: panelTestIdFromSelector(s.input_control_selector) ||
        actionTestIdFromSelector(s.input_control_selector),
      action_test_id:
        actionTestIdFromSelector(s.initiating_action_selector) || reg?.runTestId || null,
      expected_endpoint: s.expected_endpoint,
      expected_method: s.expected_method || 'POST',
      terminal_panel_test_id: panelTestIdFromSelector(s.terminal_panel_selector),
      required_terminal_fields: s.required_visible_customer_fields || [],
      success_data_floor: {
        minimum_evidence: s.minimum_evidence,
        minimum_results: s.minimum_results,
        minimum_watchlist_lots: s.minimum_watchlist_lots,
        minimum_recommendation_cards: s.minimum_recommendation_cards,
        allow_empty_evidence: s.allow_empty_evidence === true,
        expected_terminal_state: s.expected_terminal_state,
      },
      action_proof_status: s.action_proof_status,
      scenario_class: s.scenario_class,
    };
  });
  return {
    schema_version: 'phase34-owner-proof-client-action-contracts-v1',
    count: contracts.length,
    official_rehearsal_requires: OFFICIAL_REHEARSAL_MIN_ACTION_PROOF,
    statuses: ACTION_PROOF_STATUSES,
    contracts,
  };
}

export function writeClientActionContracts(outPath = OWNER_PROOF_CLIENT_ACTION_CONTRACTS_PATH) {
  const doc = buildClientActionContracts();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

export function loadClientActionContracts() {
  if (!fs.existsSync(OWNER_PROOF_CLIENT_ACTION_CONTRACTS_PATH)) {
    return writeClientActionContracts();
  }
  return JSON.parse(fs.readFileSync(OWNER_PROOF_CLIENT_ACTION_CONTRACTS_PATH, 'utf8'));
}

export function assertContractsMatchScenarios() {
  const scenarios = loadOwnerProofScenarios();
  const contracts = loadClientActionContracts();
  if (contracts.count !== 24 || contracts.contracts.length !== 24) {
    throw new Error(`client_action_contracts_count_${contracts.contracts?.length}`);
  }
  const byId = new Map(contracts.contracts.map((c) => [c.scenario_id, c]));
  for (const s of scenarios.scenarios) {
    const c = byId.get(s.scenario_id);
    if (!c) throw new Error(`client_action_contract_missing:${s.scenario_id}`);
    if (c.expected_endpoint !== s.expected_endpoint) {
      throw new Error(`client_action_endpoint_mismatch:${s.scenario_id}`);
    }
    if (c.capability !== s.capability) {
      throw new Error(`client_action_capability_mismatch:${s.scenario_id}`);
    }
    if (!c.action_test_id) throw new Error(`client_action_testid_missing:${s.scenario_id}`);
    if (!c.component_test_id) throw new Error(`client_action_component_missing:${s.scenario_id}`);
    // Scarcity/valuation must not share the legacy shared run control.
    if (s.capability === 'scarcity' && c.action_test_id === 'intelligence-owner-proof-run') {
      throw new Error('scarcity_must_not_use_shared_owner_proof_run');
    }
    if (s.capability === 'valuation' && c.action_test_id === 'intelligence-owner-proof-run') {
      throw new Error('valuation_must_not_use_shared_owner_proof_run');
    }
  }
  return true;
}
