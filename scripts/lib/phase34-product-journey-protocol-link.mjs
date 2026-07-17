/**
 * Links a Playwright journey outcome to a synchronized H1/H2/H3 protocol triplet.
 * Does not execute probes yet — contract + fail-closed predicates only.
 */
import { LINK_FIELDS, hashCanonicalRequest } from './phase34-product-ledgers.mjs';

export const PRODUCT_JOURNEY_PROTOCOL_LINK_VERSION = 'phase34-product-journey-protocol-link-v1';

/**
 * @param {object} journey
 * @param {object} protocolTriplet — { h1, h2, h3 } probe result rows
 * @param {object} reconciliation — UI vs accepted API comparison
 */
export function evaluateProductSessionPass({ journey, protocolTriplet, reconciliation }) {
  const missingLinks = LINK_FIELDS.filter((f) => !journey?.[f] && journey?.[f] !== 0);
  const h1 = protocolTriplet?.h1;
  const h2 = protocolTriplet?.h2;
  const h3 = protocolTriplet?.h3;

  const protocolPass =
    h1?.ok === true &&
    h2?.ok === true &&
    h3?.ok === true &&
    h1?.http_status > 0 &&
    h1?.http_status < 400 &&
    h2?.http_status > 0 &&
    h2?.http_status < 400 &&
    h3?.http_status > 0 &&
    h3?.http_status < 400;

  const hardFails = [];
  if (journey?.journey_outcome !== 'PASS') hardFails.push('browser_journey_failure');
  if (!protocolPass) hardFails.push('protocol_triplet_failure');
  if (reconciliation?.status !== 'PASS') hardFails.push('client_api_material_mismatch');
  if (missingLinks.length) hardFails.push(`missing_link_fields:${missingLinks.join(',')}`);
  if (journey?.automatic_send_allowed === true) hardFails.push('automatic_send_violation');
  if (journey?.production_mutation === true) hardFails.push('production_mutation');

  return {
    schema_version: PRODUCT_JOURNEY_PROTOCOL_LINK_VERSION,
    session_pass: hardFails.length === 0,
    hard_fails: hardFails,
    browser_journey: journey?.journey_outcome ?? 'NOT_EXECUTED',
    protocol: {
      h1: h1?.ok === true ? 'PASS' : 'BLOCKED_OR_MISSING',
      h2: h2?.ok === true ? 'PASS' : 'BLOCKED_OR_MISSING',
      h3: h3?.ok === true ? 'PASS' : 'BLOCKED_OR_MISSING',
    },
    reconciliation: reconciliation?.status ?? 'NOT_EXECUTED',
  };
}

/**
 * Build link identity bundle from journey capture + canonical payload.
 */
export function buildJourneyProtocolLinkIds({
  session_id,
  turn_id,
  journey_id,
  triplet_id,
  capability,
  scenario_id,
  participant_id_hash,
  evidence_snapshot_hash,
  canonical_payload,
}) {
  const canonical_request_hash = hashCanonicalRequest(canonical_payload);
  return {
    session_id,
    turn_id,
    journey_id,
    triplet_id,
    canonical_request_hash,
    participant_id_hash,
    capability,
    scenario_id,
    evidence_snapshot_hash: evidence_snapshot_hash ?? null,
  };
}

export const REQUIRED_PRODUCT_JOURNEY_FAMILIES = Object.freeze([
  'scarcity',
  'valuation',
  'auction_intelligence',
  'embeddings_lineage',
  'semantic_hybrid_search',
  'negotiation_assistance',
  'recommendations',
  'market_analytics',
  'memory',
]);

/**
 * Terminal language helpers — never claim full product acceptance from API soak.
 */
export function transportSoakTerminalPhrase(pass) {
  if (pass) {
    return 'PHASE 34 API/INFERENCE TRANSPORT SOAK-V3 PASS — END-TO-END PRODUCT GAUNTLET NOT EXECUTED';
  }
  return 'PHASE 34 API/INFERENCE TRANSPORT SOAK-V3 BLOCKED';
}

export function productAcceptanceReadyAllowed({ protocol, product, evidence, humanReview, visual }) {
  return (
    protocol === 'PASS' &&
    product === 'PASS' &&
    evidence === 'COMPLETE' &&
    humanReview === 'COMPLETE' &&
    visual === 'ACCEPTED'
  );
}
