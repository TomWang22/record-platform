import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate } from 'k6/metrics';

// -------- env --------
const RAW_BASE = (__ENV.BASE_URL || 'http://nginx:8080').replace(/\/$/, '');
const HAS_API  = RAW_BASE.endsWith('/api');
const BASE     = RAW_BASE;
const TOKEN    = __ENV.TOKEN || '';
const MODE     = (__ENV.MODE || 'rate').toLowerCase(); // rate | sweep | soak
const RATE     = Number(__ENV.RATE || 0);
const VUS      = Number(__ENV.VUS || 50);
const DUR      = __ENV.DURATION || '30s';
const ACCEPT_429 = (__ENV.ACCEPT_429 || '1') === '1';
const SYNTH_IP   = (__ENV.SYNTH_IP   || '1') === '1';
const MAX_VUS    = Number(__ENV.MAX_VUS || 200);

// optional sweep env: STAGES="100,200,300,400" or RATE_START/RATE_STEP/STEPS/STEP_DUR
const STAGES_CSV = __ENV.STAGES || '';          // e.g. "100,200,300,400"
const RATE_START = Number(__ENV.RATE_START || 100);
const RATE_STEP  = Number(__ENV.RATE_STEP  || 100);
const STEPS      = Number(__ENV.STEPS      || 5);
const STEP_DUR   = __ENV.STEP_DUR || '60s';

export const errors = new Rate('errors');

http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 399 }, 404, 409, 429)
);

// -------- thresholds (reads are strict) --------
const thresholds = {
  errors: ['rate<0.01'],
  'http_req_duration{method:GET}': ['p(95)<50','p(99)<120'],
  http_req_failed: ['rate<0.005'],
};

// -------- options builder --------
function buildOptions() {
  const systemTags = ['status','method','name','scenario','expected_response'];

  if (MODE === 'sweep') {
    let stages = [];
    if (STAGES_CSV) {
      const nums = STAGES_CSV.split(',').map(s => Number(s.trim())).filter(n => n > 0);
      stages = nums.map(n => ({ target: n, duration: STEP_DUR }));
    } else {
      for (let i = 0; i < STEPS; i++) {
        stages.push({ target: RATE_START + i * RATE_STEP, duration: STEP_DUR });
      }
    }
    return {
      scenarios: {
        sweep: {
          executor: 'ramping-arrival-rate',
          startRate: stages[0]?.target || 1,
          timeUnit: '1s',
          preAllocatedVUs: VUS,
          maxVUs: Math.max(VUS, MAX_VUS),
          stages,
        },
      },
      thresholds,
      systemTags,
    };
  }

  if (MODE === 'rate' || RATE > 0) {
    return {
      scenarios: {
        rate: {
          executor: 'constant-arrival-rate',
          rate: RATE || 300,
          timeUnit: '1s',
          duration: DUR,
          preAllocatedVUs: VUS,
          maxVUs: Math.max(VUS, MAX_VUS),
        },
      },
      thresholds,
      systemTags,
    };
  }

  // default “simple” or soak style (no rate provided -> VU/duration)
  return { vus: VUS, duration: DUR, thresholds, systemTags };
}
export const options = buildOptions();

// -------- helpers --------
const api = (p) => `${BASE}${HAS_API ? '' : '/api'}${p}`;

function makeHeaders() {
  const ip = SYNTH_IP ? `10.0.${__VU}.${__ITER % 250}` : '';
  const h = {};
  if ((__ENV.NO_LIMIT === '1') || BASE.includes(':8082')) h['X-Loadtest'] = '1';
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  if (ip) h['X-Forwarded-For'] = ip;
  return h;
}

// -------- test loop --------
export default function () {
  const headers = makeHeaders();
  const res = http.get(api('/records'), { headers, tags: { name: 'GET /records' } });
  const ok = res.status === 200 || (ACCEPT_429 && res.status === 429);
  errors.add(!ok);
  check(res, { 'ok(200|429)': () => ok });

  if (!RATE && MODE !== 'sweep') sleep(0.5);
}
