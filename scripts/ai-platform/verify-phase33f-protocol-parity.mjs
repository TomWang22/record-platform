#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [path.join(__dirname, 'evaluate-phase33f-protocol-parity.mjs')], {
  encoding: 'utf8',
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status === 0 ? 0 : 2);
