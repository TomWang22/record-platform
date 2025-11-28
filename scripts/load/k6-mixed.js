import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// -------- env --------
const RAW_BASE = (__ENV.BASE_URL || 'http://nginx:8080').replace(/\/$/, '');
const HAS_API  = RAW_BASE.endsWith('/api');
const BASE     = RAW_BASE;
const TOKEN    = __ENV.TOKEN || '';
const MODE     = (__ENV.MODE || 'rate').toLowerCase(); // rate | sweep | (default fixed VUs)
const RATE     = Number(__ENV.RATE || 0);
const VUS      = Number(__ENV.VUS  || 20);
const DUR      = __ENV.DURATION || '30s';
const ACCEPT_429 = (__ENV.ACCEPT_429 || '1') === '1';
const SYNTH_IP   = (__ENV.SYNTH_IP   || '1') === '1';
const HOT_PCT    = Math.max(0, Math.min(1, Number(__ENV.HOT_PCT || 0.9)));   // hot id ratio for GET by id
const WRITE_PCT  = Math.max(0, Math.min(1, Number(__ENV.WRITE_PCT || 0.2))); // fraction of iters that do writes
const MAX_VUS        = Number(__ENV.MAX_VUS || 400);
const SWEEP_MAX_VUS  = Number(__ENV.SWEEP_MAX_VUS || 600);

// --- tunable SLOs (ms) ---
const W_P95 = Number(__ENV.WRITE_P95_MS || 120);
const W_P99 = Number(__ENV.WRITE_P99_MS || 300);
const GID_P95 = Number(__ENV.IDGET_P95_MS || 80);
const GID_P99 = Number(__ENV.IDGET_P99_MS || 180);

// optional sweep knobs
const STAGES_CSV = __ENV.STAGES || '';
const RATE_START = Number(__ENV.RATE_START || 60);
const RATE_STEP  = Number(__ENV.RATE_STEP  || 60);
const STEPS      = Number(__ENV.STEPS      || 5);
const STEP_DUR   = __ENV.STEP_DUR || '60s';

// treat 2xx–3xx, plus 404/409/429 as "expected"
http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 399 }, 404, 409, 429)
);

export const errors = new Rate('errors');

// thresholds - comprehensive latency metrics
const thresholds = {
  errors: ['rate<0.01'],
  'http_req_failed{expected_response:true}': ['rate<0.02'],

  // Write budgets - comprehensive percentiles
  [`http_req_duration{method:POST}`]:   [
    `p(50)<${W_P95 * 0.3}`, `p(95)<${W_P95}`, `p(99)<${W_P99}`,
    `p(99.9)<${W_P99 * 2}`, `p(99.99)<${W_P99 * 5}`, `p(99.999)<${W_P99 * 10}`,
    `p(99.9999)<${W_P99 * 20}`, `p(99.99999)<${W_P99 * 50}`, `p(100)<${W_P99 * 100}`
  ],
  [`http_req_duration{method:PUT}`]:    [
    `p(50)<${W_P95 * 0.3}`, `p(95)<${W_P95}`, `p(99)<${W_P99}`,
    `p(99.9)<${W_P99 * 2}`, `p(99.99)<${W_P99 * 5}`, `p(99.999)<${W_P99 * 10}`,
    `p(99.9999)<${W_P99 * 20}`, `p(99.99999)<${W_P99 * 50}`, `p(100)<${W_P99 * 100}`
  ],
  [`http_req_duration{method:DELETE}`]: [
    `p(50)<${W_P95 * 0.3}`, `p(95)<${W_P95}`, `p(99)<${W_P99}`,
    `p(99.9)<${W_P99 * 2}`, `p(99.99)<${W_P99 * 5}`, `p(99.999)<${W_P99 * 10}`,
    `p(99.9999)<${W_P99 * 20}`, `p(99.99999)<${W_P99 * 50}`, `p(100)<${W_P99 * 100}`
  ],

  // Read budgets - comprehensive percentiles
  'http_req_duration{name:GET /records}': [
    'p(50)<40', 'p(95)<80', 'p(99)<180',
    'p(99.9)<360', 'p(99.99)<900', 'p(99.999)<1800',
    'p(99.9999)<3600', 'p(99.99999)<9000', 'p(100)<18000'
  ],
  [`http_req_duration{name:GET /records/:id}`]: [
    `p(50)<${GID_P95 * 0.3}`, `p(95)<${GID_P95}`, `p(99)<${GID_P99}`,
    `p(99.9)<${GID_P99 * 2}`, `p(99.99)<${GID_P99 * 5}`, `p(99.999)<${GID_P99 * 10}`,
    `p(99.9999)<${GID_P99 * 20}`, `p(99.99999)<${GID_P99 * 50}`, `p(100)<${GID_P99 * 100}`
  ],

  // Global comprehensive percentiles
  'http_req_duration': [
    'p(50)<50', 'p(95)<100', 'p(99)<200',
    'p(99.9)<500', 'p(99.99)<1000', 'p(99.999)<2000',
    'p(99.9999)<5000', 'p(99.99999)<10000', 'p(100)<20000'
  ],
};

function buildOptions() {
  const systemTags = ['status','method','name','scenario','expected_response']; // keep cardinality low

  if (MODE === 'sweep') {
    let stages = [];
    if (STAGES_CSV) {
      const nums = STAGES_CSV.split(',').map(s => Number(s.trim())).filter(n => n > 0);
      stages = nums.map(n => ({ target: n, duration: STEP_DUR }));
    } else {
      for (let i = 0; i < STEPS; i++) stages.push({ target: RATE_START + i * RATE_STEP, duration: STEP_DUR });
    }
    return {
      scenarios: {
        sweep: {
          executor: 'ramping-arrival-rate',
          startRate: stages[0]?.target || 1,
          timeUnit: '1s',
          preAllocatedVUs: VUS,
          maxVUs: Math.max(VUS, SWEEP_MAX_VUS),
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
          rate: RATE || 120,
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

  return { vus: VUS, duration: DUR, thresholds, systemTags };
}
export const options = buildOptions();

const api = (p) => `${BASE}${HAS_API ? '' : '/api'}${p}`;

// ---- setup: build a pool of hot IDs
export function setup() {
  const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  const res = http.get(api('/records'), { headers });

  let ids = [];
  try {
    const j = res.json();
    const collect = (v) => {
      if (!v) return;
      if (Array.isArray(v)) { v.forEach(collect); return; }
      if (typeof v === 'object') {
        if (v.id) ids.push(v.id);
        for (const k in v) collect(v[k]);
      }
    };
    collect(j);
    ids = ids.slice(0, 200);
  } catch (_) {}
  return { ids };
}

function headers() {
  const ip = SYNTH_IP ? `10.1.${__VU}.${__ITER % 250}` : '';
  const h = { 'Content-Type': 'application/json' };
  if ((__ENV.NO_LIMIT === '1') || BASE.includes(':8082')) h['X-Loadtest'] = '1';
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  if (ip) h['X-Forwarded-For'] = ip;
  return h;
}

export default function (data) {
  const H = headers();

  // GET /records
  let r = http.get(api('/records'), { headers: H, tags: { name: 'GET /records' } });
  let ok = r.status === 200 || (ACCEPT_429 && r.status === 429);
  errors.add(!ok); check(r, { 'list ok(200|429)': () => ok });

  // GET /records/:id (hot most of the time)
  const hasPool = data && Array.isArray(data.ids) && data.ids.length > 0;
  const useHot  = hasPool && Math.random() < HOT_PCT;
  const byId    = useHot ? data.ids[(Math.random() * data.ids.length) | 0] : uuidv4();

  r = http.get(api(`/records/${byId}`), { headers: H, tags: { name: 'GET /records/:id', hot: useHot ? '1' : '0' } });
  ok = [200, 404].includes(r.status) || (ACCEPT_429 && r.status === 429);
  errors.add(!ok); check(r, { 'byId ok(200|404|429)': () => ok });

  // Writes only on a fraction of iterations
  if (Math.random() < WRITE_PCT) {
    // create
    let rid = null;
    r = http.post(
      api('/records'),
      JSON.stringify({ artist: 'k6', name: `rec-${__VU}-${Date.now()}`, format: 'LP' }),
      { headers: H, tags: { name: 'POST /records' } }
    );
    ok = [200, 201].includes(r.status) || (ACCEPT_429 && r.status === 429);
    errors.add(!ok); check(r, { 'post ok(201|200|429)': () => ok });
    try { rid = r.json()?.id || null; } catch {}

    // update
    const putId = rid || uuidv4();
    r = http.put(
      api(`/records/${putId}`),
      JSON.stringify({ notes: `updated ${Date.now()}` }),
      { headers: H, tags: { name: 'PUT /records/:id' } }
    );
    ok = [200, 201, 204, 409].includes(r.status)
         || (!rid && r.status === 404)
         || (ACCEPT_429 && r.status === 429);
    errors.add(!ok); check(r, { 'put ok(2xx|409|404|429)': () => ok });

    // delete
    r = http.del(
      api(`/records/${putId}`),
      null,
      { headers: H, tags: { name: 'DEL /records/:id' } }
    );
    ok = [200, 204, 404].includes(r.status) || (ACCEPT_429 && r.status === 429);
    errors.add(!ok); check(r, { 'del ok(2xx|404|429)': () => ok });
  }

  if (!RATE && MODE !== 'sweep') sleep(0.5);
}

// Comprehensive latency summary handler
export function handleSummary(data) {
  // Extract all latency percentiles
  const extractPercentiles = (metric) => {
    if (!metric || !metric.values) return {};
    return {
      p50: metric.values['p(50)'] || null,
      p95: metric.values['p(95)'] || null,
      p99: metric.values['p(99)'] || null,
      p999: metric.values['p(99.9)'] || null,
      p9999: metric.values['p(99.99)'] || null,
      p99999: metric.values['p(99.999)'] || null,
      p999999: metric.values['p(99.9999)'] || null,
      p9999999: metric.values['p(99.99999)'] || null,
      p100: metric.values['p(100)'] || metric.values.max || null,
      avg: metric.values.avg || null,
      min: metric.values.min || null,
      max: metric.values.max || null,
    };
  };

  const latencyReport = {
    timestamp: new Date().toISOString(),
    summary: {
      total_requests: data.metrics.http_reqs?.values.count || 0,
      total_duration: data.metrics.http_req_duration?.values.avg || 0,
      error_rate: data.metrics.errors?.values.rate || 0,
    },
    latency_metrics: {},
  };

  // Process all http_req_duration metrics
  for (const [key, metric] of Object.entries(data.metrics)) {
    if (key.startsWith('http_req_duration')) {
      latencyReport.latency_metrics[key] = extractPercentiles(metric);
    }
  }

  // Output to console and file
  console.log('\n=== Comprehensive Latency Metrics ===');
  for (const [key, metrics] of Object.entries(latencyReport.latency_metrics)) {
    console.log(`\n${key}:`);
    console.log(`  p50:      ${metrics.p50?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p95:      ${metrics.p95?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p99:      ${metrics.p99?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p999:     ${metrics.p999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p9999:    ${metrics.p9999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p99999:   ${metrics.p99999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p999999:  ${metrics.p999999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p9999999: ${metrics.p9999999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p100:     ${metrics.p100?.toFixed(2) || 'N/A'} ms`);
    console.log(`  avg:      ${metrics.avg?.toFixed(2) || 'N/A'} ms`);
  }

  return {
    'stdout': JSON.stringify(latencyReport, null, 2),
    'k6-latency-report.json': JSON.stringify(latencyReport, null, 2),
  };
}
