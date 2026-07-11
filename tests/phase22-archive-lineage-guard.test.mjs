import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Phase22ArchiveLineageGuardError,
  validateActiveContextLineage,
} from '../scripts/lib/phase22-archive-lineage-guard.mjs';

const GOOD = `
Phase handoff lineage:
- Phase 23A operations-design commit: 2223168
- Phase 23A metadata-sync commit: 0e8e6d2

Frozen archive heads:
- Phase 22 archive HEAD: 7257380
- Phase 21 archive checkpoint: 1422152
- Phase 21 pre-archive validation HEAD: 2eb1606
`;

describe('phase22 archive lineage guard', () => {
  it('accepts current authoritative lineage SHAs', () => {
    const { lineage, frozen } = validateActiveContextLineage(GOOD);
    assert.equal(lineage['Phase 23A operations-design commit'], '2223168');
    assert.equal(frozen['Phase 22 archive HEAD'], '7257380');
  });

  it('rejects stale historical Phase 23A SHAs', () => {
    const stale = GOOD.replace('2223168', '77af124');
    assert.throws(
      () => validateActiveContextLineage(stale),
      Phase22ArchiveLineageGuardError,
    );
  });

  it('rejects stale frozen archive heads', () => {
    const stale = GOOD.replace('7257380', '5588779');
    assert.throws(
      () => validateActiveContextLineage(stale),
      Phase22ArchiveLineageGuardError,
    );
  });
});
