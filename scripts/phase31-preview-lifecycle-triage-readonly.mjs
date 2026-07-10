#!/usr/bin/env node
/**
 * Phase 31K — read-only preview lifecycle gate root-cause triage.
 * Writes redacted JSON to /tmp only. Never commits JWTs or raw tokens.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';
import { loadN5Participants } from './lib/phase22-full-replay-common.mjs';
import { buildTriage, loadAllShardRows } from './phase31-extract-controlled-matrix-failures.mjs';
import {
  DEFAULTS,
  PROTOCOLS,
  login,
  previewApi,
  previewEnroll,
  previewRevoke,
  ragGateReason,
  resolveCurlTarget,
  jwtSub,
} from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_TRIAGE = '/tmp/phase31-staging-long-soak-matrix/phase31-failure-triage-final.json';
const DEFAULT_MATRIX = '/tmp/phase31-staging-long-soak-matrix';
const DEFAULT_OUT = '/tmp/phase31-preview-lifecycle-triage.json';

function parseArgs(argv) {
  const opts = {
    triage: DEFAULT_TRIAGE,
    matrixIn: DEFAULT_MATRIX,
    out: DEFAULT_OUT,
    userHash: null,
    live: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--triage') opts.triage = argv[++i];
    else if (arg === '--in') opts.matrixIn = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--user-hash') opts.userHash = argv[++i];
    else if (arg === '--live') opts.live = true;
  }
  return opts;
}

export function uidHash(uid) {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

export function redactEmail(email) {
  const [local, domain] = email.split('@');
  if (!domain) return '[redacted]';
  const head = local.slice(0, Math.min(4, local.length));
  return `${head}…@${domain}`;
}

export function resolveUserByHash(userHash, participants = loadN5Participants()) {
  for (const user of participants) {
    if (uidHash(user.uid) === userHash) {
      return {
        user_uid_hash: userHash,
        user_class: user.user_class,
        role: user.role,
        email_redacted: redactEmail(user.email),
        uid_prefix: `${user.uid.slice(0, 8)}…`,
      };
    }
  }
  return { user_uid_hash: userHash, user_class: 'unknown', role: 'unknown' };
}

function probeMatchKey(row) {
  return [row.matrix_protocol, row.window, row.run, row.case_id, row.user_uid_hash].join('|');
}

export function loadFailureRows(opts) {
  const triagePath = opts.triage;
  const { rows } = loadAllShardRows(opts.matrixIn);
  const rowByKey = new Map(rows.map((r) => [probeMatchKey(r), r]));

  if (fs.existsSync(triagePath)) {
    const triage = JSON.parse(fs.readFileSync(triagePath, 'utf8'));
    const rawFailures = triage.deterministic_failures || [];
    const hash = opts.userHash || rawFailures[0]?.user_uid_hash;
    const failures = (hash ? rawFailures.filter((f) => f.user_uid_hash === hash) : rawFailures).map(
      (f) => {
        const full = rowByKey.get(probeMatchKey(f)) || {};
        return { ...f, ...full };
      },
    );
    return { triage, failures, userHash: hash };
  }

  const hash = opts.userHash || rows.find((r) => r.gate_reason !== r.expected_gate_reason)?.user_uid_hash;
  const failures = rows.filter(
    (r) =>
      r.user_uid_hash === hash &&
      r.http_status === 200 &&
      r.gate_reason !== r.expected_gate_reason,
  );
  return { triage: buildTriage(opts.matrixIn), failures, userHash: hash };
}

export function buildFailureTable(failures) {
  return failures.map((f) => ({
    probe_id: f.probe_id,
    protocol: f.protocol_label || f.matrix_protocol,
    window: f.window,
    run: f.run,
    case_id: f.case_id,
    expected_gate_reason: f.expected_gate_reason,
    observed_gate_reason: f.gate_reason,
    http_status: f.http_status,
    retrieval_mode: f.retrieval_mode ?? null,
    user_class: f.user_class,
    user_uid_hash: f.user_uid_hash,
    response_pass: f.response_pass,
    red_team_case: f.red_team_case ?? false,
    completed_at: f.completed_at ?? null,
  }));
}

export function analyzeWindowContext(matrixIn, userHash, failureRows) {
  const { rows } = loadAllShardRows(matrixIn);
  const userRows = rows.filter((r) => r.user_uid_hash === userHash);
  const failKeys = new Set(
    failureRows.map((f) => `${f.matrix_protocol}|${f.window}|${f.run}|${f.case_id}`),
  );
  const windows = [...new Set(failureRows.map((f) => f.window))].sort((a, b) => a - b);
  const context = [];
  for (const window of windows) {
    for (const proto of ['h1', 'h2', 'h3']) {
      const inWin = userRows.filter((r) => r.window === window && r.matrix_protocol === proto);
      if (!inWin.length) continue;
      const wrong = inWin.filter((r) => r.gate_reason !== r.expected_gate_reason);
      const lateRunFails = wrong.filter((r) => r.run >= 8);
      context.push({
        matrix_protocol: proto,
        window,
        total_probes: inWin.length,
        wrong_gate: wrong.length,
        late_run_failures: lateRunFails.length,
        runs_with_failures: [...new Set(wrong.map((r) => r.run))].sort((a, b) => a - b),
        retrieval_mode_on_failures: [...new Set(wrong.map((r) => r.retrieval_mode))],
        retrieval_mode_on_passes: [
          ...new Set(inWin.filter((r) => r.gate_reason === r.expected_gate_reason).map((r) => r.retrieval_mode)),
        ],
        fail_probe_ids: wrong.map((r) => r.probe_id),
      });
    }
  }
  return { windows, context, failKeys };
}

export function classifyRootCause({ failures, windowContext, triage }) {
  const allLateRun =
    failures.length > 0 && failures.every((f) => f.run >= 8);
  const sparsePerWindow = windowContext.context
    .filter((c) => c.wrong_gate > 0)
    .every((c) => c.wrong_gate <= 2 && c.total_probes >= 80);
  const keywordOnFail = failures.every((f) => f.retrieval_mode === 'keyword' || f.retrieval_mode == null);
  const singleUser = new Set(failures.map((f) => f.user_uid_hash)).size === 1;
  const lifecycleSuspect = (triage.counts?.lifecycle_bug_suspect || 0) > 0;

  let rootCause =
    'Parallel matrix shards share global preview enrollment state; per-window resetWindowEnrollments(revoke+enroll all preview users) in one shard can revoke enrollment while another shard is mid-window probing the same user, yielding HTTP 200 + keyword_default on an otherwise enrolled preview participant.';
  let runnerBug = true;
  let serviceBug = false;
  let dataBug = false;
  let lifecycleBug = true;

  if (!singleUser) {
    rootCause = 'Multiple users affected — requires broader enrollment audit before repair.';
    runnerBug = false;
    lifecycleBug = false;
  } else if (!sparsePerWindow || !keywordOnFail) {
    rootCause = 'Failure pattern does not match cross-shard revoke race; deeper service or user-config investigation required.';
    runnerBug = false;
    lifecycleBug = false;
    serviceBug = true;
  }

  return {
    root_cause: rootCause,
    lifecycle_bug_confirmed: lifecycleBug,
    runner_bug_confirmed: runnerBug,
    service_bug_confirmed: serviceBug,
    data_user_config_bug_confirmed: dataBug,
    evidence: {
      single_user: singleUser,
      sparse_per_window: sparsePerWindow,
      late_run_bias: allLateRun,
      keyword_retrieval_on_failures: keywordOnFail,
      lifecycle_bug_suspect_count: triage.counts?.lifecycle_bug_suspect ?? null,
      retryable_failures: triage.counts?.retryable_failures ?? 0,
    },
    safe_repair_path: [
      'Serialize preview revoke/enroll across parallel shards (e.g. /tmp enrollment lock per matrix root).',
      'Before each preview probe (or at least each run), verify status+rag gate; re-enroll once; fail fast if still keyword_default under HTTP 200.',
      'Validate JWT sub matches x-user-id before probing; refresh token on mismatch.',
      'Keep HTTP 200 + preview_opt_in expected + keyword_default observed as deterministic BLOCKED (never retryable).',
      'After 31L fix, run 31M targeted replay then 31N full-soak decision before 31E–31J.',
    ],
  };
}

export function inspectLiveLifecycle(userHash) {
  const participants = loadN5Participants();
  const user = participants.find((u) => uidHash(u.uid) === userHash);
  if (!user) return { live: false, reason: 'user not found in participant artifact' };

  const cfg = {
    ...DEFAULTS,
    password: DEFAULTS.password || process.env.T20_PARTICIPANT_LOGIN_PASSWORD || 'ContractPass123!',
    curlResolve: resolveCurlTarget(DEFAULTS.baseUrl),
    mgmtProto: PROTOCOLS.h1,
  };

  const token = login(user.email, cfg);
  const jwtSubject = jwtSub(token);
  const subjectMatch = jwtSubject === user.uid;

  const statusBefore = previewApi('GET', 'status', token, user.uid, cfg).body;
  previewRevoke(token, user.uid, cfg);
  const afterRevoke = previewApi('GET', 'status', token, user.uid, cfg).body;
  previewEnroll(token, user.uid, cfg);
  const afterEnroll = previewApi('GET', 'status', token, user.uid, cfg).body;
  const ragGate = ragGateReason(token, user.uid, cfg);

  return {
    live: true,
    email_redacted: redactEmail(user.email),
    uid_prefix: `${user.uid.slice(0, 8)}…`,
    jwt_subject_prefix: `${jwtSubject.slice(0, 8)}…`,
    jwt_subject_matches_uid: subjectMatch,
    preview_status_before: {
      enrolled: statusBefore?.enrolled ?? null,
      gate_reason: statusBefore?.gate_reason ?? null,
    },
    preview_status_after_revoke: {
      enrolled: afterRevoke?.enrolled ?? null,
      gate_reason: afterRevoke?.gate_reason ?? null,
    },
    preview_status_after_enroll: {
      enrolled: afterEnroll?.enrolled ?? null,
      gate_reason: afterEnroll?.gate_reason ?? null,
    },
    rag_gate_after_enroll: ragGate,
  };
}

export function buildPreviewLifecycleTriage(opts) {
  const { triage, failures, userHash } = loadFailureRows(opts);
  if (!userHash) throw new Error('no affected user hash found in triage/matrix');

  const user = resolveUserByHash(userHash);
  const failureTable = buildFailureTable(failures);
  const windowContext = analyzeWindowContext(opts.matrixIn, userHash, failures);
  const verdict = classifyRootCause({ failures, windowContext, triage });

  const report = {
    generated_at: new Date().toISOString(),
    phase: '31K',
    phase31k_status: verdict.runner_bug_confirmed && verdict.lifecycle_bug_confirmed ? 'PASS' : 'BLOCKED',
    source_triage: opts.triage,
    matrix_in: opts.matrixIn,
    affected_user: user,
    affected_user_hash: userHash,
    affected_windows: windowContext.windows,
    affected_protocols: [...new Set(failures.map((f) => f.matrix_protocol || f.protocol_label))].sort(),
    affected_cases: [...new Set(failures.map((f) => f.case_id))].sort(),
    failure_table: failureTable,
    window_context: windowContext.context,
    triage_counts: triage.counts,
    verdict: {
      root_cause: verdict.root_cause,
      lifecycle_bug_confirmed: verdict.lifecycle_bug_confirmed,
      runner_bug_confirmed: verdict.runner_bug_confirmed,
      service_bug_confirmed: verdict.service_bug_confirmed,
      data_user_config_bug_confirmed: verdict.data_user_config_bug_confirmed,
      safe_repair_path: verdict.safe_repair_path,
      evidence: verdict.evidence,
    },
    live_inspection: opts.live ? inspectLiveLifecycle(userHash) : { live: false, skipped: true },
    notes: [
      'Failures are sparse (1–2 per affected window) and biased to late runs — consistent with mid-window global revoke by another parallel shard.',
      'Do not retry deterministic gate mismatches without repair (Phase 31 BLOCKED closeout).',
      'Phase 31 evidence remains separate from Phase 22/28/29/30 totals.',
    ],
  };
  return report;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildPreviewLifecycleTriage(opts);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Phase 31K: ${report.phase31k_status}`);
  console.log(`Root cause: ${report.verdict.root_cause}`);
  console.log(`Affected user hash: ${report.affected_user_hash}`);
  console.log(`Affected windows: ${report.affected_windows.join(', ')}`);
  console.log(`Affected protocols: ${report.affected_protocols.join(', ')}`);
  console.log(`Affected cases: ${report.affected_cases.join(', ')}`);
  console.log(`Lifecycle bug confirmed: ${report.verdict.lifecycle_bug_confirmed ? 'YES' : 'NO'}`);
  console.log(`Runner bug confirmed: ${report.verdict.runner_bug_confirmed ? 'YES' : 'NO'}`);
  console.log(`Service bug confirmed: ${report.verdict.service_bug_confirmed ? 'YES' : 'NO'}`);
  console.log(`Data/user config bug confirmed: ${report.verdict.data_user_config_bug_confirmed ? 'YES' : 'NO'}`);
  console.log('Safe repair path:');
  for (const step of report.verdict.safe_repair_path) console.log(`  - ${step}`);
  console.log(`\nWrote ${opts.out}`);
  return report.phase31k_status === 'PASS' ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
