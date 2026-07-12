/**
 * Phase 32H — wide process listing for collector identity (full args via -ww).
 */
import { spawnSync } from 'node:child_process';

const CAPTURE_RE = /dumpcap|tcpdump/i;
const PHASE32H_RE = /phase32h/i;

export function resolveEvidenceRootFromCommand(command = '') {
  const outFlag = command.match(/--out\s+(\S+)/);
  if (outFlag) return outFlag[1];
  const tmpMatch = command.match(/(\/tmp\/phase32h[^\s'"]+)/);
  if (!tmpMatch) return null;
  const matched = tmpMatch[1];
  if (/\.pcap/i.test(matched)) {
    const parts = matched.split('/');
    const rootIdx = parts.findIndex((part) => part.startsWith('phase32h'));
    if (rootIdx >= 0) return parts.slice(0, rootIdx + 1).join('/');
  }
  return matched;
}

export function resolveCaptureInterface(command = '') {
  const match = command.match(/(?:^|\s)-i\s+(\S+)/);
  return match ? match[1] : null;
}

export function resolvePcapOutputPath(command = '') {
  const match = command.match(/(?:^|\s)-w\s+(\S+)/);
  return match ? match[1] : null;
}

export function isPhase32hCaptureProcess(command = '') {
  if (!CAPTURE_RE.test(command)) return false;
  const root = resolveEvidenceRootFromCommand(command);
  if (root?.startsWith('/tmp/phase32h')) return true;
  return PHASE32H_RE.test(command) && CAPTURE_RE.test(command);
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
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      lstart,
      etime,
      command: args,
      evidence_root: resolveEvidenceRootFromCommand(args),
      interface: resolveCaptureInterface(args),
      output_path: resolvePcapOutputPath(args),
      role: CAPTURE_RE.test(args) ? 'pcap_collector' : null,
    });
  }
  return rows;
}

export function listPhase32hCaptureProcesses() {
  return listProcessesWide().filter((p) => isPhase32hCaptureProcess(p.command));
}
