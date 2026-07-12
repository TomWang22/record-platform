/**
 * Reject newly pushed refs that preserve stale assistant attribution history.
 */
const FORBIDDEN_REF_PATTERNS = [
  /^refs\/(?:heads|remotes\/origin)\/backup\//i,
  /^refs\/(?:heads|remotes\/origin)\/rewrite\//i,
  /^refs\/(?:heads|remotes\/origin)\/archive\//i,
  /^refs\/(?:heads|remotes\/origin)\/pre-cursor/i,
  /cursor/i,
  /assistant-trailer/i,
  /-upload$/i,
];

const ALLOWED_REF_PATTERNS = [
  /^refs\/heads\/main$/i,
  /^refs\/remotes\/origin\/main$/i,
  /^refs\/heads\/feat\//i,
  /^refs\/heads\/phase-/i,
  /^refs\/remotes\/origin\/HEAD$/i,
];

export function isForbiddenRetainedRef(refname) {
  const ref = String(refname || '');
  if (ALLOWED_REF_PATTERNS.some((pattern) => pattern.test(ref))) {
    return false;
  }
  return FORBIDDEN_REF_PATTERNS.some((pattern) => pattern.test(ref));
}

export function listForbiddenRetainedRefs(refnames) {
  return refnames.filter((refname) => isForbiddenRetainedRef(refname));
}
