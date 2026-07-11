/**
 * Phase 23B — authoritative ACTIVE_CONTEXT lineage checks (supersedes stale hardcoded SHAs).
 */
import fs from 'node:fs';
import path from 'node:path';

export const ACTIVE_CONTEXT_PATH = 'docs/ai-platform/ACTIVE_CONTEXT.md';

export const REQUIRED_LINEAGE_PREFIXES = [
  'Phase 23A operations-design commit:',
  'Phase 23A metadata-sync commit:',
];

export const REQUIRED_FROZEN_PREFIXES = [
  'Phase 22 archive HEAD:',
  'Phase 21 archive checkpoint:',
  'Phase 21 pre-archive validation HEAD:',
];

export const STALE_LINEAGE_SHAS = ['77af124', '6442d87'];
export const STALE_FROZEN_SHAS = ['5588779', '328161d', 'bd76875'];

const SHA_LINE = /^- (.+): ([0-9a-f]{7,40})$/i;

export class Phase22ArchiveLineageGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase22ArchiveLineageGuardError';
  }
}

export function parseLineageSection(content) {
  const lineage = {};
  const frozen = {};
  let inLineage = false;
  let inFrozen = false;
  for (const line of content.split('\n')) {
    if (/^Phase handoff lineage:/i.test(line)) {
      inLineage = true;
      inFrozen = false;
      continue;
    }
    if (/^Frozen archive heads:/i.test(line)) {
      inFrozen = true;
      inLineage = false;
      continue;
    }
    if (/^Phase \d+:/i.test(line) || /^Next allowed step:/i.test(line)) {
      inLineage = false;
      inFrozen = false;
    }
    const m = line.match(SHA_LINE);
    if (!m) continue;
    if (inLineage) lineage[m[1]] = m[2];
    if (inFrozen) frozen[m[1]] = m[2];
  }
  return { lineage, frozen };
}

export function validateActiveContextLineage(content, relativePath = ACTIVE_CONTEXT_PATH) {
  if (!/Phase handoff lineage:/i.test(content)) {
    throw new Phase22ArchiveLineageGuardError(`${relativePath} missing Phase handoff lineage section`);
  }
  if (!/Frozen archive heads:/i.test(content)) {
    throw new Phase22ArchiveLineageGuardError(`${relativePath} missing Frozen archive heads section`);
  }
  const { lineage, frozen } = parseLineageSection(content);
  for (const prefix of REQUIRED_LINEAGE_PREFIXES) {
    const key = prefix.replace(/:$/, '');
    const sha = lineage[key];
    if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
      throw new Phase22ArchiveLineageGuardError(
        `${relativePath} missing or invalid ${prefix} <7+ hex sha>`,
      );
    }
    if (STALE_LINEAGE_SHAS.includes(sha.toLowerCase().slice(0, 7))) {
      throw new Phase22ArchiveLineageGuardError(
        `${relativePath} still references stale ${prefix} ${sha}`,
      );
    }
  }
  for (const prefix of REQUIRED_FROZEN_PREFIXES) {
    const key = prefix.replace(/:$/, '');
    const sha = frozen[key];
    if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
      throw new Phase22ArchiveLineageGuardError(
        `${relativePath} missing or invalid ${prefix} <7+ hex sha>`,
      );
    }
    if (STALE_FROZEN_SHAS.includes(sha.toLowerCase().slice(0, 7))) {
      throw new Phase22ArchiveLineageGuardError(
        `${relativePath} still references stale ${prefix} ${sha}`,
      );
    }
  }
  return { lineage, frozen };
}

export function validateActiveContextFile(repoRoot, relativePath = ACTIVE_CONTEXT_PATH) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase22ArchiveLineageGuardError(`missing ${relativePath}`);
  }
  return validateActiveContextLineage(fs.readFileSync(filePath, 'utf8'), relativePath);
}
