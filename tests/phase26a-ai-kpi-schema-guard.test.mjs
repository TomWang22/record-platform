import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_ARTIFACT_SHA,
  KPI_TABLES,
  REQUIRED_FIELDS,
  FORBIDDEN_COLUMNS,
  KPI_FLAG_DEFAULTS,
  MIGRATION_SQL,
  validatePhase26aSchema,
  readFile,
  Phase26aSchemaGuardError,
} from '../scripts/lib/phase26a-ai-kpi-schema-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase26a ai kpi schema guard', () => {
  it('validates full Phase 26A schema batch', () => {
    const result = validatePhase26aSchema(repoRoot);
    assert.equal(result.status, 'PASS');
    assert.equal(result.tables, KPI_TABLES.length);
  });

  it('migration SQL defines all four KPI tables', () => {
    const migration = readFile(repoRoot, MIGRATION_SQL);
    for (const table of KPI_TABLES) {
      assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `missing ${table}`);
    }
  });

  it('migration includes required Phase 25B fields', () => {
    const migration = readFile(repoRoot, MIGRATION_SQL);
    for (const field of REQUIRED_FIELDS) {
      assert.ok(migration.includes(field), `missing field ${field}`);
    }
  });

  it('migration excludes forbidden raw/private columns', () => {
    const migration = readFile(repoRoot, MIGRATION_SQL);
    for (const forbidden of FORBIDDEN_COLUMNS) {
      const pattern = new RegExp(`\\b${forbidden}\\b`, 'i');
      assert.equal(pattern.test(migration), false, `forbidden column present: ${forbidden}`);
    }
  });

  it('config.py defaults KPI flags off with master disable on', () => {
    const configPy = readFile(repoRoot, 'services/python-ai-service/app/ai/config.py');
    for (const flag of KPI_FLAG_DEFAULTS) {
      assert.ok(
        configPy.includes(`os.getenv("${flag.name}", "${flag.default}")`),
        `missing ${flag.name} default ${flag.default}`,
      );
    }
  });

  it('kpi_observability no-op guards block writes by default', () => {
    const kpiPy = readFile(repoRoot, 'services/python-ai-service/app/ai/kpi_observability.py');
    assert.ok(kpiPy.includes('AI_KPI_OBSERVABILITY_MASTER_DISABLE'));
    assert.ok(kpiPy.includes('return None'));
    assert.ok(kpiPy.includes('NotImplementedError'));
  });

  it('closeout claims schema-only posture', () => {
    const closeout = readFile(repoRoot, 'docs/ai-platform/PHASE_26A_OBSERVABILITY_SCHEMA_AND_NOOP_INSTRUMENTATION.md');
    assert.match(closeout, /Phase 26A:.*PASS/i);
    assert.match(closeout, /Migrations applied to live DB:.*NO/i);
    assert.match(closeout, /Runtime writes enabled:.*NO/i);
    assert.match(closeout, /Live eval:.*NOT RUN/i);
    assert.match(closeout, /Phase 26B:.*NOT STARTED/i);
  });

  it('closeout preserves production posture locks', () => {
    const closeout = readFile(repoRoot, 'docs/ai-platform/PHASE_26A_OBSERVABILITY_SCHEMA_AND_NOOP_INSTRUMENTATION.md');
    assert.match(closeout, /Production default:.*keyword/i);
    assert.match(closeout, /PERCENT=0/i);
    assert.match(closeout, /ALLOW_PROD_PERCENT=0/i);
    assert.match(closeout, /Hybrid\/vector production default:.*NOT APPROVED/i);
  });

  it('artifact SHA unchanged in closeout', () => {
    const closeout = readFile(repoRoot, 'docs/ai-platform/PHASE_26A_OBSERVABILITY_SCHEMA_AND_NOOP_INSTRUMENTATION.md');
    assert.ok(closeout.includes(EXPECTED_ARTIFACT_SHA));
  });

  it('Phase26aSchemaGuardError is throwable', () => {
    assert.throws(
      () => {
        throw new Phase26aSchemaGuardError('test');
      },
      (err) => err.name === 'Phase26aSchemaGuardError',
    );
  });
});
