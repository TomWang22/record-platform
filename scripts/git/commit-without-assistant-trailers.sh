#!/usr/bin/env bash
# Create a commit via git commit-tree without Cursor/CursorAgent trailers.
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

if git diff --cached --quiet; then
  echo "BLOCKED: no staged changes" >&2
  exit 2
fi

FORBIDDEN='(^|/)(tmp/|bench_logs/|webapp/e2e/screenshots/)|\.pcap|\.pcapng|\.jsonl$|\.keylog$|\.qlog$|tsconfig\.tsbuildinfo$|scripts/coverage/'
while IFS= read -r path; do
  if [[ "$path" =~ $FORBIDDEN ]]; then
    echo "BLOCKED: forbidden staged path: $path" >&2
    exit 2
  fi
done < <(git diff --cached --name-only)

git diff --cached --check

if grep -Eqi '^(Co-authored-by|Signed-off-by|Reviewed-by|Assisted-by):.*(Cursor|cursoragent@cursor\.com)' "$MESSAGE_FILE"; then
  echo "BLOCKED: Cursor trailer in commit message" >&2
  exit 2
fi

BRANCH="$(git branch --show-current)"
PARENT="$(git rev-parse HEAD)"
TREE="$(git write-tree)"
NEW_COMMIT="$(git commit-tree "$TREE" -p "$PARENT" <"$MESSAGE_FILE")"
git update-ref "refs/heads/$BRANCH" "$NEW_COMMIT" "$PARENT"

echo "$NEW_COMMIT"
git show -s --format='%H%n%B' HEAD

make git-verify-no-cursor-trailers
