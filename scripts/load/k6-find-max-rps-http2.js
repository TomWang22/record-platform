/**
 * Single-step HTTP/2 load at fixed RPS. Used by run-k6-max-rps-no-errors.sh to find max RPS with zero errors.
 * Exit 0 only when http_req_failed == 0 (so runner stops when this exits non-zero).
 * Env: RATE (req/s), DURATION (e.g. 20s), BASE_URL, VUS (default 20).
 */
import http from 'k6/http';
import { check } from 'k6';

const BASE = (__ENV.BASE_URL || 'https://record.local:30443').replace(/\/$/, '');
const RATE = Number(__ENV.RATE || 50);
const DURATION = __ENV.DURATION || '20s';
const VUS = Number(__ENV.VUS || 20);
const URL = `${BASE}/api/records`;

export const options = {
  scenarios: {
    h2_only: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: VUS,
      maxVUs: Math.max(VUS, 100),
      exec: 'run',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)'],
};

export function run() {
  const res = http.get(URL, { tags: { name: 'GET /records' } });
  const ok = res.status >= 200 && res.status < 400;
  check(res, { 'status ok': () => ok });
  return ok;
}

export default function () {
  run();
}
