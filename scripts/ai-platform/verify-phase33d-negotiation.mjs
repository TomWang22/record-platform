#!/usr/bin/env node
import { verifyPhase33d } from '../lib/phase33d-verify.mjs';

const r = verifyPhase33d({ capabilityFilter: 'negotiation_assistance' });
process.stdout.write(JSON.stringify(r, null, 2) + '\n');
process.exit(r.status === 'PASS' ? 0 : 1);
