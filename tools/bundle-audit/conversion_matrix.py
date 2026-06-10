"""Load OCH → RP literal replacements from docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md."""

from __future__ import annotations

import re
from pathlib import Path


def load_replacements(matrix_path: Path) -> list[tuple[str, str]]:
    """Return (old, new) pairs; longest `old` first for stable application."""
    text = matrix_path.read_text(encoding="utf-8")
    pairs: list[tuple[str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|") or line.startswith("|---"):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < 2:
            continue
        left_raw, right_raw = cells[0], cells[1]
        if "legacy value" in left_raw.lower():
            continue
        left_ticks = re.findall(r"`([^`]+)`", left_raw)
        right_ticks = re.findall(r"`([^`]+)`", right_raw)
        if not left_ticks or not right_ticks:
            continue
        target = right_ticks[0]
        for lt in left_ticks:
            pairs.append((lt, target))
    # Port row may be prose-only in table; keep canonical gateway default
    if not any(o.startswith("api-gateway:402") for o, _ in pairs):
        pairs.append(("api-gateway:4020", "api-gateway:4000"))
    seen: dict[str, str] = {}
    for a, b in pairs:
        seen.setdefault(a, b)
    return sorted(seen.items(), key=lambda x: len(x[0]), reverse=True)
