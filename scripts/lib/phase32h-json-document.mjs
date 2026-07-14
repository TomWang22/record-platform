/**
 * Phase 32H — single-document JSON contract (not JSONL).
 * Rejects adjacent/concatenated JSON values with a precise error.
 */
import fs from 'node:fs';

export const JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT = 'JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT';

/**
 * Parse exactly one JSON value. Trailing whitespace is allowed.
 * A second JSON value after the first fails closed.
 */
export function parseSingleJsonDocument(text, { source = 'input' } = {}) {
  if (text == null) {
    const err = new Error(`${source}: empty JSON document`);
    err.code = JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT;
    throw err;
  }
  const raw = String(text);
  let value;
  let end = -1;
  try {
    value = JSON.parse(raw);
    // JSON.parse accepts only one value; if we got here with multi-value, it already threw.
    // Detect trailing non-whitespace after a successful parse by scanning.
    // Native JSON.parse rejects adjacent values — rethrow with our code.
    return value;
  } catch (err) {
    const msg = String(err.message || err);
    if (/Unexpected non-whitespace character after JSON/i.test(msg) || /after JSON/i.test(msg)) {
      const e = new Error(
        `${JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT}: ${source}: multiple JSON values or JSONL passed to single-document parser (${msg})`,
      );
      e.code = JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT;
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

export function readSingleJsonFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseSingleJsonDocument(text, { source: filePath });
}

export function writeAtomicJsonFile(filePath, value) {
  const dir = pathDir(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function pathDir(filePath) {
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return i >= 0 ? filePath.slice(0, i) : '.';
}
