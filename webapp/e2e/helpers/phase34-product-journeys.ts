/**
 * Playwright helpers — product gauntlet journey capture + screenshot contract.
 */
export const PRODUCT_JOURNEY_CAPTURE_VERSION = 'phase34-product-journey-capture-v2';

export type ProductJourneyCapture = {
  schema_version: typeof PRODUCT_JOURNEY_CAPTURE_VERSION;
  session_id: string;
  turn_id: string;
  journey_id: string;
  triplet_id: string;
  capability: string;
  scenario_id: string;
  browser_route: string;
  viewport: string;
  authenticated_participant_role: 'buyer' | 'seller' | 'guest' | 'admin';
  action_sequence: string[];
  network_request_id: string | null;
  canonical_payload_hash: string | null;
  panel_loading_state: string | null;
  panel_ready_state: string | null;
  rendered_structured_value_hash: string | null;
  rendered_evidence_hash: string | null;
  rendered_limitation_hash: string | null;
  console_errors: string[];
  failed_requests: string[];
  accessibility_result: 'PASS' | 'FAIL' | 'NOT_EXECUTED';
  horizontal_overflow: boolean | null;
  client_protocol_observed: string | null;
  journey_outcome: 'PASS' | 'FAIL' | 'NOT_EXECUTED';
  automatic_send_allowed: boolean;
  production_mutation: boolean;
  screenshot_manifest_entry_ids: string[];
};

export function emptyJourneyCapture(
  partial: Partial<ProductJourneyCapture> &
    Pick<ProductJourneyCapture, 'session_id' | 'journey_id' | 'capability' | 'scenario_id'>,
): ProductJourneyCapture {
  return {
    schema_version: PRODUCT_JOURNEY_CAPTURE_VERSION,
    turn_id: partial.turn_id ?? '',
    triplet_id: partial.triplet_id ?? '',
    browser_route: '',
    viewport: 'desktop',
    authenticated_participant_role: 'buyer',
    action_sequence: [],
    network_request_id: null,
    canonical_payload_hash: null,
    panel_loading_state: null,
    panel_ready_state: null,
    rendered_structured_value_hash: null,
    rendered_evidence_hash: null,
    rendered_limitation_hash: null,
    console_errors: [],
    failed_requests: [],
    accessibility_result: 'NOT_EXECUTED',
    horizontal_overflow: null,
    client_protocol_observed: null,
    journey_outcome: 'NOT_EXECUTED',
    automatic_send_allowed: false,
    production_mutation: false,
    screenshot_manifest_entry_ids: [],
    ...partial,
  };
}
