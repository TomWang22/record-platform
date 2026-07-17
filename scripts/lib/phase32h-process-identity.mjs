/**
 * Phase 32H — executable-identity process inspection for PCAP collector classification.
 * Collectors are identified by actual executable basename / resolved path, not substring
 * matches inside shell command text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDumpcapSemantic } from './phase32h-collector-launch-spec.mjs';

export function isPhaseCaptureEvidenceRoot(root = '') {
  return (
    typeof root === 'string' &&
    (root.startsWith('/tmp/phase32h') ||
      root.startsWith('/tmp/phase33f') ||
      root.startsWith('/tmp/phase34'))
  );
}

export function resolveEvidenceRootFromCommand(command = '') {
  const outFlag = command.match(/--out\s+(\S+)/);
  if (outFlag) return outFlag[1];
  const wMatch = command.match(/(?:^|\s)-w\s+(\S+)/);
  if (wMatch) {
    const matched = wMatch[1].replace(/^["']|["']$/g, '');
    if (
      /\.pcap/i.test(matched) ||
      matched.startsWith('/tmp/phase32h') ||
      matched.startsWith('/tmp/phase33f') ||
      matched.startsWith('/tmp/phase34')
    ) {
      const parts = matched.split('/');
      const rootIdx = parts.findIndex(
        (part) => part.startsWith('phase32h') || part.startsWith('phase33f') || part.startsWith('phase34'),
      );
      if (rootIdx >= 0) return parts.slice(0, rootIdx + 1).join('/');
    }
  }
  const tmpMatch = command.match(/(\/tmp\/phase(?:32h|33f|34)[^\s'"]+)/);
  if (!tmpMatch) return null;
  const matched = tmpMatch[1];
  if (/\.pcap/i.test(matched)) {
    const parts = matched.split('/');
    const rootIdx = parts.findIndex(
      (part) => part.startsWith('phase32h') || part.startsWith('phase33f') || part.startsWith('phase34'),
    );
    if (rootIdx >= 0) return parts.slice(0, rootIdx + 1).join('/');
  }
  return matched;
}

export function resolveCaptureInterface(command = '') {
  const match = command.match(/(?:^|\s)-i\s+(\S+)/);
  return match ? match[1].replace(/^["']|["']$/g, '') : null;
}

export function resolvePcapOutputPath(command = '') {
  const match = command.match(/(?:^|\s)-w\s+(\S+)/);
  return match ? match[1].replace(/^["']|["']$/g, '') : null;
}

export const ALLOWED_CAPTURE_EXECUTABLES = new Set(['dumpcap', 'tcpdump']);

export const IGNORED_DIAGNOSTIC_EXECUTABLES = new Set([
  'bash',
  'zsh',
  'sh',
  'node',
  'python',
  'python3',
  'rg',
  'grep',
  'ps',
  'wc',
  'cat',
  'jq',
  'sleep',
  'make',
  'git',
  'awk',
  'sed',
  'tee',
  'less',
  'more',
  'head',
  'tail',
  'find',
  'lsof',
  'df',
  'env',
  'curl',
  'osascript',
]);

export const PROCESS_CLASSIFICATION = {
  NON_COLLECTOR: 'NON_COLLECTOR',
  PCAP_COLLECTOR_CANDIDATE: 'PCAP_COLLECTOR_CANDIDATE',
  MALFORMED_CAPTURE_CANDIDATE: 'MALFORMED_CAPTURE_CANDIDATE',
  PROCESS_INSPECTION_ERROR: 'PROCESS_INSPECTION_ERROR',
};

function basenameOf(token = '') {
  if (!token) return '';
  const cleaned = token.replace(/^["']|["']$/g, '');
  return path.basename(cleaned.split(' ')[0]);
}

export function tokenizeProcessCommand(command = '') {
  return tokenizeCommand(command);
}

function tokenizeCommand(command = '') {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function resolveExecutableBasename(proc = {}) {
  const argv = proc.argv || (proc.command ? tokenizeCommand(proc.command) : []);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const base = basenameOf(token).toLowerCase();
    const pathLike = token.includes('/');
    if (!pathLike && i > 0) continue;
    if (ALLOWED_CAPTURE_EXECUTABLES.has(base) || base === 'tshark') {
      return basenameOf(token);
    }
  }
  if (proc.executable_basename) return proc.executable_basename;
  if (argv.length) return basenameOf(argv[0]);
  if (proc.comm) return basenameOf(proc.comm);
  return '';
}

export function extractCaptureArgv(argv = []) {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const base = basenameOf(token).toLowerCase();
    const pathLike = token.includes('/');
    if (!pathLike && i > 0) continue;
    if (ALLOWED_CAPTURE_EXECUTABLES.has(base)) return argv.slice(i);
    if (base === 'tshark' && argv.slice(i).includes('-i') && !argv.slice(i).includes('-r')) {
      return argv.slice(i);
    }
  }
  return argv;
}

export function resolveExecutablePath(proc = {}) {
  if (proc.executable_path) return proc.executable_path;
  const argv = proc.argv || (proc.command ? tokenizeCommand(proc.command) : []);
  const first = argv[0];
  if (!first) return null;
  const cleaned = first.replace(/^["']|["']$/g, '');
  if (cleaned.startsWith('/')) {
    try {
      return fs.realpathSync(cleaned);
    } catch {
      return cleaned;
    }
  }
  return cleaned;
}

export function buildStartIdentity(proc = {}) {
  const pid = proc.pid ?? null;
  const lstart = proc.lstart ?? '';
  return `${pid}:${lstart}`.trim();
}

function isLiveTsharkCapture(argv = []) {
  const hasInput = argv.includes('-i');
  const hasReadFile = argv.includes('-r');
  return hasInput && !hasReadFile;
}

export function isAllowedCaptureExecutable(basename = '') {
  const base = basename.toLowerCase();
  if (ALLOWED_CAPTURE_EXECUTABLES.has(base)) return true;
  if (base === 'tshark') return true;
  return false;
}

export function isIgnoredDiagnosticExecutable(basename = '') {
  return IGNORED_DIAGNOSTIC_EXECUTABLES.has(basename.toLowerCase());
}

export function parseStructuredCaptureArgv(proc = {}) {
  const rawArgv = proc.argv || (proc.command ? tokenizeCommand(proc.command) : []);
  if (!rawArgv.length) return { ok: false, reason: 'empty_argv' };
  const argv = extractCaptureArgv(rawArgv);
  const basename = resolveExecutableBasename({ ...proc, argv: rawArgv });
  if (!isAllowedCaptureExecutable(basename)) {
    return { ok: false, reason: 'not_capture_executable', basename };
  }
  if (basename === 'tshark' && !isLiveTsharkCapture(argv)) {
    return { ok: false, reason: 'offline_tshark', basename };
  }
  const parsed = parseDumpcapSemantic(argv);
  const outputPath = parsed.semantic.output_path || resolvePcapOutputPath(proc.command || '');
  const iface = parsed.semantic.interface || resolveCaptureInterface(proc.command || '');
  const evidenceRoot = parsed.semantic.evidence_root || resolveEvidenceRootFromCommand(proc.command || '');
  if (!outputPath) return { ok: false, reason: 'missing_output_path', basename, parsed };
  if (!isPhaseCaptureEvidenceRoot(evidenceRoot)) {
    return { ok: false, reason: 'output_outside_phase32h_roots', basename, outputPath, evidenceRoot };
  }
  return {
    ok: true,
    basename,
    argv,
    parsed,
    interface: iface,
    output_path: outputPath,
    evidence_root: evidenceRoot,
  };
}

export function openOutputPathsForPid(pid, { timeoutMs = 2000 } = {}) {
  if (!pid) return [];
  const r = spawnSync('lsof', ['-nP', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  const paths = [];
  for (const line of (r.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('COMMAND')) continue;
    const parts = trimmed.split(/\s+/);
    const name = parts[parts.length - 1];
    if (/\.pcap/i.test(name) || /phase32h/i.test(name) || /phase33f/i.test(name)) paths.push(name);
  }
  return paths;
}

export function buildProcessInspection(proc = {}, opts = {}) {
  const pid = proc.pid ?? null;
  const ppid = proc.ppid ?? null;
  const comm = proc.comm ?? null;
  const command = proc.command ?? '';
  const argv = proc.argv || (command ? tokenizeCommand(command) : []);
  const executableBasename = resolveExecutableBasename({ ...proc, argv, comm });
  const executablePath = resolveExecutablePath({ ...proc, argv });
  const startIdentity = buildStartIdentity(proc);
  const openOutputPaths = opts.includeOpenFiles && pid ? openOutputPathsForPid(pid) : proc.open_output_paths || [];

  if (!comm && opts.requireComm) {
    return {
      pid,
      ppid,
      start_identity: startIdentity,
      comm,
      executable_path: executablePath,
      executable_basename: executableBasename,
      argv,
      open_output_paths: openOutputPaths,
      registry_match: Boolean(proc.registry_match),
      classification: PROCESS_CLASSIFICATION.PROCESS_INSPECTION_ERROR,
      inspection_error: 'missing_comm',
    };
  }

  if (isIgnoredDiagnosticExecutable(executableBasename)) {
    return {
      pid,
      ppid,
      start_identity: startIdentity,
      comm,
      executable_path: executablePath,
      executable_basename: executableBasename,
      argv,
      open_output_paths: openOutputPaths,
      registry_match: Boolean(proc.registry_match),
      classification: PROCESS_CLASSIFICATION.NON_COLLECTOR,
      non_collector_reason: 'diagnostic_executable',
    };
  }

  if (!isAllowedCaptureExecutable(executableBasename)) {
    return {
      pid,
      ppid,
      start_identity: startIdentity,
      comm,
      executable_path: executablePath,
      executable_basename: executableBasename,
      argv,
      open_output_paths: openOutputPaths,
      registry_match: Boolean(proc.registry_match),
      classification: PROCESS_CLASSIFICATION.NON_COLLECTOR,
      non_collector_reason: 'executable_not_allowed',
    };
  }

  const capture = parseStructuredCaptureArgv({ ...proc, argv, comm });
  if (!capture.ok) {
    if (capture.reason === 'offline_tshark') {
      return {
        pid,
        ppid,
        start_identity: startIdentity,
        comm,
        executable_path: executablePath,
        executable_basename: executableBasename,
        argv,
        open_output_paths: openOutputPaths,
        registry_match: Boolean(proc.registry_match),
        classification: PROCESS_CLASSIFICATION.NON_COLLECTOR,
        non_collector_reason: capture.reason,
      };
    }
    return {
      pid,
      ppid,
      start_identity: startIdentity,
      comm,
      executable_path: executablePath,
      executable_basename: executableBasename,
      argv,
      open_output_paths: openOutputPaths,
      registry_match: Boolean(proc.registry_match),
      classification: PROCESS_CLASSIFICATION.MALFORMED_CAPTURE_CANDIDATE,
      malformed_reason: capture.reason,
      capture,
    };
  }

  if (openOutputPaths.length === 0 && opts.requireOpenPcapForShellParent) {
    // shells quoting dumpcap are already NON_COLLECTOR; this guards wrapper edge cases
  }

  return {
    pid,
    ppid,
    start_identity: startIdentity,
    comm,
    executable_path: executablePath,
    executable_basename: executableBasename,
    argv: capture.argv,
    open_output_paths: openOutputPaths,
    registry_match: Boolean(proc.registry_match),
    classification: PROCESS_CLASSIFICATION.PCAP_COLLECTOR_CANDIDATE,
    interface: capture.interface,
    output_path: capture.output_path,
    evidence_root: capture.evidence_root,
    parsed: capture.parsed,
  };
}

export function isPcapCollectorCandidate(proc = {}, opts = {}) {
  const inspection = buildProcessInspection(proc, opts);
  return inspection.classification === PROCESS_CLASSIFICATION.PCAP_COLLECTOR_CANDIDATE;
}

export function enrichProcessAsCollectorCandidate(proc = {}, opts = {}) {
  const inspection = buildProcessInspection(proc, opts);
  if (inspection.classification !== PROCESS_CLASSIFICATION.PCAP_COLLECTOR_CANDIDATE) return null;
  return {
    ...proc,
    ...inspection,
    command: proc.command || inspection.argv.join(' '),
    evidence_root: inspection.evidence_root,
    interface: inspection.interface,
    output_path: inspection.output_path,
    role: 'pcap_collector',
  };
}

export function listCaptureCollectorCandidates(processes, opts = {}) {
  const candidates = [];
  for (const proc of processes) {
    const enriched = enrichProcessAsCollectorCandidate(proc, opts);
    if (enriched) candidates.push(enriched);
  }
  return candidates;
}

export function inspectProcessByPid(pid, processes) {
  const proc = processes.find((p) => p.pid === pid);
  if (!proc) return null;
  return buildProcessInspection(proc, { requireComm: false, includeOpenFiles: false });
}

export function evaluateForeignCollectorDecision({ candidate, activeRoot, registeredPid, registeredStartIdentity }) {
  if (!candidate || candidate.classification !== PROCESS_CLASSIFICATION.PCAP_COLLECTOR_CANDIDATE) {
    return { foreign: false, reason: 'not_candidate' };
  }
  if (registeredPid && candidate.pid === registeredPid) {
    if (registeredStartIdentity && candidate.start_identity !== registeredStartIdentity) {
      return { foreign: false, duplicate: false, pid_reuse: true, candidate };
    }
    return { foreign: false, reason: 'registered_collector' };
  }
  if (!isPhaseCaptureEvidenceRoot(candidate.evidence_root)) {
    return { foreign: false, reason: 'outside_phase32h_roots' };
  }
  if (candidate.evidence_root !== activeRoot) {
    return { foreign: true, reason: 'different_evidence_root', candidate };
  }
  return { foreign: false, duplicate: true, reason: 'same_root_different_pid', candidate };
}

export function evaluateDuplicateCollectorDecision({ candidate, activeRoot, registeredPid }) {
  if (!candidate || candidate.classification !== PROCESS_CLASSIFICATION.PCAP_COLLECTOR_CANDIDATE) {
    return { duplicate: false, reason: 'not_candidate' };
  }
  if (candidate.evidence_root !== activeRoot) return { duplicate: false, reason: 'different_root' };
  if (registeredPid && candidate.pid === registeredPid) return { duplicate: false, reason: 'registered_pid' };
  return { duplicate: true, reason: 'second_capture_on_same_root', candidate };
}
