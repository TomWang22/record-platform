/**
 * Phase 23C — dry-run replay resume/checkpoint validation (no network).
 * Mirrors Phase 22H–J checkpoint/resume semantics without live inference.
 */
import fs from 'node:fs';
import path from 'node:path';

export class ReplayResumeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReplayResumeValidationError';
  }
}

export function fail(message) {
  throw new ReplayResumeValidationError(message);
}

export function loadJsonlRows(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const rows = [];
  const seen = new Set();
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      fail(`corrupt JSONL line ${i + 1} in ${filePath}`);
    }
    if (typeof row.probe_id !== 'number') {
      fail(`missing probe_id on JSONL line ${i + 1} in ${filePath}`);
    }
    if (seen.has(row.probe_id)) {
      fail(`duplicate probe_id ${row.probe_id} in ${filePath}`);
    }
    seen.add(row.probe_id);
    rows.push(row);
  }
  return rows;
}

export function loadCompletedRows({ mainJsonl, batchDir, resume }) {
  const byProbe = new Map();
  const sources = [];
  if (resume && mainJsonl && fs.existsSync(mainJsonl)) sources.push(mainJsonl);
  if (resume && batchDir && fs.existsSync(batchDir)) {
    for (const name of fs.readdirSync(batchDir)) {
      if (name.endsWith('.jsonl')) sources.push(path.join(batchDir, name));
    }
  }
  for (const file of sources) {
    for (const row of loadJsonlRows(file)) {
      byProbe.set(row.probe_id, row);
    }
  }
  return [...byProbe.values()].sort((a, b) => a.probe_id - b.probe_id);
}

export function readCheckpoint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail(`corrupt checkpoint JSON in ${filePath}`);
  }
  return parsed;
}

export function validateCheckpoint(checkpoint, { protocol, phase }) {
  if (!checkpoint || typeof checkpoint !== 'object') {
    fail('checkpoint missing or invalid');
  }
  if (checkpoint.protocol !== protocol) {
    fail(`wrong protocol in checkpoint: ${checkpoint.protocol} != ${protocol}`);
  }
  if (checkpoint.phase !== phase) {
    fail(`wrong phase in checkpoint: ${checkpoint.phase} != ${phase}`);
  }
  if (typeof checkpoint.last_probe_id !== 'number') {
    fail('checkpoint missing numeric last_probe_id');
  }
  if (!Array.isArray(checkpoint.completed_batches)) {
    fail('checkpoint missing completed_batches array');
  }
}

export function completedProbeIds(completedRows) {
  return new Set(completedRows.map((row) => row.probe_id));
}

export function computeRemainingProbes(manifest, completedRows) {
  const done = completedProbeIds(completedRows);
  return manifest.filter((row) => !done.has(row.probe_id));
}

export function effectiveLastProbeId(checkpoint, completedRows) {
  const jsonlMax = completedRows.length
    ? Math.max(...completedRows.map((row) => row.probe_id))
    : 0;
  const checkpointMax = checkpoint?.last_probe_id ?? 0;
  return Math.max(jsonlMax, checkpointMax);
}

export function completedBatchIds(completedRows) {
  return [...new Set(completedRows.map((row) => row.batch_id))];
}

export function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

export function writeCheckpoint(filePath, checkpoint) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

export function makeProbeRow({ probe_id, batch_id, protocol = 'h2', phase = '22I' }) {
  return {
    probe_id,
    batch_id,
    protocol,
    phase,
    response_pass: 'PASS',
    timestamp: new Date().toISOString(),
  };
}

export function makeManifest(rows) {
  return rows.map((row) => ({
    probe_id: row.probe_id,
    batch_id: row.batch_id,
    window: 1,
    run: 1,
    case_id: 'listing_advice',
    question: 'dry-run probe',
    user_uid: '00000000-0000-4000-8000-000000000001',
    expected_gate_reason: 'allowlist',
  }));
}

export function assertForbiddenSourceAbsent(sourceText) {
  const forbidden = [
    /\bcurlRequest\b/,
    /\bragQuery\b/,
    /\blogin\s*\(/,
    /\/api\/ai\/rag\/query/,
    /\/api\/auth\/login/,
    /spawnSync\(\s*['"]curl['"]/,
    /spawnSync\(\s*['"]kubectl['"]/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(sourceText)) {
      fail(`forbidden live-operation pattern detected: ${pattern}`);
    }
  }
}

export function runValidationCase(name, fn) {
  try {
    fn();
    return { name, status: 'PASS' };
  } catch (error) {
    return {
      name,
      status: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runExpectFailureCase(name, fn) {
  try {
    fn();
    return { name, status: 'FAIL', error: 'expected failure but case passed' };
  } catch (error) {
    if (!(error instanceof ReplayResumeValidationError)) {
      return { name, status: 'FAIL', error: `unexpected error type: ${error}` };
    }
    return { name, status: 'PASS' };
  }
}

export function buildDryRunCases(fixtureRoot) {
  const protocol = 'h2';
  const phase = '22I';
  const manifest = makeManifest([
    { probe_id: 1, batch_id: 'BATCH-A' },
    { probe_id: 2, batch_id: 'BATCH-A' },
    { probe_id: 3, batch_id: 'BATCH-A' },
    { probe_id: 4, batch_id: 'BATCH-B' },
    { probe_id: 5, batch_id: 'BATCH-B' },
    { probe_id: 6, batch_id: 'BATCH-B' },
    { probe_id: 7, batch_id: 'BATCH-C' },
    { probe_id: 8, batch_id: 'BATCH-C' },
  ]);

  function caseDir(name) {
    const dir = path.join(fixtureRoot, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    fs.mkdirSync(dir, { recursive: true });
    return {
      mainJsonl: path.join(dir, 'main.jsonl'),
      batchDir: path.join(dir, 'batches'),
      checkpointPath: path.join(dir, 'checkpoint.json'),
    };
  }

  return [
    {
      name: 'fresh manifest no checkpoint runs all rows',
      run() {
        const { mainJsonl, batchDir } = caseDir('fresh');
        const completed = loadCompletedRows({ mainJsonl, batchDir, resume: true });
        const remaining = computeRemainingProbes(manifest, completed);
        if (remaining.length !== manifest.length) {
          fail(`expected ${manifest.length} remaining, got ${remaining.length}`);
        }
      },
    },
    {
      name: 'half-complete main JSONL skips completed probes',
      run() {
        const { mainJsonl, batchDir } = caseDir('half-main');
        writeJsonl(mainJsonl, [
          makeProbeRow({ probe_id: 1, batch_id: 'BATCH-A', protocol, phase }),
          makeProbeRow({ probe_id: 2, batch_id: 'BATCH-A', protocol, phase }),
          makeProbeRow({ probe_id: 3, batch_id: 'BATCH-A', protocol, phase }),
          makeProbeRow({ probe_id: 4, batch_id: 'BATCH-B', protocol, phase }),
        ]);
        const completed = loadCompletedRows({ mainJsonl, batchDir, resume: true });
        const remaining = computeRemainingProbes(manifest, completed);
        if (remaining.length !== 4 || remaining[0].probe_id !== 5) {
          fail(`expected remaining probes 5-8, got ${remaining.map((r) => r.probe_id).join(',')}`);
        }
      },
    },
    {
      name: 'per-batch JSONL complete skips that batch',
      run() {
        const { mainJsonl, batchDir } = caseDir('per-batch');
        fs.mkdirSync(batchDir, { recursive: true });
        writeJsonl(path.join(batchDir, 'BATCH-A.jsonl'), [
          makeProbeRow({ probe_id: 1, batch_id: 'BATCH-A', protocol, phase }),
          makeProbeRow({ probe_id: 2, batch_id: 'BATCH-A', protocol, phase }),
          makeProbeRow({ probe_id: 3, batch_id: 'BATCH-A', protocol, phase }),
        ]);
        const completed = loadCompletedRows({ mainJsonl, batchDir, resume: true });
        const remaining = computeRemainingProbes(manifest, completed);
        if (remaining.length !== 5 || remaining[0].probe_id !== 4) {
          fail(`expected remaining from batch B/C, got ${remaining.map((r) => r.probe_id).join(',')}`);
        }
      },
    },
    {
      name: 'checkpoint last_probe_id behind JSONL jsonl wins',
      run() {
        const { mainJsonl, batchDir, checkpointPath } = caseDir('checkpoint-behind');
        writeJsonl(mainJsonl, Array.from({ length: 8 }, (_, i) =>
          makeProbeRow({ probe_id: i + 1, batch_id: i < 3 ? 'BATCH-A' : i < 6 ? 'BATCH-B' : 'BATCH-C', protocol, phase }),
        ));
        writeCheckpoint(checkpointPath, {
          protocol,
          phase,
          last_probe_id: 5,
          probes_completed: 5,
          completed_batches: ['BATCH-A', 'BATCH-B'],
          updated_at: new Date().toISOString(),
        });
        const completed = loadCompletedRows({ mainJsonl, batchDir, resume: true });
        const checkpoint = readCheckpoint(checkpointPath);
        validateCheckpoint(checkpoint, { protocol, phase });
        const effective = effectiveLastProbeId(checkpoint, completed);
        if (effective !== 8) fail(`expected effective last_probe_id 8, got ${effective}`);
        const remaining = computeRemainingProbes(manifest, completed);
        if (remaining.length !== 0) fail(`expected 0 remaining, got ${remaining.length}`);
      },
    },
    {
      name: 'completed manifest runs zero remaining rows',
      run() {
        const { mainJsonl, batchDir } = caseDir('completed');
        writeJsonl(
          mainJsonl,
          manifest.map((row) => makeProbeRow({ probe_id: row.probe_id, batch_id: row.batch_id, protocol, phase })),
        );
        const completed = loadCompletedRows({ mainJsonl, batchDir, resume: true });
        const remaining = computeRemainingProbes(manifest, completed);
        if (remaining.length !== 0) fail(`expected 0 remaining rows, got ${remaining.length}`);
      },
    },
    {
      name: 'duplicate probe_id in JSONL fails',
      expectFailure: true,
      run() {
        const { mainJsonl } = caseDir('duplicate');
        fs.writeFileSync(
          mainJsonl,
          `${JSON.stringify(makeProbeRow({ probe_id: 1, batch_id: 'BATCH-A', protocol, phase }))}\n${JSON.stringify(makeProbeRow({ probe_id: 1, batch_id: 'BATCH-A', protocol, phase }))}\n`,
        );
        loadJsonlRows(mainJsonl);
      },
    },
    {
      name: 'wrong protocol in checkpoint fails',
      expectFailure: true,
      run() {
        const { checkpointPath } = caseDir('wrong-protocol');
        writeCheckpoint(checkpointPath, {
          protocol: 'h3',
          phase,
          last_probe_id: 1,
          probes_completed: 1,
          completed_batches: ['BATCH-A'],
          updated_at: new Date().toISOString(),
        });
        validateCheckpoint(readCheckpoint(checkpointPath), { protocol, phase });
      },
    },
    {
      name: 'wrong phase in checkpoint fails',
      expectFailure: true,
      run() {
        const { checkpointPath } = caseDir('wrong-phase');
        writeCheckpoint(checkpointPath, {
          protocol,
          phase: '22J',
          last_probe_id: 1,
          probes_completed: 1,
          completed_batches: ['BATCH-A'],
          updated_at: new Date().toISOString(),
        });
        validateCheckpoint(readCheckpoint(checkpointPath), { protocol, phase });
      },
    },
    {
      name: 'corrupt JSONL line fails',
      expectFailure: true,
      run() {
        const { mainJsonl } = caseDir('corrupt-jsonl');
        fs.writeFileSync(mainJsonl, '{not-json}\n');
        loadJsonlRows(mainJsonl);
      },
    },
    {
      name: 'corrupt checkpoint JSON fails',
      expectFailure: true,
      run() {
        const { checkpointPath } = caseDir('corrupt-checkpoint');
        fs.writeFileSync(checkpointPath, '{bad checkpoint');
        readCheckpoint(checkpointPath);
      },
    },
  ];
}

export function runDryRunValidation({ fixtureRoot }) {
  const cases = buildDryRunCases(fixtureRoot);
  const results = cases.map((testCase) =>
    testCase.expectFailure ? runExpectFailureCase(testCase.name, testCase.run) : runValidationCase(testCase.name, testCase.run),
  );
  const failed = results.filter((result) => result.status !== 'PASS');
  return { results, failed };
}
