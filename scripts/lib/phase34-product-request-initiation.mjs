/**
 * Fail closed when the harness waits for an intelligence POST the UI never starts.
 */

export const EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST =
  'EXPECTED_CLIENT_ACTION_DID_NOT_INITIATE_INTELLIGENCE_REQUEST';

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
