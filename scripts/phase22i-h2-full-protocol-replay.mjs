#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(__dirname, 'phase22-full-protocol-replay-runner.mjs');
const args = ['--protocol', 'h2', ...process.argv.slice(2)];
const result = spawnSync(process.execPath, [runner, ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
