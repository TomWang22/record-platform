#!/usr/bin/env node
/**
 * commit-msg hook: reject forbidden Cursor assistant attribution trailers.
 */
import fs from 'node:fs';
import { findExactCursorCoauthorTrailerLine } from '../lib/no-cursor-attribution-policy.mjs';

const messageFile = process.argv[2];
if (!messageFile) {
  console.error('commit-msg: missing message file argument');
  process.exit(2);
}

const message = fs.readFileSync(messageFile, 'utf8');
const forbidden = findExactCursorCoauthorTrailerLine(message);

if (forbidden) {
  console.error(`commit-msg: forbidden attribution trailer rejected:\n${forbidden}`);
  process.exit(1);
}

process.exit(0);
