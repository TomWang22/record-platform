/**
 * Write-once Gate-3 run identity. Discover environment first, mint once, never edit.
 */
import { closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import {
  CONTROL_PLANE_PROVENANCE_MISMATCH,
  SOURCE_PROVENANCE_MISMATCH,
} from "./pgbench_cell_provenance.mjs";

export const RUN_IDENTITY_MUTATION_REFUSED = "RUN_IDENTITY_MUTATION_REFUSED";
export const RUN_IDENTITY_SCHEMA = "record-platform-pgbench-run-identity/v1";

export function loadRunIdentity(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Exclusive create (O_CREAT|O_EXCL) + fsync(file) + fsync(parent).
 * Refuses if the file already exists (even with identical bytes).
 * @param {string} path
 * @param {Record<string, unknown>} identity
 */
export function writeRunIdentityOnce(path, identity) {
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify(identity, null, 2) + "\n";
  let fd;
  try {
    fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      return { ok: false, reason: RUN_IDENTITY_MUTATION_REFUSED, path };
    }
    throw err;
  }
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dirFd = openSync(dirname(path), "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
  return { ok: true, reason: null, path };
}

/**
 * Runner/supervisor resume gate: live control-plane digest must equal the minted identity.
 * @param {Record<string, unknown> | null | undefined} identity
 * @param {{ control_plane_bundle_sha?: string, workload_source_bundle_sha?: string, source_bundle_sha?: string }} live
 */
export function assertControlPlaneMatchesIdentity(identity, live) {
  const frozenControl = identity?.control_plane_bundle_sha;
  const liveControl = live?.control_plane_bundle_sha;
  if (!frozenControl || !liveControl || frozenControl !== liveControl) {
    return {
      ok: false,
      reason: CONTROL_PLANE_PROVENANCE_MISMATCH,
      frozen: frozenControl ?? null,
      live: liveControl ?? null,
    };
  }
  const frozenWorkload = identity?.workload_source_bundle_sha || identity?.source_bundle_sha;
  const liveWorkload = live?.workload_source_bundle_sha || live?.source_bundle_sha;
  if (frozenWorkload && liveWorkload && frozenWorkload !== liveWorkload) {
    return {
      ok: false,
      reason: SOURCE_PROVENANCE_MISMATCH,
      frozen: frozenWorkload,
      live: liveWorkload,
    };
  }
  return { ok: true, reason: null };
}
