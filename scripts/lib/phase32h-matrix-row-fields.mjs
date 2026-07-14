/**
 * Phase 32H — canonical matrix-row field extraction (nested timing first).
 */

export function extractProtocol(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.protocol_label === 'string' && row.protocol_label.trim()) {
    return row.protocol_label;
  }
  if (typeof row.protocol === 'string' && row.protocol.trim()) {
    return row.protocol;
  }
  const map = { h1: 'HTTP/1.1', h2: 'HTTP/2', h3: 'HTTP/3', '1.1': 'HTTP/1.1', '2': 'HTTP/2', '3': 'HTTP/3' };
  if (typeof row.matrix_protocol === 'string' && map[row.matrix_protocol]) {
    return map[row.matrix_protocol];
  }
  if (row.http_version != null && map[String(row.http_version)]) {
    return map[String(row.http_version)];
  }
  return null;
}

function timingObject(row) {
  return row && typeof row.timing === 'object' && row.timing ? row.timing : null;
}

function num(...candidates) {
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function extractWallTotalMs(row) {
  const t = timingObject(row);
  return num(t?.wall_total_ms, row?.wall_total_ms);
}

export function extractCurlTotalMs(row) {
  const t = timingObject(row);
  return num(t?.curl_time_total_ms, row?.curl_time_total_ms);
}

export function extractStartTransferMs(row) {
  const t = timingObject(row);
  return num(t?.curl_time_starttransfer_ms, row?.curl_time_starttransfer_ms);
}

export function extractServerRagTotalMs(row) {
  const t = timingObject(row);
  return num(t?.server_timing_rag_total_ms, row?.server_timing_rag_total_ms, row?.rag_total_ms, t?.rag_total_ms);
}

export function extractRetrievalTotalMs(row) {
  const t = timingObject(row);
  return num(t?.server_timing_retrieval_total_ms, row?.server_timing_retrieval_total_ms);
}

export function extractRetryCount(row) {
  const t = timingObject(row);
  const v = num(t?.retry_count, row?.retry_count, row?.retries);
  return v == null ? 0 : v;
}

/**
 * Fail closed when required terminal timing fields are absent.
 */
export function assertTerminalTimingFields(row, { context = 'matrix row' } = {}) {
  const protocol = extractProtocol(row);
  if (!protocol) {
    const err = new Error(`${context}: missing canonical protocol label`);
    err.code = 'PHASE32H_TERMINAL_TIMING_MISSING';
    throw err;
  }
  const wall = extractWallTotalMs(row);
  const curl = extractCurlTotalMs(row);
  const start = extractStartTransferMs(row);
  const rag = extractServerRagTotalMs(row);
  const missing = [];
  if (wall == null) missing.push('wall_total_ms');
  if (curl == null) missing.push('curl_time_total_ms');
  if (start == null) missing.push('curl_time_starttransfer_ms');
  if (rag == null) missing.push('server_timing_rag_total_ms');
  if (missing.length) {
    const err = new Error(`${context}: missing required timing fields: ${missing.join(', ')}`);
    err.code = 'PHASE32H_TERMINAL_TIMING_MISSING';
    err.missing = missing;
    throw err;
  }
  return { protocol, wall, curl, start, rag, retries: extractRetryCount(row) };
}
