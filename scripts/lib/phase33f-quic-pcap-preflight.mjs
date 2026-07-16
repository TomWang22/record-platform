/**
 * Phase 33F wire-level HTTP/3 preflight. HTTP response headers are supporting
 * evidence only; a passing result requires QUIC packet-space evidence in PCAP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT,
  DEFAULTS,
  PROTOCOLS,
  curlRequest,
  jwtSub,
  login,
  resolveCurlTarget,
} from './phase22-full-replay-common.mjs';
import {
  CAPABILITY_ROUTE_PATHS,
  REAL_CANARY_ROOT,
  REAL_TARGET_ROOT,
} from './phase33f-canary-config.mjs';
import {
  evaluatePcapCollectorIdentity,
  readCollectorRegistry,
  registerPcapCollector,
} from './phase32h-collector-registry.mjs';
import { deriveRingOutputSpec, evaluateRingGrowthHealth } from './phase32h-pcap-ring-segments.mjs';
import { analyzePcapPacketSpace } from './phase32h-quic-packet-space.mjs';
import { listPhase32hCaptureProcesses } from './phase32h-process-list.mjs';
import { stopSmokeCollectors } from './phase32h-smoke-collector-cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export function assertSafeQuicPcapRoot(outRoot) {
  if (outRoot === REAL_CANARY_ROOT || outRoot === REAL_TARGET_ROOT) {
    throw new Error(`real gauntlet root is forbidden for QUIC/PCAP preflight: ${outRoot}`);
  }
  if (!outRoot.startsWith('/tmp/phase33f-quic-pcap-preflight')) {
    throw new Error(`QUIC/PCAP preflight requires a dedicated temporary root: ${outRoot}`);
  }
  return outRoot;
}

function latestPcap(outRoot) {
  const directory = path.join(outRoot, 'pcap');
  if (!fs.existsSync(directory)) return null;
  const files = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.pcapng') || name.endsWith('.pcap'))
    .map((name) => path.join(directory, name));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

function readCaptureStatus(outRoot) {
  const file = path.join(outRoot, 'pcap', 'capture-status.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function wait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function evaluateQuicPcapEvidence({ response, collector, captureStatus, registry, growth, packetSpace }) {
  const failures = [];
  const counts = packetSpace?.counts || {};
  const argv = registry?.collectors?.pcap_collector?.launch_spec?.argv || [];
  const activeSegment = growth?.discovery?.active_segment;
  if (collector?.status !== 'ACTIVE' || collector?.process_count !== 1) failures.push('collector_not_active_singleton');
  if (!captureStatus?.iface) failures.push('capture_interface_missing');
  if (!captureStatus?.tool || !path.basename(captureStatus.tool).startsWith('dumpcap')) failures.push('dumpcap_identity_missing');
  if (!Array.isArray(captureStatus?.argv) || captureStatus.argv.length === 0 || argv.join('\0') !== captureStatus.argv.join('\0')) {
    failures.push('dumpcap_argv_unregistered');
  }
  if (!String(captureStatus?.filter || '').includes('udp port 443')) failures.push('udp_443_filter_missing');
  if (!activeSegment) failures.push('active_ring_segment_missing');
  if (growth?.blocked || growth?.discovery?.sequence_contiguous !== true) failures.push('ring_continuity_or_growth_failed');
  if (Number(captureStatus?.drops ?? 0) !== 0) failures.push('pcap_drops_detected');
  if (response?.http_status !== 200 || !String(response?.http_version || '').startsWith('3') || response?.curl_exit_code !== 0) {
    failures.push('h3_response_or_fallback_failed');
  }
  if ((counts.initial_packets || 0) < 1) failures.push('quic_initial_missing');
  if ((counts.one_rtt_packets || 0) < 1) failures.push('quic_1rtt_missing');
  if (!(packetSpace?.observed_versions || []).length) failures.push('quic_version_missing');
  return { status: failures.length ? 'FAIL' : 'PASS', failures };
}

function writeEvidence(outRoot, report) {
  fs.writeFileSync(path.join(outRoot, 'phase33f-quic-pcap-preflight.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function liveQuicPcapPreflight({
  outRoot = `/tmp/phase33f-quic-pcap-preflight-${process.pid}`,
  repoRoot = REPO_ROOT,
  baseUrl = DEFAULTS.baseUrl,
  caCert = DEFAULTS.caCert,
} = {}) {
  assertSafeQuicPcapRoot(outRoot);
  const cfg = {
    ...DEFAULTS,
    baseUrl,
    caCert,
    password: DEFAULTS.password || process.env.T20_PARTICIPANT_LOGIN_PASSWORD || 'ContractPass123!',
    curlResolve: resolveCurlTarget(baseUrl),
    mgmtProto: PROTOCOLS.h1,
  };
  let response = null;
  let captureStatus = {};
  let registry = null;
  let collector = null;
  let growth = null;
  let packetSpace = { counts: {}, observed_versions: [] };
  let cleanup = null;
  let error = null;

  try {
    fs.mkdirSync(outRoot, { recursive: true });
    const started = spawnSync('bash', [path.join(repoRoot, 'scripts/phase32h-start-pcap-capture.sh'), outRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (started.status !== 0) throw new Error(`pcap start failed: ${(started.stderr || started.stdout || '').slice(0, 500)}`);
    captureStatus = readCaptureStatus(outRoot);
    registerPcapCollector(outRoot, {
      run_id: `phase33f-quic-preflight-${process.pid}`,
      launch_head: 'preflight',
      manifest_sha: 'preflight',
      interface: captureStatus.iface,
      output_path: captureStatus.file,
    });

    const token = login(CONTRACT.email, cfg);
    const userId = jwtSub(token);
    response = curlRequest({
      method: 'POST',
      urlPath: CAPABILITY_ROUTE_PATHS.semantic_search,
      token,
      userId,
      body: {
        capability: 'semantic_search',
        mode: 'semantic_fixture_or_staging',
        retrieval_mode: 'semantic_fixture',
        principal_fixture: userId,
        production_mutation_allowed: false,
      },
      protocolFlag: PROTOCOLS.h3.flag,
      expectedVersion: PROTOCOLS.h3.expected,
      baseUrl: cfg.baseUrl,
      caCert: cfg.caCert,
      curlResolve: cfg.curlResolve,
    });
    wait(500);
    captureStatus = readCaptureStatus(outRoot);
    registry = readCollectorRegistry(outRoot);
    collector = evaluatePcapCollectorIdentity(outRoot, listPhase32hCaptureProcesses(), registry, { probesActive: true });
    const ringSpec = deriveRingOutputSpec(captureStatus.file, captureStatus, outRoot);
    growth = evaluateRingGrowthHealth(outRoot, ringSpec, { probesActive: true });
    const pcapPath = latestPcap(outRoot);
    if (pcapPath) packetSpace = analyzePcapPacketSpace(pcapPath);
  } catch (caught) {
    error = String(caught.message || caught);
  } finally {
    cleanup = stopSmokeCollectors(outRoot, { repoRoot });
  }

  const evaluation = evaluateQuicPcapEvidence({ response, collector, captureStatus, registry, growth, packetSpace });
  const report = {
    status: error || !cleanup?.zero_root_scoped ? 'FAIL' : evaluation.status,
    root: outRoot,
    interface: captureStatus.iface || null,
    dumpcap: {
      tool: captureStatus.tool || null,
      argv_registered: registry?.collectors?.pcap_collector?.launch_spec?.argv || [],
      capture_argv: captureStatus.argv || [],
    },
    response: response ? {
      http_status: response.http_status,
      http_version: response.http_version,
      curl_exit_code: response.curl_exit_code,
    } : null,
    collector,
    active_ring_segment: growth?.discovery?.active_segment || null,
    growth_state: growth?.growth_state || null,
    continuity: growth?.discovery?.sequence_contiguous ?? false,
    drops: Number(captureStatus.drops ?? 0),
    packet_space: {
      initial_packets: packetSpace.counts?.initial_packets || 0,
      one_rtt_packets: packetSpace.counts?.one_rtt_packets || 0,
      observed_versions: packetSpace.observed_versions || [],
    },
    failures: [
      ...evaluation.failures,
      ...(error ? ['preflight_execution_error'] : []),
      ...(!cleanup?.zero_root_scoped ? ['collectors_not_stopped'] : []),
    ],
    collectors_stopped: cleanup?.zero_root_scoped === true,
    post_smoke_root_scoped_processes: cleanup?.remaining_processes?.length ?? null,
    error,
  };
  writeEvidence(outRoot, report);
  return report;
}
