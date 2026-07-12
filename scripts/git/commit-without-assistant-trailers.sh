#!/usr/bin/env bash
# Create a commit via git commit-tree without Cursor/CursorAgent attribution.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <message-file>" >&2
  exit 2
fi

MESSAGE_FILE="$1"
if [[ ! -s "$MESSAGE_FILE" ]]; then
  echo "BLOCKED: empty commit message file" >&2
  exit 2
fi

unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE
unset GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE

OWNER_NAME="$(git config --get user.name)"
OWNER_EMAIL="$(git config --get user.email)"

if [[ -z "$OWNER_NAME" || -z "$OWNER_EMAIL" ]]; then
  echo "BLOCKED: repository user.name/user.email is not configured" >&2
  exit 2
fi

if printf '%s\n%s\n' "$OWNER_NAME" "$OWNER_EMAIL" | grep -Eqi 'cursor|cursoragent|cursor\.com'; then
  echo "BLOCKED: configured commit identity contains Cursor attribution" >&2
  exit 2
fi

if git diff --cached --quiet; then
  echo "BLOCKED: no staged changes" >&2
  exit 2
fi

FORBIDDEN='(^|/)(tmp/|webapp/e2e/screenshots/)|\.jsonl$|\.keylog$|\.qlog$|tsconfig\.tsbuildinfo$|scripts/coverage/'
ALLOWED='^bench_logs/security-contract/pcap/(vm-[^/]+\.pcap|SHA256SUMS)$|^scripts/coverage/(gateway-image-source-staleness-guard|kubectl-fetch-route-log|run-matrix-vitest-coverage)\.sh$'
STAGED_FILES=()
while IFS= read -r path; do
  STAGED_FILES+=("$path")
  if [[ "$path" =~ $ALLOWED ]]; then
    continue
  fi
  if [[ "$path" =~ $FORBIDDEN ]] || [[ "$path" =~ \.pcapng$ ]] || [[ "$path" =~ (^|/)bench_logs/ ]]; then
    echo "BLOCKED: forbidden staged path: $path" >&2
    exit 2
  fi
done < <(git diff --cached --name-only)

git diff --cached --check

if grep -Eqi '^(Co-authored-by|Signed-off-by|Reviewed-by|Assisted-by):.*(Cursor|cursoragent@cursor\.com)' "$MESSAGE_FILE"; then
  echo "BLOCKED: Cursor trailer in commit message" >&2
  exit 2
fi

if ! node "$REPO_ROOT/scripts/githooks/commit-msg.mjs" "$MESSAGE_FILE"; then
  echo "BLOCKED: commit-msg attribution guard rejected message" >&2
  exit 2
fi

BRANCH="$(git branch --show-current)"
PARENT="$(git rev-parse HEAD)"
if [[ "$(git rev-parse "$BRANCH")" != "$PARENT" ]]; then
  echo "BLOCKED: branch HEAD moved concurrently" >&2
  exit 2
fi

TREE="$(git write-tree)"
NEW_COMMIT="$(
  GIT_AUTHOR_NAME="$OWNER_NAME" \
  GIT_AUTHOR_EMAIL="$OWNER_EMAIL" \
  GIT_COMMITTER_NAME="$OWNER_NAME" \
  GIT_COMMITTER_EMAIL="$OWNER_EMAIL" \
  git commit-tree "$TREE" -p "$PARENT" -F "$MESSAGE_FILE"
)"
git update-ref "refs/heads/$BRANCH" "$NEW_COMMIT" "$PARENT"

echo "commit_sha=$NEW_COMMIT"
echo "author=$OWNER_NAME <$OWNER_EMAIL>"
echo "committer=$OWNER_NAME <$OWNER_EMAIL>"
echo "message<<EOF"
cat "$MESSAGE_FILE"
echo "EOF"
echo "staged_files:"
printf '  - %s\n' "${STAGED_FILES[@]}"
echo "trailer_audit=PASS"

make git-verify-no-cursor-trailers
