import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_ARTIFACT_SHA,
  CLOSEOUT_DOC,
  KPI_CHANNELS,
  KPI_FLAG_DEFAULTS,
  validatePhase26gObservabilityDisableSwitch,
  assertNoBannedPatternsInPhase26gScripts,
  readFile,
  Phase26gObservabilityDisableSwitchGuardError,
} from '../scripts/lib/phase26g-observability-disable-switch-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase26g observability disable-switch guard', () => {
  it('validates full Phase 26G disable-switch closeout batch', () => {
    const result = validatePhase26gObservabilityDisableSwitch(repoRoot, { runPythonDrill: false });
    assert.equal(result.status, 'PASS');
    assert.equal(result.channels_checked, KPI_CHANNELS.length);
  });

  it('closeout claims disable-switch and Phase 26 closed posture', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.match(closeout, /Phase 26:\s*CLOSED PASS/i);
    assert.match(closeout, /Phase 26G:.*PASS/i);
    assert.match(closeout, /Disable switch verified:.*PASS/i);
    assert.match(closeout, /KPI write paths default enabled:.*NO/i);
    assert.match(closeout, /Runtime writes enabled by default:.*NO/i);
    assert.match(closeout, /Bench logs committed:.*NO/i);
  });

  it('config defaults keep all KPI channels off with master disable on', () => {
    const configPy = readFile(repoRoot, 'services/python-ai-service/app/ai/config.py');
    for (const flag of KPI_FLAG_DEFAULTS) {
      assert.ok(
        configPy.includes(`${flag.name}", "${flag.default}"`),
        `missing default ${flag.name}=${flag.default}`,
      );
    }
  });

  it('phase26g scripts exclude banned live/network/write patterns', () => {
    assert.doesNotThrow(() => assertNoBannedPatternsInPhase26gScripts(repoRoot));
  });

  it('artifact SHA unchanged in closeout', () => {
    const closeout = readFile(repoRoot, CLOSEOUT_DOC);
    assert.ok(closeout.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('Phase26gObservabilityDisableSwitchGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase26gObservabilityDisableSwitchGuardError('test');
      },
      (err) => err.name === 'Phase26gObservabilityDisableSwitchGuardError',
    );
  });
});
