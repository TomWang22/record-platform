/**
 * Phase 32H — streaming JSONL reader (no whole-file split).
 */
import fs from 'node:fs';
import readline from 'node:readline';

export const JSONL_LINE_TOO_LONG = 'JSONL_LINE_TOO_LONG';
export const JSONL_MALFORMED_LINE = 'JSONL_MALFORMED_LINE';
export const JSONL_TRUNCATED_FINAL = 'JSONL_TRUNCATED_FINAL';

export const DEFAULT_MAX_LINE_BYTES = 1_048_576;

/**
 * @typedef {{ maxLineBytes?: number, onBlankLine?: 'skip'|'error', truncatedFinal?: 'ignore'|'error' }} JsonlStreamOptions
 */

/**
 * Stream JSONL lines without loading the whole file.
 * Yields { lineNumber, value } for each complete non-blank line.
 * Does not retain parsed rows after yield (caller decides).
 */
export async function* iterateJsonlFile(filePath, options = {}) {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const onBlankLine = options.onBlankLine ?? 'skip';
  const truncatedFinal = options.truncatedFinal ?? 'error';

  if (!fs.existsSync(filePath)) return;

  const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  let lastRaw = '';
  let lastComplete = true;

  try {
    for await (const line of rl) {
      lineNumber += 1;
      lastRaw = line;
      lastComplete = true;
      if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
        const err = new Error(`JSONL line ${lineNumber} exceeds maxLineBytes=${maxLineBytes}`);
        err.code = JSONL_LINE_TOO_LONG;
        err.lineNumber = lineNumber;
        throw err;
      }
      if (!line.trim()) {
        if (onBlankLine === 'error') {
          const err = new Error(`JSONL blank line at ${lineNumber}`);
          err.code = JSONL_MALFORMED_LINE;
          err.lineNumber = lineNumber;
          throw err;
        }
        continue;
      }
      let value;
      try {
        value = JSON.parse(line);
      } catch (cause) {
        const err = new Error(`JSONL malformed line ${lineNumber}: ${cause.message}`);
        err.code = JSONL_MALFORMED_LINE;
        err.lineNumber = lineNumber;
        err.cause = cause;
        throw err;
      }
      yield { lineNumber, value };
      // release
      value = undefined;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  // readline normally yields only complete lines; a file ending without newline
  // still yields the last partial line as a complete readline event. Detect true
  // truncation via ending with incomplete JSON on last non-empty attempt is covered
  // by parse failure. Optional: if file ends mid-line without newline and policy says error —
  // Node readline delivers the final fragment; if it fails JSON.parse we already throw.
  void truncatedFinal;
  void lastComplete;
  void lastRaw;
}

/**
 * Count rows and optionally aggregate without retaining all rows.
 */
export async function scanJsonlFile(filePath, { reduce, ...options } = {}) {
  let count = 0;
  let acc = typeof reduce === 'function' ? reduce.initial : undefined;
  for await (const { lineNumber, value } of iterateJsonlFile(filePath, options)) {
    count += 1;
    if (typeof reduce === 'function') {
      acc = reduce(acc, value, lineNumber);
    }
  }
  return { count, acc };
}

export function countJsonlRowsStreamingSync(filePath, options = {}) {
  // Synchronous line scan without loading whole file into one string.
  if (!fs.existsSync(filePath)) return 0;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const fd = fs.openSync(filePath, 'r');
  try {
    let carry = '';
    let count = 0;
    let lineNumber = 0;
    const buf = Buffer.alloc(64 * 1024);
    let bytes;
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      carry += buf.toString('utf8', 0, bytes);
      let idx;
      while ((idx = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, idx);
        carry = carry.slice(idx + 1);
        lineNumber += 1;
        if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
          const err = new Error(`JSONL line ${lineNumber} exceeds maxLineBytes=${maxLineBytes}`);
          err.code = JSONL_LINE_TOO_LONG;
          err.lineNumber = lineNumber;
          throw err;
        }
        if (!line.trim()) continue;
        try {
          JSON.parse(line);
        } catch (cause) {
          const err = new Error(`JSONL malformed line ${lineNumber}: ${cause.message}`);
          err.code = JSONL_MALFORMED_LINE;
          err.lineNumber = lineNumber;
          err.cause = cause;
          throw err;
        }
        count += 1;
      }
    }
    if (carry.length) {
      lineNumber += 1;
      if (options.truncatedFinal === 'error') {
        try {
          JSON.parse(carry);
          count += 1;
        } catch (cause) {
          const err = new Error(`JSONL truncated final line ${lineNumber}: ${cause.message}`);
          err.code = JSONL_TRUNCATED_FINAL;
          err.lineNumber = lineNumber;
          err.cause = cause;
          throw err;
        }
      } else if (carry.trim()) {
        try {
          JSON.parse(carry);
          count += 1;
        } catch {
          // ignore truncated final by default when policy is ignore
          if (options.truncatedFinal !== 'ignore') {
            const err = new Error(`JSONL truncated final line ${lineNumber}`);
            err.code = JSONL_TRUNCATED_FINAL;
            err.lineNumber = lineNumber;
            throw err;
          }
        }
      }
    }
    return count;
  } finally {
    fs.closeSync(fd);
  }
}

export function detectTruncatedJsonlStreaming(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return false;
  try {
    countJsonlRowsStreamingSync(filePath, { ...options, truncatedFinal: 'error' });
    return false;
  } catch (err) {
    if (err.code === JSONL_TRUNCATED_FINAL || err.code === JSONL_MALFORMED_LINE) return true;
    if (err instanceof SyntaxError) return true;
    throw err;
  }
}

/** Test helper: prove source of a function does not contain whole-file split pattern. */
export function sourceAvoidsWholeFileSplit(sourceText) {
  return !/\.readFileSync\([^)]*\)[\s\S]{0,80}\.split\(/.test(sourceText);
}
