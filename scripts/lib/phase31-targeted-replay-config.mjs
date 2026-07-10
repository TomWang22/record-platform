/**
 * Phase 31M — targeted preview lifecycle replay constants.
 */
import { createHash } from 'node:crypto';
import { CONTRACT, loadN5Participants, PROMPTS } from './phase22-full-replay-common.mjs';

export const DEFAULT_OUT = '/tmp/phase31-preview-lifecycle-repair-replay';
export const AFFECTED_USER_UID_HASH = '4c6830b9d086';
export const TARGETED_REPLAY_WINDOWS = [
  3, 4, 5, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30,
];
export const TARGETED_REPLAY_RUNS = [7, 8, 9, 10];
export const TARGETED_REPLAY_PROTOCOLS = ['h1', 'h2', 'h3'];
export const TARGETED_REPLAY_USERS = 2;
export const TARGETED_REPLAY_CASES = PROMPTS.length;
export const TARGETED_REPLAY_PER_PROTOCOL =
  TARGETED_REPLAY_WINDOWS.length *
  TARGETED_REPLAY_USERS *
  TARGETED_REPLAY_RUNS.length *
  TARGETED_REPLAY_CASES;
export const TARGETED_REPLAY_TOTAL = TARGETED_REPLAY_PER_PROTOCOL * TARGETED_REPLAY_PROTOCOLS.length;

export const TARGETED_EVIDENCE_LABEL =
  'Phase 31M targeted preview lifecycle repair replay: 3672/3672 target';

export function uidHash(uid) {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

export function resolveTargetedReplayUsers() {
  const preview = loadN5Participants().find((u) => uidHash(u.uid) === AFFECTED_USER_UID_HASH);
  if (!preview) {
    throw new Error(`affected preview user hash ${AFFECTED_USER_UID_HASH} not found in artifact`);
  }
  return [CONTRACT, preview];
}
