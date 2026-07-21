# Migrations (integration)

- source_sha: `de398501e7566780869bf9802c8074989a3f2c0b`
- production_claimed: **false**
- ok: **True**

- `49-listings-sale-completed-lifecycle.sql` checksum `2e1ec6252657…` status **OK** at 2026-07-21T15:10:43Z
- `50-listings-sale-completed-hardening.sql` checksum `d92e5c45c5f5…` status **OK** at 2026-07-21T15:10:46Z
- `51-intelligence-evidence-platform.sql` checksum `dd7383051e23…` status **OK** at 2026-07-21T15:10:46Z
- `52-intelligence-conversation-memory.sql` checksum `90196248aff0…` status **OK** at 2026-07-21T15:10:47Z
- `53-intelligence-rights-connectors.sql` checksum `4b0cf779bbf0…` status **OK** at 2026-07-21T15:10:47Z

## Schema object counts
```json
[
  {
    "schema": "intelligence",
    "relkind": "S",
    "count": 3
  },
  {
    "schema": "intelligence",
    "relkind": "i",
    "count": 51
  },
  {
    "schema": "intelligence",
    "relkind": "r",
    "count": 24
  },
  {
    "schema": "listings",
    "relkind": "S",
    "count": 1
  },
  {
    "schema": "listings",
    "relkind": "i",
    "count": 81
  },
  {
    "schema": "listings",
    "relkind": "r",
    "count": 22
  }
]
```

## Append-only triggers
```json
[
  {
    "table": "action_confirmations",
    "trigger": "trg_action_confirmations_deny_delete",
    "enabled": "O"
  },
  {
    "table": "action_confirmations",
    "trigger": "trg_action_confirmations_deny_update",
    "enabled": "O"
  },
  {
    "table": "claim_ledger_entries",
    "trigger": "trg_claim_ledger_entries_deny_delete",
    "enabled": "O"
  },
  {
    "table": "claim_ledger_entries",
    "trigger": "trg_claim_ledger_entries_deny_update",
    "enabled": "O"
  },
  {
    "table": "claim_ledgers",
    "trigger": "trg_claim_ledgers_deny_delete",
    "enabled": "O"
  },
  {
    "table": "claim_ledgers",
    "trigger": "trg_claim_ledgers_deny_update",
    "enabled": "O"
  },
  {
    "table": "conversation_responses",
    "trigger": "trg_conversation_responses_deny_delete",
    "enabled": "O"
  },
  {
    "table": "conversation_responses",
    "trigger": "trg_conversation_responses_deny_update",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshot_exclusions",
    "trigger": "trg_evidence_snapshot_exclusions_deny_delete",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshot_exclusions",
    "trigger": "trg_evidence_snapshot_exclusions_deny_update",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshot_items",
    "trigger": "trg_evidence_snapshot_items_deny_delete",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshot_items",
    "trigger": "trg_evidence_snapshot_items_deny_update",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshot_queries",
    "trigger": "trg_evidence_snapshot_queries_deny_delete",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshot_queries",
    "trigger": "trg_evidence_snapshot_queries_deny_update",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshot_subjects",
    "trigger": "trg_evidence_snapshot_subjects_deny_delete",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshot_subjects",
    "trigger": "trg_evidence_snapshot_subjects_deny_update",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshots",
    "trigger": "trg_evidence_snapshots_deny_delete",
    "enabled": "O"
  },
  {
    "table": "evidence_snapshots",
    "trigger": "trg_evidence_snapshots_deny_update",
    "enabled": "O"
  },
  {
    "table": "fact_revisions",
    "trigger": "trg_fact_revisions_deny_delete",
    "enabled": "O"
  },
  {
    "table": "fact_revisions",
    "trigger": "trg_fact_revisions_deny_update",
    "enabled": "O"
  },
  {
    "table": "license_grants",
    "trigger": "trg_deny_license_grant_delete",
    "enabled": "O"
  },
  {
    "table": "license_grants",
    "trigger": "trg_deny_license_grant_update",
    "enabled": "O"
  },
  {
    "table": "market_events",
    "trigger": "trg_market_events_deny_delete",
    "enabled": "O"
  },
  {
    "table": "market_events",
    "trigger": "trg_market_events_deny_update",
    "enabled": "O"
  },
  {
    "table": "raw_observations",
    "trigger": "trg_raw_observations_deny_delete",
    "enabled": "O"
  },
  {
    "table": "raw_observations",
    "trigger": "trg_raw_observations_deny_update",
    "enabled": "O"
  },
  {
    "table": "response_envelopes",
    "trigger": "trg_response_envelopes_deny_delete",
    "enabled": "O"
  },
  {
    "table": "response_envelopes",
    "trigger": "trg_response_envelopes_deny_update",
    "enabled": "O"
  },
  {
    "table": "retrieval_checkpoints",
    "trigger": "trg_retrieval_checkpoints_deny_delete",
    "enabled": "O"
  },
  {
    "table": "retrieval_checkpoints",
    "trigger": "trg_retrieval_checkpoints_deny_update",
    "enabled": "O"
  },
  {
    "table": "sale_completed_events",
    "trigger": "trg_sale_completed_deny_delete",
    "enabled": "O"
  },
  {
    "table": "sale_completed_events",
    "trigger": "trg_sale_completed_deny_update",
    "enabled": "O"
  },
  {
    "table": "sale_followup_events",
    "trigger": "trg_sale_followup_deny_delete",
    "enabled": "O"
  },
  {
    "table": "sale_followup_events",
    "trigger": "trg_sale_followup_deny_update",
    "enabled": "O"
  }
]
```
