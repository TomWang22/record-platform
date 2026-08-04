#!/usr/bin/env node
/**
 * Gate 5 Path/JSON/JSONL harness integrity regressions (10 cases).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const LIB = path.join(REPO, "scripts/lib/gate5_json_io.py");

function py(code, env = {}) {
  const r = spawnSync("python3", ["-c", code], {
    cwd: REPO,
    env: { ...process.env, PYTHONPATH: path.join(REPO, "scripts/lib"), ...env },
    encoding: "utf8",
  });
  return r;
}

function pyOk(code) {
  const r = py(code);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}

function pyFail(code) {
  const r = py(code);
  assert.notEqual(r.status, 0, "expected non-zero exit");
  return (r.stderr || r.stdout).trim();
}

describe("gate5 path/json/jsonl integrity", () => {
  it("1 Path input loads successfully", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g5json-"));
    const f = path.join(dir, "ok.json");
    fs.writeFileSync(f, JSON.stringify({ a: 1, unicode: "café\t\n\"quote\"" }));
    const out = pyOk(`
from pathlib import Path
from gate5_json_io import load_json
d=load_json(Path(${JSON.stringify(f)}))
assert d["a"]==1
assert "café" in d["unicode"]
print("ok")
`);
    assert.equal(out, "ok");
  });

  it("2 empty files fail with explicit classification", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g5json-"));
    const f = path.join(dir, "empty.json");
    fs.writeFileSync(f, "");
    const err = pyFail(`
from pathlib import Path
from gate5_json_io import load_json
load_json(Path(${JSON.stringify(f)}))
`);
    assert.match(err, /JSON_EMPTY/);
  });

  it("3 truncated JSON fails with explicit classification", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g5json-"));
    const f = path.join(dir, "trunc.json");
    fs.writeFileSync(f, '{"a":');
    const err = pyFail(`
from pathlib import Path
from gate5_json_io import load_json
load_json(Path(${JSON.stringify(f)}))
`);
    assert.match(err, /JSON_TRUNCATED_OR_INVALID/);
  });

  it("4 JSONL reads every physical row independently", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g5json-"));
    const f = path.join(dir, "rows.jsonl");
    fs.writeFileSync(f, '{"n":1}\n{"n":2}\n{"n":3}\n');
    const out = pyOk(`
from pathlib import Path
from gate5_json_io import load_jsonl
rows=load_jsonl(Path(${JSON.stringify(f)}))
assert [r["n"] for r in rows]==[1,2,3]
print(len(rows))
`);
    assert.equal(out, "3");
  });

  it("5 malformed row cannot silently remove later rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g5json-"));
    const f = path.join(dir, "bad.jsonl");
    fs.writeFileSync(f, '{"n":1}\nNOT_JSON\n{"n":3}\n');
    const err = pyFail(`
from pathlib import Path
from gate5_json_io import load_jsonl
load_jsonl(Path(${JSON.stringify(f)}))
`);
    assert.match(err, /JSONL_ROW_MALFORMED/);
    assert.match(err, /later rows must not be silently dropped/);
  });

  it("6 output writes are atomic temp→fsync→rename", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g5json-"));
    const f = path.join(dir, "out.json");
    pyOk(`
from pathlib import Path
from gate5_json_io import dump_json_atomic, load_json
p=Path(${JSON.stringify(f)})
dump_json_atomic(p, {"ok": True, "q": 'he said "hi"'})
d=load_json(p)
assert d["ok"] is True
assert '"' in d["q"]
# no leftover tmp
import os
tmps=[n for n in os.listdir(p.parent) if n.endswith('.tmp')]
assert tmps==[], tmps
print("atomic")
`);
  });

  it("7 no partial report may be classified PASS", () => {
    const out = pyOk(`
from gate5_json_io import freeze_diagnostic_blocked, load_json
from pathlib import Path
import tempfile, os
root=Path(tempfile.mkdtemp())
p=freeze_diagnostic_blocked(root, reason="REPORT_GENERATION_FAILURE", details={"partial": True})
d=load_json(p)
assert d["terminal_state"]=="FROZEN_BLOCKED_EVIDENCE"
assert d["gate5_final_pass"] is False
assert d.get("pass") is not True
print("blocked")
`);
    assert.equal(out, "blocked");
  });

  it("8 Unicode, tabs, newlines, and quotes remain valid JSON", () => {
    const out = pyOk(`
from gate5_json_io import dump_json_atomic, load_json, dump_jsonl_atomic, load_jsonl
from pathlib import Path
import tempfile
d=Path(tempfile.mkdtemp())
payload={"u":"日本語","t":"a\\tb","n":"x\\ny","q":"say \\"hi\\""}
dump_json_atomic(d/"a.json", payload)
assert load_json(d/"a.json")==payload
dump_jsonl_atomic(d/"a.jsonl", [payload, {"n":2}])
rows=load_jsonl(d/"a.jsonl")
assert rows[0]==payload
print("unicode_ok")
`);
    assert.equal(out, "unicode_ok");
  });

  it("9 every matrix row retains stdout, stderr, exit code, and timeout status", () => {
    const out = pyOk(`
from gate5_json_io import require_matrix_evidence_fields, Gate5JsonError
row={
  "stdout":"ApiVersion",
  "stderr":"",
  "exit_code":0,
  "timeout":False,
}
require_matrix_evidence_fields(row, ["stdout","stderr","exit_code","timeout"])
try:
  require_matrix_evidence_fields({"stdout":"x"}, ["stdout","stderr","exit_code","timeout"])
  raise SystemExit("should have failed")
except Gate5JsonError as e:
  assert e.classification=="MATRIX_ROW_EVIDENCE_INCOMPLETE"
print("evidence_ok")
`);
    assert.equal(out, "evidence_ok");
  });

  it("10 report generation failure freezes the diagnostic root BLOCKED", () => {
    const out = pyOk(`
from gate5_json_io import freeze_diagnostic_blocked, load_json
from pathlib import Path
import tempfile
root=Path(tempfile.mkdtemp(prefix="g5-diag-"))
freeze_diagnostic_blocked(root, reason="HARNESS_REPORTING_FAILURE")
d=load_json(root/"FROZEN_BLOCKED_EVIDENCE.json")
assert d["terminal_state"]=="FROZEN_BLOCKED_EVIDENCE"
assert d["v10_created"] is False
print("freeze_ok")
`);
    assert.equal(out, "freeze_ok");
  });
});

// sanity: library file exists
assert.ok(fs.existsSync(LIB));
