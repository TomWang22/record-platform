#!/usr/bin/env node
/**
 * Canary gate — refuses to launch when readiness is BLOCKED.
 * Does not create canary root on BLOCKED.
 */
import fs from 'node:fs';
import { evaluatePhase33fReadiness } from '../lib/phase33f-readiness.mjs';

const CANARY = '/tmp/phase33f-capability-gauntlet-canary-v1';
const readiness = evaluatePhase33fReadiness({ createCanaryRootIfReady: false });

if (readiness.status !== 'READY') {
  const existedBefore = fs.existsSync(CANARY);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'BLOCKED',
        banner: 'PHASE 33F BLOCKED — OFFLINE CAPABILITY QUALITY GATE',
        canary_launched: false,
        canary_root_exists: existedBefore,
        failing_policy_metrics: readiness.failing_policy_metrics,
        remediation: [
          'Raise semantic_fixture Recall@5 to >= 0.35 (retrieval-acceptance-policy development floor)',
          'Re-run readiness after retrieval remediation',
          'Do not create canary root while BLOCKED',
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.exit(3);
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'READY_NOT_LAUNCHED',
      banner: 'PHASE 33F CANARY READY — NOT LAUNCHED',
      canary_launched: false,
      note: 'Live 720-probe execution is a separate explicit step after READY; not auto-started here.',
    },
    null,
    2,
  )}\n`,
);
process.exit(0);
