import http from 'k6/http';
import { check, sleep } from 'k6';

// ===== base URLs (robust to /api or not) =====
const RAW_BASE  = __ENV.BASE_URL || 'http://api-gateway:4000'; // default in compose
const API_BASE  = RAW_BASE.replace(/\/$/, '');                  // canonical base for API calls

const u = new URL(API_BASE);
const ORIGIN = `${u.protocol}//${u.host}`;                      // scheme://host:port
const HAS_API_PREFIX = (u.pathname || '').startsWith('/api');

// helper to build API URLs
function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  // If API_BASE already includes a path (e.g. /api), just append.
  return `${API_BASE}${p}`;
}

// ===== env =====
const EMAIL     = __ENV.EMAIL      || 't@t.t';
const PASS      = __ENV.PASS       || 'p@ssw0rd';
const MODE      = ( __ENV.MODE     || 'mixed').toLowerCase();
const RATE      = Number(__ENV.RATE || 50);
const DURATION  = __ENV.DURATION   || '5m';
const VUS       = Number(__ENV.VUS || 20);
const MAX_VUS   = Number(__ENV.MAX_VUS || 200);
const DEBUG     = __ENV.DEBUG === '1';
const WRITE_PCT = Number(__ENV.WRITE_PCT || 35);     // % iterations that do writes
const BASE_BACKOFF_MS = Number(__ENV.BACKOFF_MS || 200);

// ===== tiny helpers =====
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function dbg(label, res) {
  if (DEBUG && res) {
    const ct = (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || '';
    const body = String(res.body || '').slice(0, 300).replace(/\n/g, ' ');
    console.log(`${label} :: status=${res.status} ct=${ct} body=${body}`);
  }
}
function safeJson(res) { try { return res.json(); } catch (_) { return null; } }
function shouldBackoff(res) { return res && (res.status === 429 || (res.status >= 500 && res.status < 600)); }
function retryAfterSeconds(res) {
  const ra = res && (res.headers?.['Retry-After'] || res.headers?.['retry-after']);
  if (!ra) return 0;
  const n = Number(ra);
  if (!Number.isNaN(n)) return n; // seconds
  return 1;
}
function backoffOnce(res, attempt) {
  const jitter = Math.random() * 0.2; // 0–200ms jitter when base is 1s
  const ra = retryAfterSeconds(res);
  const delayMs = ra ? ra * 1000 : Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), 4000);
  sleep((delayMs / 1000) + jitter);
}

// ===== options builder =====
function buildOptions(mode) {
  const thresholds = {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{method:GET}':    ['p(95)<300'],
    'http_req_duration{method:POST}':   ['p(95)<500'],
    'http_req_duration{method:PUT}':    ['p(95)<600'],
    'http_req_duration{method:DELETE}': ['p(95)<500'],
    checks: ['rate>0.98'],
  };

  const baseCAR = (execName, rate, duration) => ({
    executor: 'constant-arrival-rate',
    rate, timeUnit: '1s', duration,
    preAllocatedVUs: VUS, maxVUs: MAX_VUS,
    exec: execName,
  });

  if (mode === 'mixed') return { scenarios: { mixed: baseCAR('runMixed', RATE, DURATION) }, thresholds };
  if (mode === 'get')   return { scenarios: { getonly: baseCAR('runReadMostly', RATE, DURATION) }, thresholds };
  if (mode === 'soak')  return { scenarios: { soak: baseCAR('runMixed', RATE, DURATION) }, thresholds };

  if (mode === 'spike') {
    return {
      scenarios: {
        warmup: { ...baseCAR('runReadMostly', Math.max(1, Math.floor(RATE/10)), '10s') },
        spike:  {
          executor: 'constant-arrival-rate',
          rate: Math.max(200, RATE * 10),
          timeUnit: '1s', duration: '30s', startTime: '10s',
          preAllocatedVUs: Math.max(VUS, 50), maxVUs: Math.max(MAX_VUS, 500),
          exec: 'runMixed',
        },
        settle: { ...baseCAR('runMixed', RATE, '5m'), startTime: '40s' },
      },
      thresholds,
    };
  }

  if (mode === 'stress') {
    return {
      scenarios: {
        stress: {
          executor: 'ramping-arrival-rate',
          startRate: Math.max(1, Math.floor(RATE/5)),
          timeUnit: '1s',
          preAllocatedVUs: VUS, maxVUs: Math.max(MAX_VUS, 600),
          stages: [
            { target: 50,  duration: '3m' },
            { target: 100, duration: '3m' },
            { target: 200, duration: '3m' },
            { target: 400, duration: '3m' },
            { target: 50,  duration: '3m' },
          ],
          exec: 'runMixed',
        },
      },
      thresholds,
    };
  }

  // default “full” suite
  return {
    scenarios: {
      warmup:   { ...baseCAR('runReadMostly', 10, '10s') },
      spike:    {
        executor: 'constant-arrival-rate',
        rate: 500, timeUnit: '1s', duration: '30s', startTime: '10s',
        preAllocatedVUs: Math.max(VUS, 80), maxVUs: Math.max(MAX_VUS, 800),
        exec: 'runMixed',
      },
      baseline: { ...baseCAR('runMixed', 50, '5m'), startTime: '40s' },
      stress:   {
        executor: 'ramping-arrival-rate',
        startTime: '5m40s',
        startRate: 50, timeUnit: '1s',
        preAllocatedVUs: Math.max(VUS, 60), maxVUs: Math.max(MAX_VUS, 600),
        stages: [
          { target: 100, duration: '3m' },
          { target: 200, duration: '3m' },
          { target: 400, duration: '3m' },
          { target: 50,  duration: '3m' },
        ],
        exec: 'runMixed',
      },
      soak:     { ...baseCAR('runMixed', 40, '10m'), startTime: '18m20s' },
    },
    thresholds,
  };
}
export const options = buildOptions(MODE);

// ===== test logic =====
let token;
const myIds = new Map(); // per-VU created IDs

function loginWithRetry() {
  const payload = JSON.stringify({ email: EMAIL, password: PASS });

  // Prefer /api/auth/login if BASE_URL includes /api; fallback to origin (/auth/login)
  const candidates = HAS_API_PREFIX
    ? [ apiUrl('/auth/login'), `${ORIGIN}/auth/login` ]
    : [ `${ORIGIN}/auth/login`, apiUrl('/auth/login') ];

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const url of candidates) {
      const res = http.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
      dbg(`LOGIN ${url}`, res);

      if (res.status === 0) {
        // network or DNS failure
        backoffOnce(res, attempt);
        continue;
      }

      const ok = res.status >= 200 && res.status < 300;
      if (ok) {
        const body = safeJson(res) || {};
        const t = body.token || body.accessToken || body.jwt || body?.data?.token || '';
        if (t) return t;
        throw new Error('Login succeeded but no token in response');
      }

      if (res.status === 404) {
        // try the next candidate in this attempt
        continue;
      }
      if (shouldBackoff(res)) { backoffOnce(res, attempt); continue; }
      throw new Error(`Login failed: url=${url} status=${res.status} body=${String(res.body || '').slice(0, 200)}`);
    }
  }
  throw new Error('Login failed after retries (DNS/connection/429/5xx or both candidates 404).');
}

export function setup() {
  token = loginWithRetry();
  return { token };
}

function auth(t) {
  return { headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } };
}

function createRecord(t) {
  const payload = {
    artist: 'k6 Artist',
    name: `k6 Rec ${__VU}-${Date.now()}`,
    format: 'LP',
    recordGrade: 'VG+',
  };
  const res = http.post(apiUrl('/records'), JSON.stringify(payload), auth(t));
  dbg('POST /records', res);

  const ok = check(res, { 'POST /records 2xx': r => r.status >= 200 && r.status < 300 });
  if (!ok) return;

  const j = safeJson(res);
  const id = j && j.id;
  if (id) {
    const upd = http.put(apiUrl(`/records/${id}`), JSON.stringify({ notes: `k6_${__VU}_${Date.now()}` }), auth(t));
    dbg('PUT /records/:id (notes)', upd);
    check(upd, { 'PUT notes 2xx': r => r.status >= 200 && r.status < 300 });
    const arr = myIds.get(__VU) || [];
    arr.push(id);
    myIds.set(__VU, arr);
  }
}

function listRecords(t) {
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = http.get(apiUrl('/records'), auth(t));
    dbg('GET /records', res);
    if (shouldBackoff(res)) { backoffOnce(res, attempt); continue; }
    break;
  }
  check(res, { 'GET /records 2xx': r => r.status >= 200 && r.status < 300 });
  safeJson(res);
}

function getOneOfMine(t) {
  let mine = myIds.get(__VU) || [];
  if (!mine.length) {
    if (WRITE_PCT === 0) return; // don’t seed on read-only runs
    createRecord(t);
    mine = myIds.get(__VU) || [];
    if (!mine.length) return;
  }
  const id = mine[randInt(0, mine.length - 1)];

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = http.get(apiUrl(`/records/${id}`), auth(t));
    dbg('GET /records/:id', res);
    if (shouldBackoff(res)) { backoffOnce(res, attempt); continue; }
    break;
  }
  check(res, { 'GET /records/:id 2xx': r => r.status >= 200 && r.status < 300 });
  if (res && res.status >= 200 && res.status < 300) safeJson(res);
}

function updateOneOfMine(t) {
  const mine = myIds.get(__VU) || [];
  if (!mine.length) return createRecord(t);
  const id = mine[randInt(0, mine.length - 1)];
  const body = { hasInsert: Math.random() < 0.5, notes: `k6-touch-${Date.now()}` };

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = http.put(apiUrl(`/records/${id}`), JSON.stringify(body), auth(t));
    dbg('PUT /records/:id', res);
    if (shouldBackoff(res)) { backoffOnce(res, attempt); continue; }
    break;
  }
  check(res, { 'PUT /records/:id 2xx': r => r.status >= 200 && r.status < 300 });
}

function deleteOneOfMine(t) {
  const mine = myIds.get(__VU) || [];
  if (!mine.length) return;
  const idx = randInt(0, mine.length - 1);
  const id = mine[idx];

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = http.del(apiUrl(`/records/${id}`), null, auth(t));
    dbg('DEL /records/:id', res);
    if (shouldBackoff(res)) { backoffOnce(res, attempt); continue; }
    break;
  }
  const ok = check(res, { 'DEL /records/:id 204/2xx': r => r.status === 204 || (r.status >= 200 && r.status < 300) });
  if (ok) { mine.splice(idx, 1); myIds.set(__VU, mine); }
}

// ===== iteration loops =====
function loopMixed(t) {
  const roll = Math.random() * 100;
  if (roll < (100 - WRITE_PCT)) {
    if (Math.random() < 0.75) listRecords(t); else getOneOfMine(t);
  } else {
    const w = Math.random() * 100;
    if (w < 50) createRecord(t);
    else if (w < 85) updateOneOfMine(t);
    else deleteOneOfMine(t);
  }
  sleep(Math.random() * 0.2);
}

function loopReadMostly(t) {
  if (Math.random() < 0.85) listRecords(t); else getOneOfMine(t);
  sleep(Math.random() * 0.1);
}

export function runMixed(data)      { loopMixed(data.token); }
export function runReadMostly(data) { loopReadMostly(data.token); }

export function teardown(_) { /* no-op */ }
