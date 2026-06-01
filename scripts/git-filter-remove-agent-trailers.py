#!/usr/bin/env python3
"""git-filter-repo commit callback: TomWang22 identity + strip Cursor/agent trailers."""
import re

AUTHOR_NAME = b"TomWang22"
AUTHOR_EMAIL = b"tomwang22@yahoo.com"

SUBJECT_BAD = re.compile(
    r"(?i)(decontaminat|off[- ]campus|\bOCH\b|housing\s+decontam)",
)


def commit_callback(commit, metadata):
    msg = commit.message.decode("utf-8", errors="surrogateescape")
    msg = re.sub(
        r"(?m)^Co-authored-by:.*(?:cursor|Cursor|cursoragent).*\n",
        "",
        msg,
        flags=re.IGNORECASE,
    )
    msg = re.sub(r"(?m)^Generated-by:.*\n", "", msg, flags=re.IGNORECASE)
    msg = re.sub(r"(?m)^Co-authored-by:\s*$\n?", "", msg)
    lines = msg.splitlines()
    if lines and SUBJECT_BAD.search(lines[0]):
        lines[0] = re.sub(
            r"(?i)\bOCH\b",
            "RP",
            re.sub(r"(?i)off[- ]campus|housing", "domain", lines[0]),
        )
    commit.message = ("\n".join(lines).rstrip() + "\n").encode("utf-8")

    commit.author_name = AUTHOR_NAME
    commit.author_email = AUTHOR_EMAIL
    commit.committer_name = AUTHOR_NAME
    commit.committer_email = AUTHOR_EMAIL
