#!/usr/bin/env node
/**
 * Read-only PCAP stats helper — no node -e / --print ESM eval.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { latestPcapFile } from './lib/phase32h-triplet-probe-packet-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { out: null, json: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    if (argv[i] === '--text') opts.json = false;
  }
  if (!opts.out) throw new Error('--out required');
  return opts;
}

function count443(pcapPath, transport) {
  const script =
    transport === 'udp'
      ? `phase32h_pcap_udp_443_count "${pcapPath}"`
      : `phase32h_pcap_tcp_443_count "${pcapPath}"`;
  const result = spawnSync(
    'bash',
    ['-lc', `source "${REPO_ROOT}/scripts/lib/phase32h-pcap-chmodbpf.sh"; ${script}`],
    { encoding: 'utf8' },
  );
  return Number((result.stdout || '').trim() || 0);
}

function pcapPacketStats(pcapPath) {
  const stats = {
    file: pcapPath,
    bytes: fs.statSync(pcapPath).size,
    packets: null,
    drops: null,
    first_frame_ts: null,
    last_frame_ts: null,
    tcp_443_packets: count443(pcapPath, 'tcp'),
    udp_443_packets: count443(pcapPath, 'udp'),
  };
  if (spawnSync('which', ['capinfos']).status === 0) {
    const cap = spawnSync('capinfos', ['-c', '-s', pcapPath], { encoding: 'utf8' });
    const countMatch = (cap.stdout || '').match(/Number of packets:\s*(\d+)/);
    if (countMatch) stats.packets = Number(countMatch[1]);
  }
  if (spawnSync('which', ['tshark']).status === 0) {
    const frames = spawnSync(
      'tshark',
      ['-r', pcapPath, '-T', 'fields', '-e', 'frame.number', '-e', 'frame.time_epoch'],
      { encoding: 'utf8' },
    );
    const lines = (frames.stdout || '').split('\n').filter(Boolean);
    if (lines.length) {
      stats.packets = lines.length;
      const first = lines[0].split('\t');
      const last = lines[lines.length - 1].split('\t');
      stats.first_frame_ts = first[1] ? new Date(Number(first[1]) * 1000).toISOString() : null;
      stats.last_frame_ts = last[1] ? new Date(Number(last[1]) * 1000).toISOString() : null;
    }
    const quic = spawnSync('tshark', ['-r', pcapPath, '-Y', 'quic', '-T', 'fields', '-e', 'quic.version'], {
      encoding: 'utf8',
    });
    stats.quic_versions = [...new Set((quic.stdout || '').split('\n').map((v) => v.trim()).filter(Boolean))];
  }
  const dumpcapLog = path.join(path.dirname(pcapPath), 'dumpcap.log');
  if (fs.existsSync(dumpcapLog)) {
    const text = fs.readFileSync(dumpcapLog, 'utf8');
    const dropMatch = text.match(/dropped:\s*(\d+)/i);
    if (dropMatch) stats.drops = Number(dropMatch[1]);
  }
  return stats;
}

export function collectPcapStats(outRoot) {
  const pcapPath = latestPcapFile(outRoot);
  if (!pcapPath) {
    return { status: 'BLOCKED', reason: 'no pcap file', files: [] };
  }
  const stats = pcapPacketStats(pcapPath);
  return { status: 'PASS', files: [stats] };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const payload = collectPcapStats(opts.out);
  const text = JSON.stringify(payload, null, 2);
  if (opts.json) console.log(text);
  else process.stdout.write(`${text}\n`);
  process.exit(payload.status === 'PASS' ? 0 : 2);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entry && path.resolve(fileURLToPath(import.meta.url)) === entry) {
  main();
}
