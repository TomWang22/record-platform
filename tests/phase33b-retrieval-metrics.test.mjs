import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateHardFailures,
  evaluateMode,
  fixtureEmbed,
  cosine,
} from '../scripts/lib/phase33b-retrieval-metrics.mjs';

describe('phase33b retrieval metrics unit', () => {
  it('fixture embed cosine self-similarity', () => {
    const v = fixtureEmbed('kind of blue miles', 8);
    assert.equal(v.length, 8);
    assert.ok(Math.abs(cosine(v, v) - 1) < 1e-9);
  });

  it('stale unlabeled and asking-as-sold hard failures', () => {
    const report = evaluateMode({
      mode: 'keyword',
      queries: [
        {
          query_id: 'q1',
          text: 'unique-token-zzz',
          capability_id: 'valuation',
          query_class: 'sold_vs_asking',
          participant_side: 'buyer',
          experience_level: 'experienced',
          data_density_class: 'dense',
          language_noise_class: 'clean',
          requesting_principal_fixture: 'principal_fixture_buyer_a',
          authorized_scopes: ['authenticated_market'],
          prohibited_scopes: [],
        },
      ],
      documents: [
        {
          document_id: 'd1',
          title: 'unique-token-zzz sold trap',
          text: 'unique-token-zzz sold trap',
          privacy_class: 'MARKETPLACE_SHARED',
          authorization_scope: 'authenticated_market',
          deletion_state: 'ACTIVE',
          asking_presented_as_sold: true,
        },
      ],
      judgments: [],
    });
    // Safety filter excludes ask-as-sold from ranking.
    assert.equal(report.global.asking_as_sold_rate, 0);

    const violations = evaluateHardFailures(
      {
        prohibited_result_rate: 0,
        owner_scope_leakage_rate: 0,
        cross_user_leakage_rate: 0.1,
        deleted_source_retrieval_rate: 0,
        wrong_pressing_as_exact_rate: 0,
        asking_as_sold_rate: 0,
        stale_unlabeled_rate: 0,
      },
      {
        hard_failures: {
          prohibited_result_rate_max: 0,
          owner_scope_leakage_rate_max: 0,
          cross_user_leakage_rate_max: 0,
          deleted_source_retrieval_rate_max: 0,
          wrong_pressing_as_exact_rate_max: 0,
          asking_as_sold_rate_max: 0,
          stale_result_without_stale_label_rate_max: 0,
        },
      },
    );
    assert.ok(violations.some((v) => v.includes('cross_user_leakage_rate')));
  });

  it('wrong pressing ranked exact detected when judgment errs', () => {
    const report = evaluateMode({
      mode: 'keyword',
      queries: [
        {
          query_id: 'q1',
          text: 'pressing-token-aaa',
          capability_id: 'scarcity',
          query_class: 'exact_pressing',
          participant_side: 'buyer',
          experience_level: 'experienced',
          data_density_class: 'medium',
          language_noise_class: 'clean',
          requesting_principal_fixture: 'principal_fixture_buyer_a',
          authorized_scopes: ['public_market'],
          prohibited_scopes: [],
        },
      ],
      documents: [
        {
          document_id: 'd_wrong',
          title: 'pressing-token-aaa',
          text: 'pressing-token-aaa',
          privacy_class: 'PUBLIC',
          authorization_scope: 'public_market',
          deletion_state: 'ACTIVE',
          wrong_pressing: true,
        },
      ],
      judgments: [
        {
          query_id: 'q1',
          document_id: 'd_wrong',
          relevance_grade: 3,
          exact_pressing_match: true,
          authorized: true,
        },
      ],
    });
    assert.ok(report.global.wrong_pressing_as_exact_rate > 0);
  });
});
