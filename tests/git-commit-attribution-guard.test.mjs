#!/usr/bin/env node
/**
 * Owner-only commit attribution guard.
 * Rejects Cursor / agent trailers; does not inject any trailer.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const HOOK = path.join(REPO_ROOT, "scripts/git-hooks/commit-msg");

function runHook(message) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-commit-msg-"));
  const msgPath = path.join(dir, "COMMIT_EDITMSG");
  fs.writeFileSync(msgPath, message, "utf8");
  const res = spawnSync("bash", [HOOK, msgPath], {
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    message: fs.readFileSync(msgPath, "utf8"),
  };
}

describe("git commit attribution guard", () => {
  it("leaves a normal owner message byte-for-byte unchanged and accepts it", () => {
    const msg =
      "fix(runtime): extract gRPC peer identity from TLS cert and complete DENY\n\n" +
      "Gate 3 froze on empty AuthContext map lookups and hung denials.\n";
    const res = runHook(msg);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.message, msg);
    assert.equal(res.message.includes("Co-authored-by"), false);
    assert.equal(/cursor/i.test(res.message), false);
  });

  it("rejects Co-authored-by Cursor trailer", () => {
    const msg =
      "fix(runtime): example\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n";
    const res = runHook(msg);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /forbidden Cursor attribution/i);
  });

  it("rejects Generated-by / Assisted-by / Signed-off-by / on-behalf-of Cursor", () => {
    const variants = [
      "x\n\nGenerated-by: Cursor\n",
      "x\n\nAssisted-by: Cursor Agent\n",
      "x\n\nSigned-off-by: Cursor <cursoragent@cursor.com>\n",
      "x\n\non-behalf-of: Cursor <noreply@cursor.com>\n",
    ];
    for (const msg of variants) {
      const res = runHook(msg);
      assert.notEqual(res.status, 0, msg);
    }
  });

  it("does not inject trailers into an accepted message", () => {
    const msg = "chore: owner only\n";
    const res = runHook(msg);
    assert.equal(res.status, 0);
    assert.equal(res.message, msg);
  });
});
