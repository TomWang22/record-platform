#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCapabilitySlice } from '../lib/phase33c-verify.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const report = validateCapabilitySlice(REPO_ROOT, 'scarcity');
console.error(`scarcity scenarios=${report.count} fail=${report.fail}`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.status === 'PASS' ? 0 : 2);
