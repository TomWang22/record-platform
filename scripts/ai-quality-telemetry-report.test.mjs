import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  THRESHOLDS,
  aggregateTelemetry,
  countForbiddenHits,
  evaluateAllThresholds,
  evaluateThreshold,
  findLatestSessionJson,
  parseCompletenessScore,
  sourceCoverageFromRows,
  synthesisTemplateCounts,
} from './ai-quality-telemetry-report.mjs';

const SAMPLE_RECORD = {
  cases: [
    {
      case_id: 'listing_advice',
      ui_total_ms: 3000,
      network_request_ms: 2800,
      http_status: 200,
      refs_count: 5,
      response_source_excerpt: 'Listing revision excerpt text here.',
      synthesis_template: 'listing_revision_changes',
      leakage_result: 'PASS',
      old_boilerplate_only: false,
      answer_text: 'Completeness score: 41/100 Recommended next step.',
      domain: { score: 4 },
    },
    {
      case_id: 'pricing',
      ui_total_ms: 4000,
      network_request_ms: 3500,
      http_status: 200,
      refs_count: 3,
      response_source_excerpt: 'Offer summary excerpt.',
      synthesis_template: 'pricing_plan',
      leakage_result: 'PASS',
      old_boilerplate_only: false,
      answer_text: 'Grounded pricing advice.',
      domain: { score: 3.5 },
    },
  ],
  aggregate: {
    avg_domain_score: 3.75,
    leakage: 'PASS',
    old_boilerplate_regression: false,
  },
};

const SAMPLE_LONGFORM = {
  turns: [
    {
      turn_index: 1,
      ui_total_ms: 2500,
      api_ms: 2300,
      http_status: 200,
      refs_count: 7,
      api_source_excerpt_1: 'Record excerpt one.',
      synthesis_template: 'listing_advice',
      leakage_result: 'PASS',
      old_boilerplate_present: false,
      answer_text: 'Catalog health check.',
      evaluation: { score: 3.5, context_retention: 'good' },
    },
    {
      turn_index: 12,
      ui_total_ms: 4700,
      api_ms: 4600,
      http_status: 200,
      refs_count: 6,
      api_source_excerpt_1: 'Final plan excerpt.',
      synthesis_template: 'executive_summary',
      leakage_result: 'PASS',
      old_boilerplate_present: false,
      answer_text: '[FINAL ACTION PLAN] Completeness score: 55/100',
      evaluation: { score: 4, context_retention: 'good' },
    },
  ],
  aggregate: {
    avg_score: 3.67,
    final_turn_score: 4,
    leakage: 'PASS',
    old_boilerplate_regression: false,
    context_retention_turns_9_12: 'good',
  },
};

const SAMPLE_SELLER = {
  seller_dashboard_ready_ms: 8200,
  rag_ready_ms: 14500,
  panels: [
    {
      panel_id: 'listing_advice',
      api_ms: 3200,
      ui_ready_ms: 3500,
      http_status: 200,
      leakage_result: 'PASS',
      refs_count: 5,
      synthesis_template: 'listing_advice',
    },
    {
      panel_id: 'negotiation_strategy',
      api_ms: 5100,
      ui_ready_ms: 7800,
      http_status: 200,
      leakage_result: 'PASS',
      refs_count: 8,
      synthesis_template: 'negotiation_strategy',
    },
  ],
  aggregate: {
    panels_passed: 2,
    p95_api_ms: 5100,
    p95_ui_ready_ms: 7800,
    leakage: 'PASS',
  },
};

function writeSellerArtifact(repoRoot, timestamp, data) {
  const dir = join(repoRoot, 'bench_logs', 'ai-platform', 'seller-intelligence-ui', timestamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${timestamp}.json`), JSON.stringify(data, null, 2));
}

function writeArtifact(repoRoot, subdir, timestamp, data) {
  const dir = join(repoRoot, 'bench_logs', 'ai-platform', subdir, timestamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${timestamp}.json`), JSON.stringify(data, null, 2));
}

describe('ai-quality-telemetry-report', () => {
  it('findLatestSessionJson picks newest timestamp dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqt-'));
    try {
      writeArtifact(root, 'ui-record-intelligence', '20260101-010000', { cases: [] });
      writeArtifact(root, 'ui-record-intelligence', '20260102-010000', { cases: [] });
      const base = join(root, 'bench_logs', 'ai-platform', 'ui-record-intelligence');
      const latest = findLatestSessionJson(base);
      assert.match(latest ?? '', /20260102-010000\.json$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aggregateTelemetry computes metrics from sample artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqt-'));
    try {
      writeArtifact(root, 'ui-record-intelligence', '20260627-120000', SAMPLE_RECORD);
      writeArtifact(root, 'longform-rag-session', '20260628-120000', SAMPLE_LONGFORM);
      const summary = aggregateTelemetry(root, { stamps: { 'seller-intelligence': 4 } });
      assert.equal(summary.metrics.record_intelligence_avg_score, 3.75);
      assert.equal(summary.metrics.longform_avg_score, 3.67);
      assert.equal(summary.metrics.final_turn_score, 4);
      assert.equal(summary.metrics.seller_panels_passed, 4);
      assert.equal(summary.metrics.leakage_pass, true);
      assert.equal(summary.metrics.old_boilerplate_regression, false);
      assert.equal(summary.metrics.endpoint_http_200_count, 4);
      assert.ok(summary.metrics.source_refs_present_rate >= 0.95);
      assert.ok(summary.metrics.source_excerpt_present_rate >= 0.8);
      assert.equal(summary.metrics.session_memory_turn_count, 2);
      assert.equal(summary.metrics.session_memory_context_retention, 'good');
      assert.equal(summary.metrics.collector_completeness_score, 48);
      assert.ok(summary.metrics.synthesis_template_counts.listing_advice >= 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aggregateTelemetry reads seller intelligence artifact metrics', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqt-'));
    try {
      writeSellerArtifact(root, '20260628-120000', SAMPLE_SELLER);
      const summary = aggregateTelemetry(root);
      assert.equal(summary.metrics.seller_dashboard_ready_ms, 8200);
      assert.equal(summary.metrics.seller_panel_api_p95_ms, 5100);
      assert.equal(summary.metrics.seller_panels_passed, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aggregateTelemetry handles missing artifacts gracefully', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqt-'));
    try {
      mkdirSync(join(root, 'bench_logs', 'ai-platform'), { recursive: true });
      const summary = aggregateTelemetry(root);
      assert.equal(summary.metrics.record_intelligence_avg_score, null);
      assert.equal(summary.metrics.longform_avg_score, null);
      assert.equal(summary.metrics.leakage_pass, true);
      assert.equal(summary.metrics.endpoint_http_200_count, 0);
      assert.ok(summary.warns.length > 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('evaluateThreshold pass and fail', () => {
    assert.equal(evaluateThreshold(3.6, THRESHOLDS.record_intelligence_avg_score), 'PASS');
    assert.equal(evaluateThreshold(3.0, THRESHOLDS.record_intelligence_avg_score), 'WARN');
    assert.equal(evaluateThreshold(true, THRESHOLDS.leakage_pass), 'PASS');
    assert.equal(evaluateThreshold(false, THRESHOLDS.leakage_pass), 'WARN');
    assert.equal(evaluateThreshold(16000, THRESHOLDS.ui_latency_p95_ms), 'WARN');
    assert.equal(evaluateThreshold(9000, THRESHOLDS.ui_latency_p95_ms), 'PASS');
  });

  it('evaluateAllThresholds maps full scorecard', () => {
    const statuses = evaluateAllThresholds({
      record_intelligence_avg_score: 3.6,
      longform_avg_score: 3.6,
      final_turn_score: 4,
      leakage_pass: true,
      old_boilerplate_regression: false,
      source_refs_present_rate: 0.96,
      source_excerpt_present_rate: 0.85,
      ui_latency_p95_ms: 5000,
      endpoint_latency_p95_ms: 4500,
    });
    assert.equal(Object.values(statuses).every((s) => s === 'PASS'), true);
  });

  it('countForbiddenHits detects forbidden strings', () => {
    assert.equal(countForbiddenHits('clean seller summary'), 0);
    assert.equal(countForbiddenHits('contains message_body leak'), 1);
    assert.equal(countForbiddenHits('proxy_bids and max_bid_cents'), 2);
  });

  it('parseCompletenessScore extracts score from answer', () => {
    assert.equal(parseCompletenessScore('Completeness score: 41/100'), 41);
    assert.equal(parseCompletenessScore('no score here'), null);
  });

  it('synthesisTemplateCounts aggregates templates', () => {
    const counts = synthesisTemplateCounts([
      { synthesis_template: 'listing_advice' },
      { synthesis_template: 'listing_advice' },
      { synthesis_template: 'executive_summary' },
    ]);
    assert.deepEqual(counts, { listing_advice: 2, executive_summary: 1 });
  });

  it('sourceCoverageFromRows computes rates', () => {
    const { refsRate, excerptRate } = sourceCoverageFromRows([
      { refs_count: 2, response_source_excerpt: 'long enough excerpt' },
      { refs_count: 0, response_source_excerpt: '' },
    ]);
    assert.equal(refsRate, 0.5);
    assert.equal(excerptRate, 0.5);
  });
});
