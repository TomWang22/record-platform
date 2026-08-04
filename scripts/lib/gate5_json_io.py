"""Gate 5 / acceptance JSON + JSONL I/O helpers.

Never pass a Path to json.load/json.dump — those require file objects.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Iterable, Iterator, List, Mapping, MutableMapping, Sequence, Union

PathLike = Union[str, Path]


class Gate5JsonError(Exception):
    """Explicit classification for report/JSONL load failures."""

    def __init__(self, classification: str, message: str):
        self.classification = classification
        super().__init__(f"{classification}: {message}")


def _as_path(path: PathLike) -> Path:
    return path if isinstance(path, Path) else Path(path)


def load_json(path: PathLike) -> Any:
    """Load a JSON document from a filesystem path (Path-safe)."""
    p = _as_path(path)
    if not p.is_file():
        raise Gate5JsonError("JSON_FILE_MISSING", f"missing file: {p}")
    text = p.read_text(encoding="utf-8")
    if text.strip() == "":
        raise Gate5JsonError("JSON_EMPTY", f"empty file: {p}")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise Gate5JsonError("JSON_TRUNCATED_OR_INVALID", f"{p}: {exc}") from exc


def dump_json_atomic(path: PathLike, document: Any, *, indent: int | None = 2) -> None:
    """Write JSON atomically: temp → fsync → rename. Never classify PASS on partial write."""
    p = _as_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(document, indent=indent, ensure_ascii=False)
    if not data.endswith("\n"):
        data += "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=f".{p.name}.", suffix=".tmp", dir=str(p.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, p)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def iter_jsonl(path: PathLike) -> Iterator[tuple[int, Any]]:
    """Yield (1-based line_no, object) for every physical non-empty line.

    Malformed lines raise Gate5JsonError — they must not silently disappear.
    """
    p = _as_path(path)
    if not p.is_file():
        raise Gate5JsonError("JSONL_FILE_MISSING", f"missing file: {p}")
    text = p.read_text(encoding="utf-8")
    if text == "":
        raise Gate5JsonError("JSONL_EMPTY", f"empty file: {p}")
    for line_no, raw in enumerate(text.splitlines(), start=1):
        if raw.strip() == "":
            continue
        try:
            yield line_no, json.loads(raw)
        except json.JSONDecodeError as exc:
            raise Gate5JsonError(
                "JSONL_ROW_MALFORMED",
                f"{p}:{line_no}: {exc}; later rows must not be silently dropped",
            ) from exc


def load_jsonl(path: PathLike) -> List[Any]:
    return [obj for _, obj in iter_jsonl(path)]


def parse_jsonl_text(text: str, *, source: str = "<jsonl>") -> List[Any]:
    """Parse JSONL text; every physical non-empty line must decode."""
    rows: List[Any] = []
    if text.strip() == "":
        return rows
    for line_no, raw in enumerate(text.splitlines(), start=1):
        if raw.strip() == "":
            continue
        try:
            rows.append(json.loads(raw))
        except json.JSONDecodeError as exc:
            raise Gate5JsonError(
                "JSONL_ROW_MALFORMED",
                f"{source}:{line_no}: {exc}; later rows must not be silently dropped",
            ) from exc
    return rows


def dump_jsonl_atomic(path: PathLike, rows: Iterable[Mapping[str, Any]]) -> None:
    p = _as_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(row, ensure_ascii=False) for row in rows]
    body = ("\n".join(lines) + ("\n" if lines else ""))
    fd, tmp_name = tempfile.mkstemp(prefix=f".{p.name}.", suffix=".tmp", dir=str(p.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(body)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, p)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def require_matrix_evidence_fields(row: Mapping[str, Any], required: Sequence[str]) -> None:
    missing = [k for k in required if k not in row]
    if missing:
        raise Gate5JsonError(
            "MATRIX_ROW_EVIDENCE_INCOMPLETE",
            f"missing fields {missing} on row keys={sorted(row.keys())[:20]}",
        )


def freeze_diagnostic_blocked(
    root: PathLike,
    *,
    reason: str,
    details: MutableMapping[str, Any] | None = None,
) -> Path:
    """Write BLOCKED marker under a diagnostic root (never a frozen Gate 5 v8/v9 root)."""
    r = _as_path(root)
    r.mkdir(parents=True, exist_ok=True)
    body: dict[str, Any] = {
        "terminal_state": "FROZEN_BLOCKED_EVIDENCE",
        "reason": reason,
        "gate5_final_pass": False,
        "gate6_authorized": False,
        "production_approved": False,
        "v10_created": False,
    }
    if details:
        body["details"] = dict(details)
    out = r / "FROZEN_BLOCKED_EVIDENCE.json"
    dump_json_atomic(out, body)
    return out
