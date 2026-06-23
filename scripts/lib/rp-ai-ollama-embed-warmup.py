#!/usr/bin/env python3
"""Ollama embedding warmup probe (T20.10I-preflight-B)."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request


def main() -> int:
    base = os.environ["OLLAMA_BASE_URL"].rstrip("/")
    model = os.environ["AI_EMBEDDING_MODEL"]
    warmup_text = os.environ["OLLAMA_WARMUP_TEXT"]
    max_attempts = int(os.environ["OLLAMA_WARMUP_MAX_ATTEMPTS"])
    target_ms = int(os.environ["OLLAMA_WARMUP_TARGET_MS"])
    need_consecutive = int(os.environ["OLLAMA_WARMUP_CONSECUTIVE"])
    timeout_sec = float(os.environ["OLLAMA_WARMUP_TIMEOUT_SEC"])

    payload = json.dumps(
        {
            "model": model,
            "input": f"search_query: {warmup_text}",
        }
    ).encode("utf-8")

    consecutive_ok = 0
    for attempt in range(1, max_attempts + 1):
        start = time.perf_counter()
        req = urllib.request.Request(
            f"{base}/api/embed",
            data=payload,
            headers={"content-type": "application/json"},
            method="POST",
        )
        status = "ok"
        dims = 0
        try:
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                body = json.loads(resp.read())
            embeddings = body.get("embeddings")
            if embeddings and isinstance(embeddings, list) and embeddings:
                dims = len(embeddings[0])
            else:
                dims = len(body.get("embedding") or [])
            if dims <= 0:
                status = "empty_embedding"
        except Exception as exc:
            status = f"{type(exc).__name__}: {exc}"
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        under_target = status == "ok" and elapsed_ms <= target_ms
        print(
            f"warmup_attempt={attempt} status={status} elapsed_ms={elapsed_ms} "
            f"dims={dims} under_target={under_target}",
            flush=True,
        )
        if under_target:
            consecutive_ok += 1
            if consecutive_ok >= need_consecutive:
                print(
                    f"WARMUP_PASS consecutive={consecutive_ok} target_ms={target_ms}",
                    flush=True,
                )
                return 0
        else:
            consecutive_ok = 0

    print(
        f"WARMUP_FAIL attempts={max_attempts} consecutive_required={need_consecutive} "
        f"target_ms={target_ms}",
        flush=True,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
