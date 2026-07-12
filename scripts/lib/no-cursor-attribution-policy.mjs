/**
 * Shared Cursor/CursorAgent attribution policy for guards and hooks.
 */
export const EXACT_CURSOR_COAUTHOR_TRAILER_RE =
  /^Co-authored-by:\s*Cursor(?:\s+Agent)?\s*<cursoragent@(cursor\.com|users\.noreply\.github\.com)>\s*$/i;

export const ATTRIBUTION_TRAILER_RE =
  /^(?:co-authored-by|signed-off-by|reviewed-by|assisted-by):\s*.*(?:cursoragent@cursor\.com|cursoragent@users\.noreply\.github\.com|\bcursor\b).*$/i;

export const FORBIDDEN_IDENTITY_EMAILS = [
  'cursoragent@cursor.com',
  'cursoragent@users.noreply.github.com',
];

export const FORBIDDEN_IDENTITY_NAME_TOKENS = ['cursor', 'cursoragent'];

export function containsForbiddenIdentityName(value) {
  const normalized = String(value || '').toLowerCase();
  return FORBIDDEN_IDENTITY_NAME_TOKENS.some((token) => normalized.includes(token));
}

export function containsForbiddenIdentityEmail(value) {
  const normalized = String(value || '').toLowerCase();
  return (
    FORBIDDEN_IDENTITY_EMAILS.some((email) => normalized === email) ||
    normalized.includes('cursor.com')
  );
}

export function findExactCursorCoauthorTrailerLine(message) {
  for (const line of String(message || '').split(/\r?\n/)) {
    if (EXACT_CURSOR_COAUTHOR_TRAILER_RE.test(line.trim())) {
      return line.trim();
    }
  }
  return null;
}

export function findCursorTrailerLine(message) {
  const exact = findExactCursorCoauthorTrailerLine(message);
  if (exact) return exact;

  for (const line of String(message || '').split(/\r?\n/)) {
    if (ATTRIBUTION_TRAILER_RE.test(line)) return line.trim();
  }
  return null;
}

export function findCursorIdentityViolations(commit) {
  const violations = [];
  const fields = [
    ['author_name', commit.authorName, containsForbiddenIdentityName],
    ['author_email', commit.authorEmail, containsForbiddenIdentityEmail],
    ['committer_name', commit.committerName, containsForbiddenIdentityName],
    ['committer_email', commit.committerEmail, containsForbiddenIdentityEmail],
  ];

  for (const [field, value, predicate] of fields) {
    if (predicate(value)) {
      violations.push({ field, value: String(value) });
    }
  }

  return violations;
}

export function auditCommitMessage(message) {
  const trailer = findCursorTrailerLine(message);
  if (!trailer) return { status: 'PASS', violations: [] };
  return {
    status: 'FAIL',
    violations: [{ kind: 'trailer', field: 'message', value: trailer }],
  };
}

export function auditCommitIdentity(identity) {
  const violations = findCursorIdentityViolations(identity);
  if (violations.length === 0) return { status: 'PASS', violations: [] };
  return {
    status: 'FAIL',
    violations: violations.map((v) => ({ kind: 'identity', ...v })),
  };
}
