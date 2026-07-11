#!/usr/bin/env python3
"""git-filter-repo commit callback: strip Cursor/agent trailer lines only."""
import re

TRAILER_PATTERNS = [
    re.compile(
        r"(?m)^(?:Co-authored-by|Signed-off-by|Reviewed-by|Assisted-by):"
        r".*(?:cursoragent@cursor\.com|\bcursor\b).*\n?",
        re.IGNORECASE,
    ),
    re.compile(r"(?m)^Generated-by:.*\n?", re.IGNORECASE),
]


def commit_callback(commit, metadata):
    msg = commit.message.decode("utf-8", errors="surrogateescape")
    for pattern in TRAILER_PATTERNS:
        msg = pattern.sub("", msg)
    msg = re.sub(r"(?m)^Co-authored-by:\s*$\n?", "", msg)
    commit.message = (msg.rstrip() + "\n").encode("utf-8")
