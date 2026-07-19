/**
 * Fail closed when the harness waits for an intelligence POST the UI never starts.
 */

export const EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST =
  'EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST';

/** Click occurred but the capability onRun handler never ran (wrong control / no attach). */
export const OWNER_PROOF_ACTION_DID_NOT_REACH_CAPABILITY_HANDLER =
  'OWNER_PROOF_ACTION_DID_NOT_REACH_CAPABILITY_HANDLER';

/**
 * @param {object} input
 */
export function assertOwnerProofHandlerReached(input) {
  const {
    route,
    component,
    capability,
    action,
    expected_endpoint,
    handler_reached,
    handler_capability,
    click_timestamp,
    hydration_ready,
    button_enabled,
    request_candidates,
  } = input;
  if (handler_reached === true) {
    if (capability && handler_capability && capability !== handler_capability) {
      const err = new Error(
        `${OWNER_PROOF_ACTION_DID_NOT_REACH_CAPABILITY_HANDLER}: ` +
          `expected capability=${capability} got=${handler_capability} ` +
          `route=${route || ''} component=${component || ''} action=${action || ''}`,
      );
      err.code = OWNER_PROOF_ACTION_DID_NOT_REACH_CAPABILITY_HANDLER;
      err.meta = { ...input, mismatch: true };
      throw err;
    }
    return true;
  }
  const err = new Error(
    `${OWNER_PROOF_ACTION_DID_NOT_REACH_CAPABILITY_HANDLER}: ` +
      `route=${route || ''} component=${component || ''} capability=${capability || ''} ` +
      `action=${action || ''} endpoint=${expected_endpoint || ''} ` +
      `hydration_ready=${hydration_ready} button_enabled=${button_enabled} ` +
      `click_at=${click_timestamp || ''} candidates=${JSON.stringify(request_candidates || [])}`,
  );
  err.code = OWNER_PROOF_ACTION_DID_NOT_REACH_CAPABILITY_HANDLER;
  err.meta = { ...input };
  throw err;
}

/**
 * @param {object} input
 */
export function assertIntelligenceRequestInitiated(input) {
  const {
    route,
    component,
    participant_side,
    viewport,
    action,
    expected_endpoint,
    browser_request_observed,
    request_body_captured,
    response_observed,
    mounted,
    visible,
  } = input;

  const failures = [];
  if (mounted !== true) failures.push('mounted!=true');
  if (visible !== true) failures.push('visible!=true');
  if (browser_request_observed !== true) failures.push('browser_request_observed!=true');
  if (request_body_captured !== true) failures.push('request_body_captured!=true');
  if (response_observed !== true) failures.push('response_observed!=true');

  if (failures.length) {
    const err = new Error(
      `${EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST}: ` +
        `route=${route || ''} component=${component || ''} role=${participant_side || ''} ` +
        `viewport=${typeof viewport === 'object' ? JSON.stringify(viewport) : viewport || ''} ` +
        `action=${action || ''} endpoint=${expected_endpoint || ''} ` +
        `failures=${failures.join(',')}`,
    );
    err.code = EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST;
    err.meta = {
      route: route || null,
      component: component || null,
      participant_side: participant_side || null,
      viewport: viewport || null,
      action: action || null,
      expected_endpoint: expected_endpoint || null,
      mounted: mounted === true,
      visible: visible === true,
      browser_request_observed: browser_request_observed === true,
      request_body_captured: request_body_captured === true,
      response_observed: response_observed === true,
      failures,
    };
    throw err;
  }
  return true;
}
