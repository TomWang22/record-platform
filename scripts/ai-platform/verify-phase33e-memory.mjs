#!/usr/bin/env node
import { verifyPhase33e } from '../lib/phase33e-verify.mjs';
const r = verifyPhase33e({ capabilityFilter: 'multi_turn_memory' });
process.stdout.write(JSON.stringify(r, null, 2) + '\n');
process.exit(r.status === 'PASS' ? 0 : 1);
