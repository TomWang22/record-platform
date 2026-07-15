import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { validateIntelligenceCapabilityContracts } from '../scripts/lib/phase33a-intelligence-capability-contracts.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PACKAGE = path.join(REPO_ROOT, 'scripts/ai-platform');
const VERIFY_CLI = path.join(SRC_PACKAGE, 'verify-intelligence-capability-contracts.mjs');

let tmpRoot;
let packageRoot;

function readMatrix() {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'intelligence-capability-matrix.json'), 'utf8'),
  );
}

function writeMatrix(matrix) {
  fs.writeFileSync(
    path.join(packageRoot, 'intelligence-capability-matrix.json'),
    `${JSON.stringify(matrix, null, 2)}\n`,
  );
}

function validate() {
  return validateIntelligenceCapabilityContracts(REPO_ROOT, {
    packageRoot,
    docsRoots: [],
  });
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase33a-contracts-'));
  packageRoot = path.join(tmpRoot, 'ai-platform');
  fs.cpSync(SRC_PACKAGE, packageRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('phase33a intelligence capability contracts', () => {
  it('valid complete package', () => {
    const report = validateIntelligenceCapabilityContracts(REPO_ROOT);
    assert.equal(report.status, 'PASS', report.violations.join('\n'));
    assert.equal(report.capability_count, 8);
    assert.ok(report.schema_count >= 14);
    assert.ok(report.scenario_preview_count >= 24);
    assert.deepEqual(report.duplicate_matrix_files, []);
  });

  it('CLI emits JSON on stdout and exits 0 for valid package', () => {
    const result = spawnSync(process.execPath, [VERIFY_CLI], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'PASS');
  });

  it('missing capability', () => {
    const matrix = readMatrix();
    matrix.capabilities = matrix.capabilities.filter((c) => c.capability_id !== 'scarcity');
    writeMatrix(matrix);
    const report = validate();
    assert.equal(report.status, 'FAIL');
    assert.ok(report.violations.some((v) => v === 'missing_capability:scarcity'));
  });

  it('duplicate capability ID', () => {
    const matrix = readMatrix();
    matrix.capabilities.push({ ...matrix.capabilities[0] });
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.includes('duplicate_capability_id'));
  });

  it('unknown capability ID', () => {
    const matrix = readMatrix();
    matrix.capabilities[0].capability_id = 'not_a_capability';
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('unknown_capability_id:')));
  });

  it('missing schema', () => {
    const matrix = readMatrix();
    const cap = matrix.capabilities.find((c) => c.capability_id === 'valuation');
    fs.rmSync(path.join(packageRoot, cap.output_schema));
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('missing_schema:valuation:')));
  });

  it('duplicate schema $id', () => {
    const a = path.join(packageRoot, 'intelligence-output-schemas/scarcity.schema.json');
    const b = path.join(packageRoot, 'intelligence-output-schemas/valuation.schema.json');
    const schemaA = JSON.parse(fs.readFileSync(a, 'utf8'));
    const schemaB = JSON.parse(fs.readFileSync(b, 'utf8'));
    schemaB.$id = schemaA.$id;
    fs.writeFileSync(b, `${JSON.stringify(schemaB, null, 2)}\n`);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('duplicate_schema_$id:')));
  });

  it('invalid schema', () => {
    const file = path.join(packageRoot, 'intelligence-output-schemas/scarcity.schema.json');
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete schema.$schema;
    delete schema.properties;
    fs.writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    const report = validate();
    assert.ok(report.violations.some((v) => v.includes('schema_missing')));
  });

  it('missing evidence field', () => {
    const file = path.join(packageRoot, 'intelligence-output-schemas/scarcity.schema.json');
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete schema.properties.evidence;
    schema.required = schema.required.filter((k) => k !== 'evidence');
    fs.writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('missing_evidence_')));
  });

  it('missing confidence field', () => {
    const file = path.join(packageRoot, 'intelligence-output-schemas/scarcity.schema.json');
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete schema.properties.confidence;
    schema.required = schema.required.filter((k) => k !== 'confidence');
    fs.writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('missing_confidence_')));
  });

  it('missing limitations field', () => {
    const file = path.join(packageRoot, 'intelligence-output-schemas/scarcity.schema.json');
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete schema.properties.limitations;
    schema.required = schema.required.filter((k) => k !== 'limitations');
    fs.writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('missing_limitations_')));
  });

  it('missing protocol', () => {
    const matrix = readMatrix();
    matrix.capabilities[0].protocols = ['http1', 'http2'];
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.some((v) => v.includes('missing_protocol') && v.endsWith(':http3')));
  });

  it('unsupported protocol', () => {
    const matrix = readMatrix();
    matrix.capabilities[0].protocols = ['http1', 'http2', 'http3', 'ftp'];
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.some((v) => v.includes('unsupported_protocol') && v.endsWith(':ftp')));
  });

  it('accepted capability without tests', () => {
    const matrix = readMatrix();
    matrix.capabilities[0].acceptance = 'accepted';
    matrix.capabilities[0].current_test_status = 'missing';
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('accepted_capability_without_tests:')));
  });

  it('negotiation auto-send enabled', () => {
    const matrix = readMatrix();
    const neg = matrix.capabilities.find((c) => c.capability_id === 'negotiation_assistance');
    neg.never_auto_send = false;
    neg.safety_requirements = neg.safety_requirements.filter((s) => s !== 'never_auto_send');
    writeMatrix(matrix);
    const report = validate();
    assert.ok(
      report.violations.includes('negotiation_auto_send_enabled') ||
        report.violations.includes('negotiation_auto_send_not_forbidden'),
    );
  });

  it('private cross-user retrieval allowed', () => {
    const matrix = readMatrix();
    matrix.capabilities[0].safety_requirements.push('private_cross_user_retrieval_allowed');
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.includes('private_cross_user_retrieval_allowed'));
  });

  it('production PERCENT nonzero', () => {
    const matrix = readMatrix();
    matrix.production_posture.PERCENT = 1;
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.includes('PERCENT_nonzero'));
  });

  it('ALLOW_PROD_PERCENT nonzero', () => {
    const matrix = readMatrix();
    matrix.production_posture.ALLOW_PROD_PERCENT = 5;
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.includes('ALLOW_PROD_PERCENT_nonzero'));
  });

  it('hybrid/vector production default enabled', () => {
    const matrix = readMatrix();
    matrix.production_posture.hybrid_vector_production_default = 'ENABLED';
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.includes('hybrid_vector_production_default_enabled'));
  });

  it('duplicate canonical matrix', () => {
    const dup = path.join(REPO_ROOT, 'docs/ai-platform/intelligence-capability-matrix.json');
    const created = !fs.existsSync(dup);
    if (created) fs.writeFileSync(dup, '{}\n');
    try {
      const report = validateIntelligenceCapabilityContracts(REPO_ROOT, { packageRoot });
      assert.ok(report.violations.some((v) => v.startsWith('duplicate_canonical_matrix:')));
    } finally {
      if (created) fs.rmSync(dup, { force: true });
    }
  });

  it('generated /tmp report referenced', () => {
    const matrix = readMatrix();
    matrix.generated_plan = '/tmp/phase33-ai-platform-capability-plan/final-plan.md';
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.includes('generated_tmp_report_referenced:intelligence-capability-matrix.json'));
  });

  it('unsupported training claim', () => {
    const matrix = readMatrix();
    matrix.notes = 'Result: the model was trained on marketplace data last week.';
    writeMatrix(matrix);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('unsupported_training_claim:')));
  });

  it('invalid scenario capability reference', () => {
    const previewPath = path.join(packageRoot, 'fixtures/scenario-preview/scenario-preview.json');
    const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
    preview.scenarios[0].capability_id = 'not_real';
    fs.writeFileSync(previewPath, `${JSON.stringify(preview, null, 2)}\n`);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('invalid_scenario_capability_reference:')));
  });

  it('duplicate scenario ID', () => {
    const previewPath = path.join(packageRoot, 'fixtures/scenario-preview/scenario-preview.json');
    const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
    preview.scenarios[1].scenario_id = preview.scenarios[0].scenario_id;
    fs.writeFileSync(previewPath, `${JSON.stringify(preview, null, 2)}\n`);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('duplicate_scenario_id:')));
  });

  it('private-field fixture violation', () => {
    const file = path.join(packageRoot, 'fixtures/valid-examples/scarcity.json');
    const example = JSON.parse(fs.readFileSync(file, 'utf8'));
    example.limitations[0].message = 'contact owner@example.com for private comps';
    fs.writeFileSync(file, `${JSON.stringify(example, null, 2)}\n`);
    const report = validate();
    assert.ok(report.violations.some((v) => v.startsWith('private_field_fixture_violation:')));
  });
});
