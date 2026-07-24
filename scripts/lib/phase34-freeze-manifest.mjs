/**
 * Freeze integrity helpers for Phase 34 evaluation roots.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function writeFreezeManifest(root, { status, extraFiles = [] } = {}) {
  const files = [];
  const candidates = [
    'real-model-full-eval.json',
    'real-model-canary.json',
    'eligibility-denominator-preview.json',
    'ledgers/sessions.jsonl',
    'ledgers/turns.jsonl',
    'ledgers/model-invocations.jsonl',
    'ledgers/failures.jsonl',
    'ledgers/claims.jsonl',
    'ledgers/protocol.jsonl',
    'run-state/checkpoint.json',
    'locks/writer-lock.json',
    ...extraFiles,
  ];
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    files.push({ path: rel, sha256: sha256File(abs), bytes: fs.statSync(abs).size });
  }
  const manifest = {
    schema_version: 'phase34-freeze-manifest-v1',
    status,
    generated_at: new Date().toISOString(),
    evidence_root: root,
    files,
  };
  const reportsDir = path.join(root, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const tmp = path.join(reportsDir, 'SHA256SUMS.json.tmp');
  const finalPath = path.join(reportsDir, 'SHA256SUMS.json');
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, finalPath);
  // Also classic SHA256SUMS text
  const lines = files.map((f) => `${f.sha256}  ${f.path}`).join('\n') + '\n';
  fs.writeFileSync(path.join(reportsDir, 'SHA256SUMS'), lines);
  return manifest;
}

/**
 * Summarize failures without double-counting session+failure rows as two sessions.
 */
export function summarizeFailureSessions(failureRows = []) {
  const bySession = new Map();
  for (const row of failureRows) {
    const sid = row.session_id || row.session?.session_id;
    if (!sid) continue;
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(row);
  }
  return {
    failed_session_count: bySession.size,
    failure_row_count: failureRows.length,
    sessions: [...bySession.entries()].map(([session_id, rows]) => ({
      session_id,
      rows: rows.length,
      reasons: [...new Set(rows.map((r) => r.reason).filter(Boolean))],
      violation_codes: [
        ...new Set(
          rows.flatMap((r) => (Array.isArray(r.violations) ? r.violations : [])).map((v) => v.code),
        ),
      ],
    })),
  };
}
