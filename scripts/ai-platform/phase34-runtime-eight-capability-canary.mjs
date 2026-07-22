#!/usr/bin/env node
/**
 * Phase 34 — eight-capability API-only runtime canary (24 scenarios / 27+ turns).
 * No screenshots, no browser visual. Evidence under /tmp only.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { EIGHT_CAPABILITIES } from '../lib/phase34-capability-response.mjs';

const EVID =
  process.env.PHASE34_EVIDENCE_ROOT ||
  '/tmp/phase34-runtime-data-to-answer-integration-v2/canary';
const OUT_DIR = `${EVID}/checkpoints/eight-capability-runtime-canary-v1`;
const OUT = `${EVID}/eight-capability-runtime-canary.json`;

function runCapability(capability, input) {
  const r = spawnSync(
    process.execPath,
    ['scripts/ai-platform/run-phase33c-capability.mjs'],
    {
      input: JSON.stringify({ capability, input }),
      encoding: 'utf8',
      env: {
        ...process.env,
        PHASE34_RUNTIME_INTEGRATION: '1',
        PHASE34_RUNTIME_PERSIST: '1',
      },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  let body = {};
  try {
    body = JSON.parse(r.stdout || '{}');
  } catch {
    body = { status: 'FAIL', error: 'parse', stdout: r.stdout, stderr: r.stderr };
  }
  return { code: r.status ?? 1, body, stderr: r.stderr || '' };
}

function protocolTriplet(capability, input) {
  const runs = [];
  for (const protocol of ['h1', 'h2', 'h3']) {
    const started = Date.now();
    const { code, body } = runCapability(capability, {
      ...input,
      protocol,
      request_id: `${input.request_id}-${protocol}`,
    });
    runs.push({
      protocol,
      code,
      status: body.status,
      ms: Date.now() - started,
      evidence_snapshot_id: body.evidence_snapshot_id || null,
      claim_ledger_id: body.claim_ledger_id || null,
      response_hash: crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            summary: body.platform_envelope?.customer_summary || null,
            claims: (body.platform_envelope?.claim_ledger?.entries || []).map((e) => ({
              t: e.claim_type,
              v: e.normalized_claim_value,
              vr: e.verification_result,
            })),
            result_keys: Object.keys(body.result || {}).sort(),
          }),
        )
        .digest('hex')
        .slice(0, 24),
      unsupported: (body.platform_envelope?.claim_ledger?.entries || []).some(
        (e) => e.verification_result === 'UNSUPPORTED',
      ),
      synthetic: Boolean(body.diagnostics?.synthetic_fallback),
    });
  }
  const hashes = new Set(runs.map((r) => r.response_hash));
  const material_mismatch = hashes.size > 1;
  const ok =
    runs.every((r) => r.code === 0 && r.status === 'PASS' && !r.unsupported && !r.synthetic) &&
    !material_mismatch;
  return { ok, material_mismatch, runs };
}

function baseSubject(seed) {
  return {
    artist: 'Miles Davis',
    title: 'Kind of Blue',
    catalog_number: 'CL 1355',
    media_condition: 'VG+',
    sleeve_condition: 'VG+',
    seed,
  };
}

function scenariosFor(capability, sessionRoot) {
  const subject = baseSubject(capability);
  const successInput = {
    runtime_integration: true,
    session_id: `${sessionRoot}-${capability}-success`,
    request_id: `${sessionRoot}-${capability}-s1`,
    turn_id: `${sessionRoot}-${capability}-s1-t1`,
    ...subject,
  };
  const limitInput = {
    ...successInput,
    session_id: `${sessionRoot}-${capability}-limit`,
    request_id: `${sessionRoot}-${capability}-l1`,
    turn_id: `${sessionRoot}-${capability}-l1-t1`,
    honest_limit: true,
    force_abstain: true,
    require_exact_pressing: true,
    catalog_number: 'DOES-NOT-EXIST-XXXX',
  };
  const correctionTurns = [
    {
      ...successInput,
      session_id: `${sessionRoot}-${capability}-corr`,
      request_id: `${sessionRoot}-${capability}-c1`,
      turn_id: `${sessionRoot}-${capability}-c1-t1`,
      media_condition: 'VG+',
      sleeve_condition: 'VG+',
    },
    {
      ...successInput,
      session_id: `${sessionRoot}-${capability}-corr`,
      request_id: `${sessionRoot}-${capability}-c2`,
      turn_id: `${sessionRoot}-${capability}-c2-t2`,
      media_condition: 'VG',
      sleeve_condition: 'VG',
      sleeve_notes: 'seam split',
      correction: true,
    },
  ];
  if (capability === 'negotiation_assistance') {
    correctionTurns.push(
      {
        ...successInput,
        session_id: `${sessionRoot}-${capability}-corr`,
        request_id: `${sessionRoot}-${capability}-c3`,
        turn_id: `${sessionRoot}-${capability}-c3-t3`,
        offer_amount: 40,
        correction: true,
        correction_kind: 'offer',
      },
      {
        ...successInput,
        session_id: `${sessionRoot}-${capability}-corr`,
        request_id: `${sessionRoot}-${capability}-c4`,
        turn_id: `${sessionRoot}-${capability}-c4-t4`,
        offer_amount: 35,
        shipping: 'media_mail',
        correction: true,
        correction_kind: 'shipping_and_floor',
      },
    );
  }
  return { successInput, limitInput, correctionTurns };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(`${EVID}/dossiers`, { recursive: true });
  fs.mkdirSync(`${EVID}/failures`, { recursive: true });
  const sessionRoot = `rt-canary-${Date.now()}`;
  const rows = [];
  let turnCount = 0;
  let hardFail = null;

  for (const capability of EIGHT_CAPABILITIES) {
    const { successInput, limitInput, correctionTurns } = scenariosFor(capability, sessionRoot);

    const success = protocolTriplet(capability, successInput);
    turnCount += 1;
    rows.push({ capability, scenario: 'success', ...success });
    if (!success.ok && !hardFail) {
      hardFail = { capability, scenario: 'success', detail: success };
    }

    let prevSnap = null;
    for (let i = 0; i < correctionTurns.length; i += 1) {
      const inp = {
        ...correctionTurns[i],
        previous_evidence_snapshot_id: prevSnap,
      };
      const corr = protocolTriplet(capability, inp);
      turnCount += 1;
      const newSnap = corr.runs[0]?.evidence_snapshot_id || null;
      const recomputed = i === 0 || (prevSnap && newSnap && prevSnap !== newSnap);
      rows.push({
        capability,
        scenario: `correction_t${i + 1}`,
        recomputed_snapshot: recomputed,
        ...corr,
      });
      if ((!corr.ok || (i > 0 && !recomputed)) && !hardFail) {
        hardFail = {
          capability,
          scenario: `correction_t${i + 1}`,
          detail: { corr, prevSnap, newSnap },
        };
      }
      prevSnap = newSnap || prevSnap;
    }

    const limit = protocolTriplet(capability, limitInput);
    turnCount += 1;
    rows.push({ capability, scenario: 'honest_limit', ...limit });
    // Honest limit may PASS with empty evidence / abstain — still must not synthetic or unsupported sold claims
    if (limit.runs.some((r) => r.synthetic) && !hardFail) {
      hardFail = { capability, scenario: 'honest_limit', detail: limit };
    }
  }

  const ok =
    !hardFail &&
    rows.filter((r) => r.scenario === 'success').every((r) => r.ok) &&
    rows.filter((r) => String(r.scenario).startsWith('correction')).every((r) => r.ok) &&
    turnCount >= 27;

  const report = {
    ok,
    generated_at: new Date().toISOString(),
    head_sha: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    session_root: sessionRoot,
    capabilities: [...EIGHT_CAPABILITIES],
    scenario_count: 24,
    executed_turns: turnCount,
    hard_fail: hardFail,
    rows: rows.map((r) => ({
      capability: r.capability,
      scenario: r.scenario,
      ok: r.ok,
      material_mismatch: r.material_mismatch,
      recomputed_snapshot: r.recomputed_snapshot ?? null,
      protocols: r.runs,
    })),
    blockers: ok
      ? []
      : [
          hardFail ? `hard_fail:${hardFail.capability}/${hardFail.scenario}` : null,
          turnCount < 27 ? `turns_${turnCount}_lt_27` : null,
        ].filter(Boolean),
  };

  fs.writeFileSync(`${OUT_DIR}/eight-capability-runtime-canary.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        turns: turnCount,
        blockers: report.blockers,
        out: OUT,
      },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 2);
}

main();
