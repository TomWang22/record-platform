# Social DB: Role Mutation and User Lifecycle

This doc covers how to handle **role changes**, **archived/deleted** state, and **user leaves** (e.g. what happens to their messages and forum posts) in the social database (port 5434: forum, messages).

## Roles and mutations

- **Admin**: Elevated role (e.g. `role = 'admin'`). Admins may see hidden/deleted content for moderation, and their own content may be treated differently for retention or visibility.
- **Role change**: When a user’s role changes (e.g. admin → member, or member → archived), decide:
  - Whether existing **messages** and **forum posts** remain visible (usually yes, by author_id/sender_id).
  - Whether the user can still log in (auth is source of truth on 5437; social DB references user by ID).
- **Archived**: User marked as archived (e.g. `users.archived_at` or `status = 'archived'`). Typical policy:
  - **Forum posts**: Keep visible with “Archived user” or anonymized label; or hide body and show only “removed”.
  - **Messages**: Keep in `messages.messages` for recipient history; hide or redact sender name for archived users in UI; optionally soft-delete sender side only.
- **Deleted**: User marked as deleted (soft delete). Same considerations as archived: retain messages for recipients, optionally anonymize or redact sender in UI; forum posts can be “deleted by user” or “removed”.

## User leaves (account closure / leave)

When a user “leaves” (account closed or deactivated):

1. **Auth (5437)**: Source of truth. Mark user as inactive/deleted so they cannot log in. Do not hard-delete if other DBs still reference `user_id`.
2. **Social (5434)**:
   - **Messages**: Keep rows; `sender_id`/`recipient_id` remain valid FKs. In UI: show “Deleted user” or “Former member” for the left user’s name; do not delete message rows (recipients keep history).
   - **Forum posts**: Keep rows for thread continuity. Show “Deleted user” or “Removed” as author in UI; optionally set `user_id` to a system “ghost” UUID and store original `user_id` in an `original_user_id` column if you need audit trail without showing the user.
3. **Referential integrity**: Prefer `ON DELETE SET NULL` for optional user references (e.g. “last_edited_by”) and keep `ON DELETE CASCADE` only where the row is owned by the user and must disappear with them (e.g. draft posts). For sent messages, do not CASCADE delete when user leaves — recipients retain messages.

## Implementation notes

- Add columns if needed: `forum.posts.deleted_at`, `users.archived_at`, `users.deleted_at` (or use a `status` enum).
- Queries for “active” content: filter `WHERE deleted_at IS NULL` and, for listing by user, `WHERE user_id IN (SELECT id FROM auth.users WHERE deleted_at IS NULL)` (or join to auth if replicated).
- **Role mutation**: Store `role` and optionally `role_updated_at`; apply visibility and permission rules in application layer based on current role and `archived_at`/`deleted_at`.

These policies keep cold path and pgbench workloads representative (full rows, indexes on user_id and timestamps) while documenting how to handle role and lifecycle mutations in the social DB.
