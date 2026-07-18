/**
 * Terminal screenshot classification and per-turn reconciliation.
 * limitations_expanded / evidence_expanded / before_action / loading are NOT terminal.
 */
export const TERMINAL_SCREENSHOT_STATES = Object.freeze([
  'final',
  'final_success',
  'success',
  'abstention',
  'refusal',
  'unauthorized_refusal',
  'weak_data',
  'stale_data',
  'terminal_error',
  'service_failure',
  'rate_limit',
  'dense_evidence',
]);

export const NON_TERMINAL_SCREENSHOT_STATES = Object.freeze([
  'before_action',
  'loading',
  'evidence_expanded',
  'limitations_expanded',
]);

export function isTerminalScreenshotState(state) {
  return TERMINAL_SCREENSHOT_STATES.includes(String(state || ''));
}

export function normalizeTerminalState(state) {
  const s = String(state || '');
  if (s === 'final' || s === 'success' || s === 'final_success') return 'final_success';
  if (s === 'unauthorized_refusal' || s === 'refusal') return 'refusal';
  if (TERMINAL_SCREENSHOT_STATES.includes(s)) return s;
  return null;
}

/**
 * Exactly one terminal screenshot per turn.
 * @param {Array<{turn_id:string,state:string,screenshot_id?:string}>} screenshotRows
 * @param {string[]} turnIds
 */
export function reconcileTerminalScreenshots(screenshotRows = [], turnIds = []) {
  const byTurn = new Map();
  for (const row of screenshotRows) {
    const tid = row.turn_id;
    if (!tid) continue;
    if (!byTurn.has(tid)) byTurn.set(tid, []);
    byTurn.get(tid).push(row);
  }
  const turns = [];
  const missing = [];
  const multi = [];
  for (const turn_id of turnIds) {
    const shots = byTurn.get(turn_id) || [];
    const terminals = shots.filter((s) => isTerminalScreenshotState(s.state));
    let status = 'OK';
    if (terminals.length === 0) {
      status = 'MISSING_TERMINAL';
      missing.push(turn_id);
    } else if (terminals.length > 1) {
      status = 'MULTIPLE_TERMINAL';
      multi.push(turn_id);
    }
    const t0 = terminals[0] || null;
    turns.push({
      turn_id,
      status,
      terminal_state: t0 ? normalizeTerminalState(t0.state) : null,
      terminal_screenshot_id: terminals.length === 1 ? t0.screenshot_id : null,
      terminal_screenshot_count: terminals.length,
      all_states: shots.map((s) => s.state),
    });
  }
  return {
    executed_turns: turnIds.length,
    terminal_screenshot_turns: turns.filter((t) => t.status === 'OK').length,
    turns_missing_terminal_screenshot: missing.length,
    turns_with_multiple_terminal_screenshots: multi.length,
    missing_turn_ids: missing,
    multi_turn_ids: multi,
    turns,
    pass: missing.length === 0 && multi.length === 0 && turnIds.length > 0,
  };
}

/**
 * Chronology: before_action < loading? < terminal < expanded?
 */
export function assertScreenshotChronology(screenshotRows = []) {
  const orderRank = (state) => {
    if (state === 'before_action') return 0;
    if (state === 'loading') return 1;
    if (isTerminalScreenshotState(state)) return 2;
    if (state === 'evidence_expanded' || state === 'limitations_expanded') return 3;
    return 9;
  };
  const byTurn = new Map();
  for (const row of screenshotRows) {
    const tid = row.turn_id || '_';
    if (!byTurn.has(tid)) byTurn.set(tid, []);
    byTurn.get(tid).push(row);
  }
  const violations = [];
  for (const [turn_id, rows] of byTurn) {
    const sorted = [...rows].sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
    let prev = -1;
    for (const row of sorted) {
      const rank = orderRank(row.state);
      if (rank < prev) {
        violations.push({ turn_id, state: row.state, captured_at: row.captured_at });
      }
      if (rank !== 9) prev = Math.max(prev, rank);
      const responseExpected = rank >= 2;
      if (row.response_available_at_capture === false && responseExpected) {
        violations.push({
          turn_id,
          state: row.state,
          reason: 'response_available_at_capture_false_for_post_response_state',
        });
      }
      if (row.state === 'before_action' && row.response_available_at_capture === true) {
        violations.push({
          turn_id,
          state: row.state,
          reason: 'before_action_must_not_claim_response_available',
        });
      }
    }
  }
  return { chronology_violations: violations.length, violations };
}
