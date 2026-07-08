import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeUsefulnessKpiFromObservations,
  summarizeUsefulnessKpiHonest,
} from '../scripts/lib/phase26e-usefulness-observation-kpi-readonly.mjs';

describe('phase26e usefulness observation kpi readonly', () => {
  it('reports PASS with usefulness rates when rows exist across protocols', () => {
    const result = summarizeUsefulnessKpiFromObservations([
      {
        observed_at: '2026-07-08T01:00:00Z',
        protocol: 'HTTP/1.1',
        workflow: 'seller_intelligence',
        evidence_label: 'H1 baseline 57105/57105',
        response_pass: true,
        sentiment_pass: true,
        red_team_safety_pass: true,
        leakage_failures: 0,
        quality_score: 4.5,
      },
      {
        observed_at: '2026-07-08T01:01:00Z',
        protocol: 'HTTP/2',
        workflow: 'seller_intelligence',
        evidence_label: 'H2 replay 57105/57105',
        response_pass: true,
        sentiment_pass: false,
        red_team_safety_pass: true,
        leakage_failures: 0,
        quality_score: 3.5,
      },
      {
        observed_at: '2026-07-08T01:02:00Z',
        protocol: 'HTTP/3',
        workflow: 'seller_intelligence',
        evidence_label: 'H3 replay 57105/57105',
        response_pass: false,
        sentiment_pass: true,
        red_team_safety_pass: true,
        leakage_failures: 1,
        quality_score: 2.0,
      },
    ]);
    assert.equal(result.status, 'PASS');
    assert.equal(result.kpi_usefulness_observations_available, true);
    assert.equal(result.by_protocol['HTTP/1.1'].response_pass_rate, 1);
    assert.equal(result.by_protocol['HTTP/2'].response_pass_rate, 1);
    assert.equal(result.by_protocol['HTTP/3'].response_pass_rate, 0);
    assert.equal(result.by_evidence_label['H1 baseline 57105/57105'], 1);
    assert.equal(result.leakage_failures, 1);
    assert.ok(result.time_series.length >= 1);
    assert.ok(result.notes.some((note) => /not model accuracy/i.test(note)));
  });

  it('reports PARTIAL when only some protocols have rows', () => {
    const result = summarizeUsefulnessKpiFromObservations([
      {
        observed_at: '2026-07-08T02:00:00Z',
        protocol: 'HTTP/2',
        evidence_label: 'H2 replay 57105/57105',
        response_pass: true,
        leakage_failures: 0,
      },
    ]);
    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.by_protocol['HTTP/2'].sample_count, 1);
    assert.equal(result.by_protocol['HTTP/1.1'].sample_count, 0);
  });

  it('reports GAP honestly when no observation rows', () => {
    const result = summarizeUsefulnessKpiHonest([]);
    assert.equal(result.status, 'GAP');
    assert.equal(result.kpi_usefulness_observations_available, false);
    assert.equal(result.response_pass_rate, null);
    assert.ok(result.notes.some((note) => /171315\/171315 is labeled H1\+H2\+H3 only/i.test(note)));
  });

  it('preserves sample and smoke label semantics in notes', () => {
    const result = summarizeUsefulnessKpiFromObservations([
      {
        observed_at: '2026-07-08T03:00:00Z',
        protocol: 'HTTP/1.1',
        evidence_label: 'Phase 22C 7200/7200 sample only',
        response_pass: true,
        leakage_failures: 0,
      },
    ]);
    assert.ok(result.notes.some((note) => /Phase 22C 7200\/7200 is sample only/i.test(note)));
    assert.ok(result.notes.some((note) => /Phase 22B 15\/15 is smoke only/i.test(note)));
  });
});
