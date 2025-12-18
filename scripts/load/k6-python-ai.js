import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const sellingAdviceLatency = new Trend('selling_advice_latency');
const buyingAdviceLatency = new Trend('buying_advice_latency');
const negotiationAdviceLatency = new Trend('negotiation_advice_latency');
const biddingAdviceLatency = new Trend('bidding_advice_latency');

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users
    { duration: '1m', target: 20 },  // Stay at 20 users
    { duration: '30s', target: 50 }, // Ramp up to 50 users
    { duration: '2m', target: 50 }, // Stay at 50 users (peak load)
    { duration: '30s', target: 20 }, // Ramp down to 20 users
    { duration: '1m', target: 20 },  // Stay at 20 users
    { duration: '30s', target: 0 },  // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.05'],  // Error rate should be less than 5%
    errors: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.PYTHON_AI_URL || 'http://python-ai-service.record-platform.svc.cluster.local:5005';
const API_GATEWAY_URL = __ENV.API_GATEWAY_URL || 'http://api-gateway.record-platform.svc.cluster.local:4000';

// Test queries
const testQueries = [
  'Beatles Abbey Road',
  'Pink Floyd Dark Side',
  'Led Zeppelin IV',
  'Radiohead OK Computer',
  'The Doors',
  'Jimi Hendrix',
  'Bob Dylan',
  'The Rolling Stones',
];

function randomQuery() {
  return testQueries[Math.floor(Math.random() * testQueries.length)];
}

function randomGrade() {
  const grades = ['M', 'NM', 'EX', 'VG+', 'VG'];
  return grades[Math.floor(Math.random() * grades.length)];
}

export default function () {
  const query = randomQuery();
  const userId = `user-${Math.floor(Math.random() * 1000)}`;
  
  // Test 1: Selling Advice
  const sellingStart = Date.now();
  const sellingRes = http.post(`${BASE_URL}/ai/selling-advice`, JSON.stringify({
    query: query,
    record_grade: randomGrade(),
    sleeve_grade: randomGrade(),
    user_id: userId,
    current_price: Math.random() * 100 + 20,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'selling-advice' },
  });
  const sellingLatency = Date.now() - sellingStart;
  sellingAdviceLatency.add(sellingLatency);
  
  check(sellingRes, {
    'selling advice status is 200': (r) => r.status === 200,
    'selling advice has recommended_price': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.recommended_price !== undefined;
      } catch {
        return false;
      }
    },
  }) || errorRate.add(1);
  
  sleep(0.5);
  
  // Test 2: Buying Advice
  const buyingStart = Date.now();
  const buyingRes = http.post(`${BASE_URL}/ai/buying-advice`, JSON.stringify({
    query: query,
    max_budget: Math.random() * 200 + 50,
    user_id: userId,
    urgency: ['normal', 'high', 'low'][Math.floor(Math.random() * 3)],
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'buying-advice' },
  });
  const buyingLatency = Date.now() - buyingStart;
  buyingAdviceLatency.add(buyingLatency);
  
  check(buyingRes, {
    'buying advice status is 200': (r) => r.status === 200,
    'buying advice has fair_price': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.fair_price !== undefined;
      } catch {
        return false;
      }
    },
  }) || errorRate.add(1);
  
  sleep(0.5);
  
  // Test 3: Negotiation Advice (50% buyer, 50% seller)
  const role = Math.random() > 0.5 ? 'buyer' : 'seller';
  const negotiationStart = Date.now();
  const negotiationRes = http.post(`${BASE_URL}/ai/negotiation-advice`, JSON.stringify({
    query: query,
    role: role,
    current_price: Math.random() * 100 + 30,
    target_price: Math.random() * 100 + 25,
    user_id: userId,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'negotiation-advice' },
  });
  const negotiationLatency = Date.now() - negotiationStart;
  negotiationAdviceLatency.add(negotiationLatency);
  
  check(negotiationRes, {
    'negotiation advice status is 200': (r) => r.status === 200,
    'negotiation advice has strategy': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.strategy !== undefined;
      } catch {
        return false;
      }
    },
  }) || errorRate.add(1);
  
  sleep(0.5);
  
  // Test 4: Bidding Advice
  const biddingStart = Date.now();
  const biddingRes = http.post(`${BASE_URL}/ai/bidding-advice`, JSON.stringify({
    query: query,
    current_bid: Math.random() * 80 + 20,
    auction_end_time: new Date(Date.now() + Math.random() * 86400000).toISOString(),
    user_id: userId,
    max_budget: Math.random() * 150 + 50,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'bidding-advice' },
  });
  const biddingLatency = Date.now() - biddingStart;
  biddingAdviceLatency.add(biddingLatency);
  
  check(biddingRes, {
    'bidding advice status is 200': (r) => r.status === 200,
    'bidding advice has should_bid': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.should_bid !== undefined;
      } catch {
        return false;
      }
    },
  }) || errorRate.add(1);
  
  sleep(1);
  
  // Test 5: Health check
  const healthRes = http.get(`${BASE_URL}/healthz`, {
    tags: { endpoint: 'healthz' },
  });
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);
  
  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': JSON.stringify(data, null, 2),
  };
}

