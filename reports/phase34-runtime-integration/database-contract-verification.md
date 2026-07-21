# Database contract verification (integration)

- ok: **True**
- sha: `de398501e7566780869bf9802c8074989a3f2c0b`
- production_claimed: false

- PASS `sale_completed_update_forbidden`
- PASS `sale_completed_delete_forbidden`
- PASS `record_readwrite_cannot_update_or_delete_sale_completed`
- PASS `archive_or_lifecycle_alone_not_settlement_eligible`
- PASS `refund_creates_followup_not_mutation`
- PASS `duplicate_settlement_delivery_rejected`
- PASS `rollback_leaves_neither_sale_nor_outbox`
- PASS `commit_persists_sale_and_outbox_together`
- PASS `sale_followup_update_forbidden_or_blocked`
