#!/usr/bin/env node
/**
 * pre-push hook: reject outgoing commits with forbidden Cursor attribution.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditCommitMessage,
  auditCommitIdentity,
} from '../lib/no-cursor-attribution-policy.mjs';
import { isForbiddenRetainedRef } from '../lib/retained-ref-policy.mjs';
import { auditAllRefs, auditGitHistory } from '../lib/no-cursor-trailer-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function git(args) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function parsePushLines(input) {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

function listOutgoingCommits(localRef, localSha, remoteSha) {
  const zero = '0000000000000000000000000000000000000000';
  if (remoteSha === zero) {
    const base = git(['merge-base', localSha, 'origin/main']);
    return git(['rev-list', '--reverse', `${base}..${localSha}`]).split('\n').filter(Boolean);
  }
  if (localSha === zero) {
    return [];
  }
  return git(['rev-list', '--reverse', `${remoteSha}..${localSha}`]).split('\n').filter(Boolean);
}

function auditOutgoingCommit(sha) {
  const raw = git(['log', '-1', sha, '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B']);
  const parts = raw.split('\x00');
  if (parts.length < 6) {
    throw new Error(`malformed commit record for ${sha}`);
  }
  const [, authorName, authorEmail, committerName, committerEmail, body] = parts;
  const identity = auditCommitIdentity({
    authorName,
    authorEmail,
    committerName,
    committerEmail,
  });
  const message = auditCommitMessage(body);
  const violations = [...identity.violations, ...message.violations];
  return violations.map((v) => ({ sha, ref: sha, ...v }));
}

function main() {
  const input = fs.readFileSync(0, 'utf8');
  const pushes = parsePushLines(input);
  const violations = [];

  for (const push of pushes) {
    if (push.localSha === '0000000000000000000000000000000000000000') {
      continue;
    }
    if (isForbiddenRetainedRef(push.localRef)) {
      violations.push({
        ref: push.localRef,
        kind: 'ref-policy',
        field: 'refname',
        value: push.localRef,
      });
    }
    for (const sha of listOutgoingCommits(push.localRef, push.localSha, push.remoteSha)) {
      violations.push(...auditOutgoingCommit(sha));
    }
  }

  if (pushTargetsMain(pushes)) {
    const mainReport = auditGitHistory({ ref: 'origin/main' });
    const allReport = auditAllRefs();
    if (mainReport.status !== 'PASS') {
      violations.push(...mainReport.violations.map((v) => ({ ...v, scope: 'origin/main' })));
    }
    if (allReport.status !== 'PASS') {
      violations.push(...allReport.violations.map((v) => ({ ...v, scope: '--all' })));
    }
    const workflowSyntax = spawnSync('make', ['git-verify-workflow-syntax'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (workflowSyntax.status !== 0) {
      violations.push({
        ref: 'origin/main',
        kind: 'workflow-syntax',
        field: 'actionlint',
        value: workflowSyntax.stderr || workflowSyntax.stdout || 'git-verify-workflow-syntax failed',
      });
    }
  }

  if (violations.length > 0) {
    console.error(JSON.stringify({ guard: 'pre-push', status: 'FAIL', violations }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ guard: 'pre-push', status: 'PASS' }));
}

function pushTargetsMain(pushes) {
  return pushes.some((push) => /refs\/heads\/main$/.test(push.localRef));
}

main();
