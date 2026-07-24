# Phase 34 — Cursor local development vs GitHub attribution

Cursor remains the authorized **local** development environment.

Future GitHub UI for owner-controlled activity must attribute to:

```text
MelonGodTier <tomwang22@yahoo.com>
```

(GitHub account: TomWang22)

## Boundary

- **Allowed:** Cursor edits, tests, agents, terminal, local git prepare/commit/push using owner credentials.
- **Disallowed:** Cursor Background/Cloud Agent or Cursor GitHub App creating remote branches, commits, PRs, comments, reviews, deployments, or checks for owner-owned work; Cursor co-author / attribution trailers.

## Owner action if Cursor still appears remotely

`CURSOR_REMOTE_APP_RESTRICTION_OWNER_ACTION_REQUIRED`

1. Open https://github.com/settings/installations
2. Open the Cursor GitHub App (if installed)
3. Scope to this repository if possible
4. Disable write actions (Contents, Pull requests, Issues, Checks, Deployments)
5. Keep the Cursor editor; do not uninstall Cursor to satisfy attribution

See `reports/phase34-attribution/attribution-audit.md`.
