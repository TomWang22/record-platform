# Phase 34 — Attribution audit (Cursor local OK / GitHub UI user-only)

## Verdict

**Keep Cursor for local development.** Future owner-controlled GitHub activity must attribute to **MelonGodTier \<tomwang22@yahoo.com\>** (GitHub login **TomWang22**). Do not rewrite `main` history. Cursor remote write/App activity is disallowed for owner-owned work.

| Field | Value |
| --- | --- |
| `cursor_local_development_allowed` | `true` |
| `cursor_editor_removal_required` | `false` |
| `cursor_remote_write_actions_allowed` | `false` |
| `current_commit_author` | MelonGodTier \<tomwang22@yahoo.com\> |
| `current_commit_committer` | MelonGodTier \<tomwang22@yahoo.com\> |
| `forbidden_trailers` | `[]` |
| `github_app_activity_detected` | `false` (recent API sample) |
| `historical_records_preserved` | `true` |
| `main_history_rewrite` | `false` |

## a. Exact GitHub UI “Cursor” source

Audited via local Git + `gh` API (no secrets printed).

- **Commit author/committer (A/B):** HEAD and recent GitHub commits are MelonGodTier / TomWang22 — not Cursor.
- **Trailers (C/D):** No Cursor co-author / generated-by / assisted-by / on-behalf-of trailers on retained history. Matches for the word “Cursor” are **prose** in guard-hardening commit messages only.
- **GitHub App activity (E/F/G/H/I):** Recent PushEvents actor = `TomWang22`. Check-run apps on HEAD = `github-actions` only. No Cursor-created PR/comment/review/deployment/check detected in the sampled window.
- **If the owner still sees a Cursor badge in the UI:** classify as **K. UNKNOWN_REQUIRES_OWNER_SCREENSHOT** — Git metadata alone does not explain a badge; App installation UI must be inspected by the owner.

Do **not** conclude Cursor was “removed” merely because trailers are clean. Trailers and App activity are separate checks; both were audited.

## Local vs remote boundary

| Capability | Status |
| --- | --- |
| Cursor local edit / test / agents / terminal | **ENABLED** |
| Owner-authenticated `git commit` / `git push` | **ENABLED** (HTTPS + `gh auth git-credential` as TomWang22) |
| Cursor Background/Cloud Agent remote branch/PR/commit | **DISABLED** (policy) |
| Cursor GitHub App write/actions | **DISABLED or OWNER-ACTION-PENDING** |

Repository-local identity locked:

```text
user.name = MelonGodTier
user.email = tomwang22@yahoo.com
user.useConfigOnly = true
```

## Guards

- `commit-msg`: rejects Cursor attribution trailers (including Generated-by / on-behalf-of).
- `pre-push`: audits **every** outgoing commit for Cursor identity/trailers **and** exact owner MelonGodTier identity.
- Regression tests: owner pass; Cursor co-author fail; Cursor author fail; Cursor committer fail; mixed range fail; `CURSOR_AGENT=1` with clean owner metadata pass.

## Cursor GitHub App

Status: **`CURSOR_REMOTE_APP_RESTRICTION_OWNER_ACTION_REQUIRED`**

The current user token cannot list App installations (403). Owner should open [GitHub → Settings → Applications → Installed GitHub Apps](https://github.com/settings/installations), select Cursor if present, and restrict write permissions (Contents/PRs/Issues/Checks/Deployments) while keeping the Cursor **editor** installed. Prefer read-only if needed. Do not uninstall Cursor.

## History policy

No rewrite of existing `main` SHAs. Exact-SHA evidence, frozen eval roots, manifests, and deployment lineage remain valid.
