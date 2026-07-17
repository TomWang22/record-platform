/**
 * Re-export schedule tests + ensure config single-declaration contract.
 * Primary harness coverage lives in phase34-product-harness.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildInterleavedProductSchedule,
  validateProductSchedule,
  MAX_SPLIT_RUN,
} from '../scripts/lib/phase34-product-schedule.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('schedule config exports MAX_SPLIT_RUN once and schedule imports it', () => {
  const cfg = fs.readFileSync(path.join(root, 'scripts/lib/phase34-product-schedule-config.mjs'), 'utf8');
  const sched = fs.readFileSync(path.join(root, 'scripts/lib/phase34-product-schedule.mjs'), 'utf8');
  assert.equal([...cfg.matchAll(/export const MAX_SPLIT_RUN\s*=/g)].length, 1);
  assert.equal([...sched.matchAll(/export const MAX_SPLIT_RUN\s*=/g)].length, 0);
  assert.match(sched, /MAX_SPLIT_RUN/);
  assert.equal(MAX_SPLIT_RUN, 16);
});

test('canary + full schedules validate', () => {
  const canary = buildInterleavedProductSchedule({ scale: 'canary', seed: 'phase34-product-canary-v1' });
  const full = buildInterleavedProductSchedule({ scale: 'full', seed: 'phase34-product-gauntlet-v1' });
  assert.equal(validateProductSchedule(canary).status, 'PASS');
  assert.equal(validateProductSchedule(full).status, 'PASS');
});
