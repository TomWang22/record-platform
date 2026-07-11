/**
 * Phase 32H — targeted reproduction guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PHASE32H_OUT,
  PHASE32H_EVIDENCE_LABEL,
  TARGET_TOTAL,
  isPhase32hRoot,
} from './phase32h-targeted-reproduction-config.mjs';

export class Phase32hGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase32hGuardError';
  }
}

export function assertTmpOnly(outRoot) {
  if (!String(outRoot).startsWith('/tmp/')) {
    throw new Phase32hGuardError(`output must be under /tmp: ${outRoot}`);
  }
}

export function validateEvidenceLabel(content) {
  if (!content.includes(PHASE32H_EVIDENCE_LABEL)) {
    throw new Phase32hGuardError('missing Phase 32H evidence label');
  }
  const forbidden = [
    'Phase 31D-R2 repaired staging long-soak matrix: 51840/51840',
    'Phase 32G timing-attributed repaired long-soak matrix: 51840/51840',
    '57105/57105',
    '171315/171315',
  ];
  for (const label of forbidden) {
    if (content.includes(label)) {
      throw new Phase32hGuardError(`forbidden merged evidence label: ${label}`);
    }
  }
}

export function validatePhase32hRoot(outRoot = DEFAULT_PHASE32H_OUT) {
  assertTmpOnly(outRoot);
  if (!isPhase32hRoot(outRoot)) {
    throw new Phase32hGuardError(`not a phase32h root: ${outRoot}`);
  }
  const summaryPath = path.join(outRoot, 'phase32h-targeted-summary.json');
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    if (summary.evidence_label) validateEvidenceLabel(summary.evidence_label);
    if (summary.matrix_total === `${TARGET_TOTAL}/${TARGET_TOTAL}` && summary.gates?.status === 'PASS') {
      return { status: 'PASS', summary };
    }
  }
  return { status: 'IN_PROGRESS', outRoot };
}
