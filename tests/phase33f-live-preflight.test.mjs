import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTH_SMOKE_ROOT,
  assertSafeAuthSmokeRoot,
  evaluateAuthSmokeRows,
} from '../scripts/lib/phase33f-auth-smoke.mjs';
import {
  assertSafeQuicPcapRoot,
  evaluateQuicPcapEvidence,
} from '../scripts/lib/phase33f-quic-pcap-preflight.mjs';
import {
  REAL_CANARY_ROOT,
  REAL_TARGET_ROOT,
} from '../scripts/lib/phase33f-canary-config.mjs';

test('auth smoke accepts only dedicated temporary roots', () => {
  assert.equal(assertSafeAuthSmokeRoot(AUTH_SMOKE_ROOT), AUTH_SMOKE_ROOT);
  assert.throws(() => assertSafeAuthSmokeRoot(REAL_CANARY_ROOT), /real gauntlet root/i);
  assert.throws(() => assertSafeAuthSmokeRoot('/tmp/not-phase33f-auth'), /dedicated auth smoke root/i);
});

test('auth smoke fails a private request that succeeds', () => {
  const report = evaluateAuthSmokeRows([
    {
      scenario: 'unauthorized_refusal',
      protocol: 'h3',
      http_status: 200,
      http_version: '3',
      retries: 0,
      body: {},
    },
  ]);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.failures[0].reason, 'expected_deterministic_4xx');
});

test('QUIC preflight accepts only temporary roots', () => {
  assert.equal(assertSafeQuicPcapRoot('/tmp/phase33f-quic-pcap-preflight-test'), '/tmp/phase33f-quic-pcap-preflight-test');
  assert.throws(() => assertSafeQuicPcapRoot(REAL_TARGET_ROOT), /real gauntlet root/i);
});

test('QUIC preflight requires wire packet evidence beyond HTTP/3 response', () => {
  const report = evaluateQuicPcapEvidence({
    response: { http_status: 200, http_version: '3', curl_exit_code: 0 },
    collector: { status: 'ACTIVE', process_count: 1 },
    captureStatus: { iface: 'bridge100', argv: ['/usr/local/bin/dumpcap'], drops: 0 },
    registry: { collectors: { pcap_collector: { launch_spec: { argv: ['/usr/local/bin/dumpcap'] } } } },
    growth: { blocked: false, discovery: { active_segment: '/tmp/x.pcapng', sequence_contiguous: true } },
    packetSpace: { counts: { initial_packets: 0, one_rtt_packets: 0 }, observed_versions: [] },
  });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.failures.includes('quic_initial_missing'));
  assert.ok(report.failures.includes('quic_1rtt_missing'));
});
