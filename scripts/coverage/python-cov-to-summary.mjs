#!/usr/bin/env node
/**
 * Convert pytest-cov coverage.json (coverage.py format) to Vitest-compatible coverage-summary.json.
 *
 * Usage: node scripts/coverage/python-cov-to-summary.mjs <input.json> <output.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: python-cov-to-summary.mjs <coverage.json> <coverage-summary.json>");
  process.exit(2);
}

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const totals = raw.totals || {};

const linesPct =
  typeof totals.percent_covered === "number"
    ? totals.percent_covered
    : totals.num_statements > 0
      ? (100 * totals.covered_lines) / totals.num_statements
      : 100;

const stmtPct =
  typeof totals.percent_statements_covered === "number"
    ? totals.percent_statements_covered
    : linesPct;

function axis(totalKey, coveredKey, pct) {
  const total = totals[totalKey] ?? 0;
  const covered = totals[coveredKey] ?? 0;
  return {
    total,
    covered,
    skipped: 0,
    pct: Math.round(pct * 100) / 100,
  };
}

const summary = {
  total: {
    lines: axis("num_statements", "covered_lines", linesPct),
    statements: axis("num_statements", "covered_lines", stmtPct),
    functions: {
      total: totals.num_functions ?? 0,
      covered: totals.covered_functions ?? 0,
      skipped: 0,
      pct:
        totals.num_functions > 0
          ? Math.round((100 * totals.covered_functions) / totals.num_functions * 100) / 100
          : 100,
    },
    branches: {
      total: totals.num_branches ?? 0,
      covered: totals.covered_branches ?? 0,
      skipped: 0,
      pct:
        totals.num_branches > 0
          ? Math.round((100 * totals.covered_branches) / totals.num_branches * 100) / 100
          : 100,
    },
  },
  meta: {
    generator: "python-cov-to-summary.mjs",
    source: inputPath,
  },
};

writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.error(`python-cov-to-summary: lines ${summary.total.lines.pct}% → ${outputPath}`);
