#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePhase33cPackage } from '../lib/phase33c-verify.mjs';
import { validateCapabilitySlice } from '../lib/phase33c-verify.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = validatePhase33cPackage(REPO_ROOT);
const slices = ['scarcity', 'valuation', 'auction_intelligence'].map((c) =>
  validateCapabilitySlice(REPO_ROOT, c),
);
const status =
  pkg.status === 'PASS' && slices.every((s) => s.status === 'PASS') ? 'PASS' : 'FAIL';
for (const d of pkg.diagnostics || []) console.error(d);
const report = { status, package: pkg, slices };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(status === 'PASS' ? 0 : 2);
