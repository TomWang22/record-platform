#!/usr/bin/env node
/**
 * Emit stable workflow/job inventory from .github/workflows for CI drift detection.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = path.join(REPO_ROOT, '.github/workflows');

function parseJobs(yamlText, workflowFile) {
  const jobs = [];
  const lines = yamlText.split('\n');
  let inJobs = false;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (inJobs) {
      const m = line.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
      if (m && !line.startsWith('    ')) {
        jobs.push({
          workflow_file: workflowFile,
          job_id: m[1],
          stable_id: `${workflowFile}#${m[1]}`,
        });
      } else if (line && !line.startsWith(' ') && !line.startsWith('#')) {
        break;
      }
    }
  }
  return jobs;
}

const inventory = [];
for (const file of fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort()) {
  const text = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
  inventory.push(...parseJobs(text, file));
}

const out = {
  generated_at: new Date().toISOString(),
  workflow_job_count: inventory.length,
  jobs: inventory,
};

const outPath = path.join(REPO_ROOT, 'docs/ci/EXPECTED_CHECK_INVENTORY.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outPath} workflow_job_count=${inventory.length}`);
