/**
 * Phase 32H-R1 — group manifest rows into synchronized H1/H2/H3 triplet batches.
 */
import { batchIdFromProbe } from './phase32h-triplet-batch.mjs';

export function userHashFromProbe(probe) {
  return probe.user_uid;
}

export function batchCoordinate(probe) {
  return {
    window: probe.window,
    run: probe.run,
    case_id: probe.case_id,
    user_uid: probe.user_uid,
    user_class: probe.user_class,
  };
}

export function coordinatesEqual(a, b) {
  return (
    a.window === b.window &&
    a.run === b.run &&
    a.case_id === b.case_id &&
    a.user_uid === b.user_uid &&
    a.user_class === b.user_class
  );
}

/** Build triplet batches from flat manifest (must have h1/h2/h3 per coordinate). */
export function groupManifestIntoTriplets(manifest) {
  const byBatch = new Map();
  for (const probe of manifest) {
    const batchId = batchIdFromProbe(probe);
    if (!byBatch.has(batchId)) {
      byBatch.set(batchId, {
        batch_id: batchId,
        coordinate: batchCoordinate(probe),
        members: {},
      });
    }
    const batch = byBatch.get(batchId);
    if (!coordinatesEqual(batch.coordinate, batchCoordinate(probe))) {
      throw new Error(`batch coordinate mismatch for ${batchId}`);
    }
    if (batch.members[probe.matrix_protocol]) {
      throw new Error(`duplicate ${probe.matrix_protocol} in batch ${batchId}`);
    }
    batch.members[probe.matrix_protocol] = probe;
  }

  const batches = [];
  for (const batch of byBatch.values()) {
    for (const proto of ['h1', 'h2', 'h3']) {
      if (!batch.members[proto]) {
        throw new Error(`batch ${batch.batch_id} missing protocol ${proto}`);
      }
    }
    batches.push({
      batch_id: batch.batch_id,
      coordinate: batch.coordinate,
      h1: batch.members.h1,
      h2: batch.members.h2,
      h3: batch.members.h3,
      probe_ids: {
        h1: batch.members.h1.probe_id,
        h2: batch.members.h2.probe_id,
        h3: batch.members.h3.probe_id,
      },
    });
  }

  batches.sort((a, b) => {
    const ka = `${a.coordinate.window}-${a.coordinate.run}-${a.coordinate.user_uid}-${a.coordinate.case_id}`;
    const kb = `${b.coordinate.window}-${b.coordinate.run}-${b.coordinate.user_uid}-${b.coordinate.case_id}`;
    return ka.localeCompare(kb);
  });
  return batches;
}

export function lifecycleMiniMatrixExcludedFromMainTotals(mainTotal, lifecyclePerArm = 120) {
  return lifecyclePerArm < mainTotal;
}

export const LIFECYCLE_MINI_MATRIX_PER_ARM = 30 * 4;
