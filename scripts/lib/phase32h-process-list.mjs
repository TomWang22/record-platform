/**
 * Phase 32H — wide process listing for collector identity (full args via -ww).
 */
import { spawnSync } from 'node:child_process';
import {
  enrichProcessAsCollectorCandidate,
  listCaptureCollectorCandidates,
  resolveCaptureInterface,
  resolveEvidenceRootFromCommand,
  resolvePcapOutputPath,
  tokenizeProcessCommand,
} from './phase32h-process-identity.mjs';

export {
  resolveCaptureInterface,
  resolveEvidenceRootFromCommand,
  resolvePcapOutputPath,
} from './phase32h-process-identity.mjs';

/** @deprecated use isPcapCollectorCandidate from phase32h-process-identity.mjs */
export function isPhase32hCaptureProcess(procOrCommand = '') {
  if (typeof procOrCommand === 'string') {
    return Boolean(
      enrichProcessAsCollectorCandidate({ command: procOrCommand, comm: null }),
    );
  }
  return Boolean(enrichProcessAsCollectorCandidate(procOrCommand));
}

export function listProcessesWide() {
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,lstart=,etime=,args='], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const rows = [];
  for (const line of (r.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const slashAt = trimmed.search(/\s\//);
    if (slashAt < 0) continue;
    const prefix = trimmed.slice(0, slashAt).trim();
    const args = trimmed.slice(slashAt + 1);
    const prefixMatch = prefix.match(/^(\d+)\s+(\d+)\s+(.+)\s+(\S+)$/);
    if (!prefixMatch) continue;
    const [, pid, ppid, lstart, etime] = prefixMatch;
    const argv = tokenizeProcessCommand(args);
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      lstart,
      etime,
      comm: null,
      command: args,
      argv,
      evidence_root: resolveEvidenceRootFromCommand(args),
      interface: resolveCaptureInterface(args),
      output_path: resolvePcapOutputPath(args),
      role: null,
    });
  }
  return rows;
}

export function listPhase32hCaptureProcesses() {
  return listCaptureCollectorCandidates(listProcessesWide());
}
