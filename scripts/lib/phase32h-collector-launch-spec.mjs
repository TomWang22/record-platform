/**
 * Phase 32H — structured PCAP collector launch identity (semantic argv, not string equality).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  resolveCaptureInterface,
  resolveEvidenceRootFromCommand,
  resolvePcapOutputPath,
} from './phase32h-process-identity.mjs';
import { deriveRingOutputSpec } from './phase32h-pcap-ring-segments.mjs';

const FC = {
  ACTIVE: 'ACTIVE',
  EXPECTED_PCAP_PROCESS_MISSING: 'EXPECTED_PCAP_PROCESS_MISSING',
  EXPECTED_PCAP_PID_REUSED: 'EXPECTED_PCAP_PID_REUSED',
  EXPECTED_PCAP_EXECUTABLE_MISMATCH: 'EXPECTED_PCAP_EXECUTABLE_MISMATCH',
  EXPECTED_PCAP_ARGUMENT_MISMATCH: 'EXPECTED_PCAP_ARGUMENT_MISMATCH',
  EXPECTED_PCAP_OUTPUT_MISMATCH: 'EXPECTED_PCAP_OUTPUT_MISMATCH',
};

export const LAUNCH_SPEC_SCHEMA_VERSION = 1;

function tokenizeCommand(command = '') {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
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

export function parseDumpcapSemantic(argvOrCommand) {
  const argv = Array.isArray(argvOrCommand) ? argvOrCommand : tokenizeCommand(argvOrCommand);
  const executable = argv[0] || 'dumpcap';
  const semantic = {
    quiet: false,
    interface: null,
    capture_filter: null,
    ring_filesize_kb: null,
    ring_files: null,
    output_path: null,
    evidence_root: null,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-q') {
      semantic.quiet = true;
      continue;
    }
    if (token === '-i' && argv[i + 1]) {
      semantic.interface = argv[++i];
      continue;
    }
    if (token === '-f' && argv[i + 1]) {
      const parts = [];
      i += 1;
      while (i < argv.length && !argv[i].startsWith('-')) {
        parts.push(argv[i++]);
      }
      i -= 1;
      semantic.capture_filter = parts.join(' ');
      continue;
    }
    if (token === '-w' && argv[i + 1]) {
      semantic.output_path = argv[++i];
      semantic.evidence_root = resolveEvidenceRootFromCommand(`dumpcap -w ${semantic.output_path}`);
      continue;
    }
    if (token === '-b' && argv[i + 1]) {
      const spec = argv[++i];
      if (spec.startsWith('filesize:')) {
        semantic.ring_filesize_kb = Number(spec.slice('filesize:'.length));
      } else if (spec.startsWith('files:')) {
        semantic.ring_files = Number(spec.slice('files:'.length));
      }
    }
  }
  if (!semantic.evidence_root && semantic.output_path) {
    semantic.evidence_root = resolveEvidenceRootFromCommand(`dumpcap -w ${semantic.output_path}`);
  }
  return { executable, argv, semantic };
}

export function buildLaunchSpecFromCaptureStatus(outRoot, captureStatus, record = {}) {
  const argv =
    captureStatus.argv ||
    [
      captureStatus.tool || 'dumpcap',
      '-q',
      '-i',
      captureStatus.iface,
      '-f',
      captureStatus.filter,
      '-b',
      `filesize:${captureStatus.ring_filesize_kb ?? 250000}`,
      '-b',
      `files:${captureStatus.ring_files ?? 48}`,
      '-w',
      captureStatus.file,
    ].filter((v) => v != null && v !== '');
  const parsed = parseDumpcapSemantic(argv);
  let executableRealpath = null;
  try {
    if (fs.existsSync(parsed.executable)) {
      executableRealpath = fs.realpathSync(parsed.executable);
    }
  } catch {
    executableRealpath = null;
  }
  const ringOutput = deriveRingOutputSpec(parsed.semantic.output_path, captureStatus, outRoot);
  return {
    schema_version: LAUNCH_SPEC_SCHEMA_VERSION,
    role: 'pcap_collector',
    pid: record.pid ?? captureStatus.pid,
    ppid: record.ppid ?? process.ppid,
    process_start: {
      started_at: record.started_at ?? captureStatus.started_at ?? new Date().toISOString(),
      lstart: record.lstart ?? null,
    },
    executable: parsed.executable,
    executable_realpath: executableRealpath,
    argv: parsed.argv,
    semantic: parsed.semantic,
    ring_output: ringOutput,
    evidence_root: outRoot,
    run_id: record.run_id ?? null,
    launch_head: record.launch_head ?? null,
    manifest_sha: record.manifest_sha ?? null,
    heartbeat_path: path.join(outRoot, 'pcap/capture-status.json'),
    capture_status_path: path.join(outRoot, 'pcap/capture-status.json'),
    registry_created_at: new Date().toISOString(),
    expected_singleton_scope: record.expected_singleton_scope || 'pcap_collector_per_root',
  };
}

function resolveExecutableRealpath(executable) {
  try {
    if (executable && fs.existsSync(executable)) return fs.realpathSync(executable);
  } catch {
    return null;
  }
  return null;
}

function semanticEqual(a, b) {
  return (
    Boolean(a.quiet) === Boolean(b.quiet) &&
    a.interface === b.interface &&
    a.capture_filter === b.capture_filter &&
    a.ring_filesize_kb === b.ring_filesize_kb &&
    a.ring_files === b.ring_files &&
    a.output_path === b.output_path &&
    a.evidence_root === b.evidence_root
  );
}

export function verifyLaunchSpecAgainstProcess(entry, proc, opts = {}) {
  if (!entry?.launch_spec && !entry?.semantic) {
    const legacy = entry?.command ? parseDumpcapSemantic(entry.command) : null;
    if (!legacy) {
      return { pass: false, failure_class: FC.EXPECTED_PCAP_ARGUMENT_MISMATCH, detail: 'missing launch spec' };
    }
    entry = { ...entry, launch_spec: { semantic: legacy.semantic, executable: legacy.executable, argv: legacy.argv } };
  }
  const spec = entry.launch_spec || entry;
  const liveSource = Array.isArray(proc.argv) && proc.argv.length ? proc.argv : proc.command;
  const live = parseDumpcapSemantic(liveSource);
  const liveRealpath = resolveExecutableRealpath(live.executable);
  const specRealpath = spec.executable_realpath || resolveExecutableRealpath(spec.executable);
  const expectedPid = entry.pid ?? spec.pid;

  if (expectedPid !== proc.pid) {
    return { pass: false, failure_class: FC.EXPECTED_PCAP_PROCESS_MISSING, detail: 'pid mismatch' };
  }
  if (opts.pidAlive === false) {
    return { pass: false, failure_class: FC.EXPECTED_PCAP_PROCESS_MISSING, detail: 'pid not alive' };
  }
  if (spec.process_start?.lstart && proc.lstart && spec.process_start.lstart !== proc.lstart) {
    return { pass: false, failure_class: FC.EXPECTED_PCAP_PID_REUSED, detail: 'lstart mismatch' };
  }
  if (specRealpath && liveRealpath && specRealpath !== liveRealpath) {
    return { pass: false, failure_class: FC.EXPECTED_PCAP_EXECUTABLE_MISMATCH, detail: 'executable realpath mismatch' };
  }
  if (spec.executable && live.executable && path.basename(spec.executable) !== path.basename(live.executable)) {
    return { pass: false, failure_class: FC.EXPECTED_PCAP_EXECUTABLE_MISMATCH, detail: 'executable basename mismatch' };
  }
  if (!semanticEqual(spec.semantic || spec.launch_spec?.semantic, live.semantic)) {
    const missing = [];
    const registered = spec.semantic || spec.launch_spec?.semantic || {};
    const actual = live.semantic;
    if (registered.quiet && !actual.quiet) missing.push('-q');
    if (registered.capture_filter && registered.capture_filter !== actual.capture_filter) missing.push('-f');
    if (registered.interface && registered.interface !== actual.interface) missing.push('-i');
    if (registered.ring_filesize_kb != null && registered.ring_filesize_kb !== actual.ring_filesize_kb) missing.push('ring_filesize');
    if (registered.ring_files != null && registered.ring_files !== actual.ring_files) missing.push('ring_files');
    if (registered.output_path && registered.output_path !== actual.output_path) missing.push('-w');
    if (registered.evidence_root && registered.evidence_root !== actual.evidence_root) missing.push('evidence_root');
    return {
      pass: false,
      failure_class: FC.EXPECTED_PCAP_ARGUMENT_MISMATCH,
      detail: 'semantic argv mismatch',
      missing_arguments: missing,
      registered_semantic: registered,
      actual_semantic: actual,
    };
  }
  const registeredArgv = spec.argv || [];
  const liveArgvList = live.argv || [];
  if (registeredArgv.length && liveArgvList.length && registeredArgv.length !== liveArgvList.length) {
    return {
      pass: false,
      failure_class: FC.EXPECTED_PCAP_ARGUMENT_MISMATCH,
      detail: 'extra argv tokens',
      extra_arguments: true,
    };
  }
  const expectedRoot = entry.evidence_root ?? spec.evidence_root;
  if (expectedRoot && proc.evidence_root && expectedRoot !== proc.evidence_root) {
    return { pass: false, failure_class: FC.EXPECTED_PCAP_OUTPUT_MISMATCH, detail: 'evidence root mismatch' };
  }
  const expectedRunId = entry.run_id ?? spec.run_id;
  if (expectedRunId && opts.runId && expectedRunId !== opts.runId) {
    return { pass: false, failure_class: FC.EXPECTED_PCAP_ARGUMENT_MISMATCH, detail: 'run_id mismatch', run_id_mismatch: true };
  }
  const expectedLaunchHead = entry.launch_head ?? spec.launch_head;
  if (expectedLaunchHead && opts.launchHead && expectedLaunchHead !== opts.launchHead) {
    return { pass: false, failure_class: FC.EXPECTED_PCAP_ARGUMENT_MISMATCH, detail: 'launch_head mismatch', launch_head_mismatch: true };
  }
  return { pass: true, failure_class: FC.ACTIVE, actual_semantic: live.semantic };
}

export function normalizeArgvForComparison(argv) {
  return parseDumpcapSemantic(argv).semantic;
}
