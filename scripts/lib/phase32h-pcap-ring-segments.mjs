/**
 * Phase 32H — run-scoped dumpcap ring segment discovery and rotation-aware growth tracking.
 */
import fs from 'node:fs';
import path from 'node:path';

export const RING_GROWTH_SCHEMA_VERSION = 1;

export const PCAP_GROWTH_STATE = {
  WAITING_FOR_FIRST_SEGMENT: 'PCAP_WAITING_FOR_FIRST_SEGMENT',
  ACTIVE_GROWING: 'PCAP_ACTIVE_GROWING',
  ROTATION_IN_PROGRESS: 'PCAP_ROTATION_IN_PROGRESS',
  OUTPUT_NOT_GROWING: 'PCAP_OUTPUT_NOT_GROWING',
  NO_SEGMENT_BLOCKED: 'PCAP_NO_SEGMENT_BLOCKED',
  SEGMENT_SEQUENCE_BLOCKED: 'PCAP_SEGMENT_SEQUENCE_BLOCKED',
  SEGMENT_OUTSIDE_ROOT_BLOCKED: 'PCAP_SEGMENT_OUTSIDE_ROOT_BLOCKED',
  FOREIGN_SEGMENT_BLOCKED: 'PCAP_FOREIGN_SEGMENT_BLOCKED',
};

/** Bounded grace after dumpcap start before first segment must appear. */
export const CREATION_GRACE_MS = 15_000;
/** Bounded grace while active segment rotates to next sequence. */
export const ROTATION_GRACE_MS = 5_000;
/** No byte/segment/mtime progression beyond this => stale. */
export const STALE_THRESHOLD_MS = 30_000;
/** Reject ring segments with mtime more than this before capture_started_at. */
export const CAPTURE_START_TOLERANCE_MS = 5_000;

const RING_SEGMENT_RE = /^(.+)_(\d{5})_(\d{14})(\.pcapng|\.pcap)$/;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeRealpath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function isPathWithinRoot(candidatePath, rootPath) {
  const realRoot = safeRealpath(rootPath) || path.resolve(rootPath);
  let realCandidate = safeRealpath(candidatePath);
  if (!realCandidate) {
    const resolved = path.resolve(candidatePath);
    const parent = path.dirname(resolved);
    const realParent = safeRealpath(parent);
    if (!realParent) return false;
    realCandidate = path.join(realParent, path.basename(resolved));
  }
  const rel = path.relative(realRoot, realCandidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function deriveRingOutputSpec(configuredOutputBase, captureStatus = {}, outRoot = null) {
  const configured = configuredOutputBase || captureStatus.file || '';
  const outputDirectory = path.dirname(configured);
  const outputBasename = path.basename(configured);
  const segmentPrefix = outputBasename.replace(/\.(pcapng|pcap)$/i, '');
  const ringFiles = captureStatus.ring_files ?? null;
  const ringFilesizeKb = captureStatus.ring_filesize_kb ?? null;
  const ringMode = ringFiles != null && ringFilesizeKb != null;
  return {
    output_mode: ringMode ? 'ring_buffer' : 'single_file',
    configured_output_base: configured,
    output_directory: outputDirectory,
    output_basename: outputBasename,
    segment_prefix: segmentPrefix,
    segment_extension: path.extname(outputBasename) || '.pcapng',
    ring_filesize_kb: ringFilesizeKb,
    ring_file_count: ringFiles,
    capture_started_at: captureStatus.started_at || null,
    capture_pid: captureStatus.pid ?? null,
    capture_start_identity: captureStatus.started_at || null,
    evidence_root: outRoot || captureStatus.evidence_root || null,
  };
}

export function parseRingSegmentFilename(filename, segmentPrefix) {
  const match = filename.match(RING_SEGMENT_RE);
  if (!match) return null;
  if (match[1] !== segmentPrefix) return null;
  return {
    filename,
    segment_prefix: match[1],
    sequence: Number(match[2]),
    segment_timestamp: match[3],
    extension: match[4],
  };
}

function statSegment(fullPath) {
  const stat = fs.statSync(fullPath);
  return {
    path: fullPath,
    size_bytes: stat.size,
    mtime_ms: stat.mtimeMs,
    inode: stat.ino,
    birthtime_ms: stat.birthtimeMs,
  };
}

export function discoverRingSegments(outRoot, ringSpec, opts = {}) {
  const outputDir = ringSpec.output_directory;
  const segmentPrefix = ringSpec.segment_prefix;
  const evidenceRoot = ringSpec.evidence_root || outRoot;
  const captureStartedMs = ringSpec.capture_started_at ? Date.parse(ringSpec.capture_started_at) : null;

  const configuredBase = ringSpec.configured_output_base;
  if (configuredBase && evidenceRoot && !isPathWithinRoot(configuredBase, evidenceRoot)) {
    return {
      segments: [],
      blocked: PCAP_GROWTH_STATE.SEGMENT_OUTSIDE_ROOT_BLOCKED,
      foreign_segments: [configuredBase],
    };
  }

  if (!outputDir || !fs.existsSync(outputDir)) {
    return {
      segments: [],
      active_segment: null,
      active_sequence: null,
      aggregate_bytes: 0,
      newest_mtime_ms: null,
      segment_count: 0,
      sequence_contiguous: true,
      configured_base_exists: false,
      configured_base_size_bytes: 0,
      foreign_segments: [],
      malformed_segments: [],
    };
  }

  if (!isPathWithinRoot(outputDir, evidenceRoot)) {
    return {
      segments: [],
      active_segment: null,
      active_sequence: null,
      aggregate_bytes: 0,
      newest_mtime_ms: null,
      segment_count: 0,
      sequence_contiguous: false,
      blocked: PCAP_GROWTH_STATE.SEGMENT_OUTSIDE_ROOT_BLOCKED,
      foreign_segments: [outputDir],
      malformed_segments: [],
    };
  }

  let configuredBaseExists = false;
  let configuredBaseSize = 0;
  if (configuredBase && fs.existsSync(configuredBase)) {
    if (!isPathWithinRoot(configuredBase, evidenceRoot)) {
      return {
        segments: [],
        blocked: PCAP_GROWTH_STATE.SEGMENT_OUTSIDE_ROOT_BLOCKED,
        foreign_segments: [configuredBase],
      };
    }
    configuredBaseExists = true;
    configuredBaseSize = fs.statSync(configuredBase).size;
  }

  const segments = [];
  const foreignSegments = [];
  const malformedSegments = [];
  const prefixRe = new RegExp(`^${escapeRegex(segmentPrefix)}_\\d{5}_\\d{14}\\.pcapng$`);

  for (const name of fs.readdirSync(outputDir)) {
    if (!name.endsWith('.pcapng') && !name.endsWith('.pcap')) continue;
    const full = path.join(outputDir, name);
    if (!isPathWithinRoot(full, evidenceRoot)) {
      foreignSegments.push(full);
      continue;
    }
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() && !isPathWithinRoot(safeRealpath(full) || full, evidenceRoot)) {
      foreignSegments.push(full);
      continue;
    }

    if (name === ringSpec.output_basename) {
      if (ringSpec.output_mode === 'single_file') {
        segments.push({ ...statSegment(full), sequence: 0, is_configured_base: true });
      }
      continue;
    }

    if (!prefixRe.test(name)) {
      if (name.endsWith('.pcapng') || name.endsWith('.pcap')) {
        foreignSegments.push(full);
      }
      continue;
    }

    const parsed = parseRingSegmentFilename(name, segmentPrefix);
    if (!parsed) {
      malformedSegments.push(full);
      continue;
    }

    if (captureStartedMs != null) {
      const earliestAllowed = captureStartedMs - CAPTURE_START_TOLERANCE_MS;
      if (stat.mtimeMs < earliestAllowed && stat.birthtimeMs < earliestAllowed) {
        foreignSegments.push(full);
        continue;
      }
    }

    segments.push({
      ...statSegment(full),
      sequence: parsed.sequence,
      segment_timestamp: parsed.segment_timestamp,
      is_configured_base: false,
    });
  }

  segments.sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.mtime_ms - b.mtime_ms;
  });

  const sequences = segments.map((s) => s.sequence);
  const duplicateSequences = sequences.filter((seq, idx) => sequences.indexOf(seq) !== idx);
  if (duplicateSequences.length) {
    return {
      segments,
      blocked: PCAP_GROWTH_STATE.SEGMENT_SEQUENCE_BLOCKED,
      duplicate_sequences: [...new Set(duplicateSequences)],
      foreign_segments: foreignSegments,
      malformed_segments: malformedSegments,
    };
  }

  let sequenceContiguous = true;
  if (segments.length > 1) {
    const sorted = [...new Set(sequences)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] - sorted[i - 1] > 1) {
        sequenceContiguous = false;
        break;
      }
    }
  }

  const active = segments.length
    ? segments.reduce((best, seg) => (seg.sequence > best.sequence || (seg.sequence === best.sequence && seg.mtime_ms >= best.mtime_ms) ? seg : best))
    : null;

  const aggregateBytes = segments.reduce((sum, seg) => sum + seg.size_bytes, 0);
  const newestMtime = segments.length ? Math.max(...segments.map((s) => s.mtime_ms)) : null;

  return {
    segments,
    active_segment: active?.path ?? null,
    active_sequence: active?.sequence ?? null,
    aggregate_bytes: aggregateBytes,
    newest_mtime_ms: newestMtime,
    segment_count: segments.length,
    sequence_contiguous: sequenceContiguous,
    configured_base_exists: configuredBaseExists,
    configured_base_size_bytes: configuredBaseSize,
    foreign_segments: foreignSegments,
    malformed_segments: malformedSegments,
  };
}

function observationPath(outRoot) {
  return path.join(outRoot, 'run-state', 'pcap-ring-growth-observation.json');
}

export function readRingGrowthObservation(outRoot) {
  const file = observationPath(outRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schema_version !== RING_GROWTH_SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.segments)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeRingGrowthObservation(outRoot, observation) {
  const file = observationPath(outRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(observation, null, 2)}\n`, 'utf8');
  return observation;
}

function hasGrowthProgress(current, previous) {
  if (!previous) return current.segment_count > 0 && current.aggregate_bytes > 0;
  if (current.active_sequence != null && previous.active_sequence != null && current.active_sequence > previous.active_sequence) {
    const activeSeg = current.segments.find((s) => s.path === current.active_segment);
    if (activeSeg && activeSeg.size_bytes > 0) return true;
  }
  if (current.active_segment && current.active_segment !== previous.active_segment) {
    const activeSeg = current.segments.find((s) => s.path === current.active_segment);
    if (activeSeg && activeSeg.size_bytes > 0) return true;
  }
  const prevActive = previous.segments?.find((s) => s.path === previous.active_segment);
  const curActive = current.segments.find((s) => s.path === current.active_segment);
  if (curActive && prevActive && curActive.path === prevActive.path) {
    if (curActive.size_bytes > prevActive.size_bytes) return true;
    if (curActive.mtime_ms > prevActive.mtime_ms && curActive.size_bytes >= prevActive.size_bytes) return true;
  }
  if (current.aggregate_bytes > previous.aggregate_bytes) return true;
  if (current.newest_mtime_ms != null && previous.newest_mtime_ms != null && current.newest_mtime_ms > previous.newest_mtime_ms) {
    if (current.segment_count >= previous.segment_count) return true;
  }
  if (current.segment_count > previous.segment_count) return true;
  return false;
}

export function buildGrowthObservation(discovery, observedAt = new Date().toISOString()) {
  return {
    schema_version: RING_GROWTH_SCHEMA_VERSION,
    observed_at: observedAt,
    segments: discovery.segments.map((s) => ({
      path: s.path,
      sequence: s.sequence,
      size_bytes: s.size_bytes,
      mtime_ms: s.mtime_ms,
      inode: s.inode,
    })),
    active_segment: discovery.active_segment,
    active_sequence: discovery.active_sequence,
    aggregate_bytes: discovery.aggregate_bytes,
    newest_mtime_ms: discovery.newest_mtime_ms,
    segment_count: discovery.segment_count,
    sequence_contiguous: discovery.sequence_contiguous,
  };
}

export function evaluateRingGrowthHealth(outRoot, ringSpec, opts = {}) {
  const now = Date.now();
  const probesActive = Boolean(opts.probesActive);
  const staleThresholdMs = opts.staleThresholdMs ?? STALE_THRESHOLD_MS;
  const creationGraceMs = opts.creationGraceMs ?? CREATION_GRACE_MS;
  const rotationGraceMs = opts.rotationGraceMs ?? ROTATION_GRACE_MS;
  const captureStartedMs = ringSpec.capture_started_at ? Date.parse(ringSpec.capture_started_at) : null;
  const previous = opts.previousObservation ?? readRingGrowthObservation(outRoot);

  const discovery = discoverRingSegments(outRoot, ringSpec, opts);
  const observation = buildGrowthObservation(discovery);

  if (discovery.blocked === PCAP_GROWTH_STATE.SEGMENT_OUTSIDE_ROOT_BLOCKED) {
    return {
      growth_state: PCAP_GROWTH_STATE.SEGMENT_OUTSIDE_ROOT_BLOCKED,
      failure_class: PCAP_GROWTH_STATE.SEGMENT_OUTSIDE_ROOT_BLOCKED,
      discovery,
      observation,
      blocked: true,
    };
  }
  if (discovery.blocked === PCAP_GROWTH_STATE.SEGMENT_SEQUENCE_BLOCKED) {
    return {
      growth_state: PCAP_GROWTH_STATE.SEGMENT_SEQUENCE_BLOCKED,
      failure_class: PCAP_GROWTH_STATE.SEGMENT_SEQUENCE_BLOCKED,
      discovery,
      observation,
      blocked: true,
    };
  }

  if (ringSpec.output_mode === 'single_file') {
    const basePath = ringSpec.configured_output_base;
    const baseExists = basePath && fs.existsSync(basePath);
    if (!baseExists && captureStartedMs != null && now - captureStartedMs <= creationGraceMs) {
      return {
        growth_state: PCAP_GROWTH_STATE.WAITING_FOR_FIRST_SEGMENT,
        failure_class: null,
        discovery,
        observation,
        blocked: false,
        last_output_age_ms: Number.POSITIVE_INFINITY,
      };
    }
    if (!baseExists) {
      return {
        growth_state: PCAP_GROWTH_STATE.NO_SEGMENT_BLOCKED,
        failure_class: PCAP_GROWTH_STATE.NO_SEGMENT_BLOCKED,
        discovery,
        observation,
        blocked: true,
      };
    }
    const age = now - fs.statSync(basePath).mtimeMs;
    if (probesActive && age > staleThresholdMs) {
      return {
        growth_state: PCAP_GROWTH_STATE.OUTPUT_NOT_GROWING,
        failure_class: PCAP_GROWTH_STATE.OUTPUT_NOT_GROWING,
        discovery,
        observation,
        blocked: true,
        last_output_age_ms: age,
      };
    }
    return {
      growth_state: PCAP_GROWTH_STATE.ACTIVE_GROWING,
      failure_class: null,
      discovery,
      observation,
      blocked: false,
      last_output_age_ms: age,
    };
  }

  if (discovery.segment_count === 0 && !discovery.configured_base_exists) {
    if (captureStartedMs != null && now - captureStartedMs <= creationGraceMs) {
      return {
        growth_state: PCAP_GROWTH_STATE.WAITING_FOR_FIRST_SEGMENT,
        failure_class: null,
        discovery,
        observation,
        blocked: false,
        last_output_age_ms: Number.POSITIVE_INFINITY,
      };
    }
    return {
      growth_state: PCAP_GROWTH_STATE.NO_SEGMENT_BLOCKED,
      failure_class: PCAP_GROWTH_STATE.NO_SEGMENT_BLOCKED,
      discovery,
      observation,
      blocked: true,
      last_output_age_ms: Number.POSITIVE_INFINITY,
    };
  }

  const rotating =
    previous &&
    previous.active_sequence != null &&
    discovery.active_sequence != null &&
    discovery.active_sequence > previous.active_sequence &&
    now - Date.parse(previous.observed_at) <= rotationGraceMs;

  if (rotating) {
    writeRingGrowthObservation(outRoot, observation);
    return {
      growth_state: PCAP_GROWTH_STATE.ROTATION_IN_PROGRESS,
      failure_class: null,
      discovery,
      observation,
      blocked: false,
      last_output_age_ms: discovery.newest_mtime_ms != null ? now - discovery.newest_mtime_ms : 0,
    };
  }

  const progressed = hasGrowthProgress(
    {
      ...discovery,
      segments: observation.segments,
      active_segment: observation.active_segment,
      active_sequence: observation.active_sequence,
      aggregate_bytes: observation.aggregate_bytes,
      newest_mtime_ms: observation.newest_mtime_ms,
      segment_count: observation.segment_count,
    },
    previous,
  );

  if (progressed || !previous) {
    writeRingGrowthObservation(outRoot, observation);
    const age = discovery.newest_mtime_ms != null ? now - discovery.newest_mtime_ms : 0;
    return {
      growth_state: PCAP_GROWTH_STATE.ACTIVE_GROWING,
      failure_class: null,
      discovery,
      observation,
      blocked: false,
      last_output_age_ms: age,
    };
  }

  const age = discovery.newest_mtime_ms != null ? now - discovery.newest_mtime_ms : Number.POSITIVE_INFINITY;
  if (probesActive && age > staleThresholdMs) {
    return {
      growth_state: PCAP_GROWTH_STATE.OUTPUT_NOT_GROWING,
      failure_class: PCAP_GROWTH_STATE.OUTPUT_NOT_GROWING,
      discovery,
      observation,
      blocked: true,
      last_output_age_ms: age,
    };
  }

  writeRingGrowthObservation(outRoot, observation);
  return {
    growth_state: PCAP_GROWTH_STATE.ACTIVE_GROWING,
    failure_class: null,
    discovery,
    observation,
    blocked: false,
    last_output_age_ms: age,
  };
}

export function enrichCaptureStatusWithRingHealth(outRoot, captureStatus, growthResult) {
  const ringSpec = deriveRingOutputSpec(captureStatus.file, captureStatus, outRoot);
  const now = Date.now();
  const creationDeadline =
    ringSpec.capture_started_at != null
      ? new Date(Date.parse(ringSpec.capture_started_at) + CREATION_GRACE_MS).toISOString()
      : null;
  const staleDeadline = growthResult.discovery?.newest_mtime_ms
    ? new Date(growthResult.discovery.newest_mtime_ms + STALE_THRESHOLD_MS).toISOString()
    : null;

  return {
    ...captureStatus,
    output_mode: ringSpec.output_mode,
    configured_output_base: ringSpec.configured_output_base,
    resolved_active_segment: growthResult.discovery?.active_segment ?? null,
    matching_segment_count: growthResult.discovery?.segment_count ?? 0,
    active_sequence: growthResult.discovery?.active_sequence ?? null,
    active_size_bytes: growthResult.discovery?.segments?.find((s) => s.path === growthResult.discovery?.active_segment)?.size_bytes ?? 0,
    aggregate_retained_size_bytes: growthResult.discovery?.aggregate_bytes ?? 0,
    newest_segment_mtime_ms: growthResult.discovery?.newest_mtime_ms ?? null,
    last_growth_at: growthResult.growth_state === PCAP_GROWTH_STATE.ACTIVE_GROWING ? new Date().toISOString() : captureStatus.last_growth_at ?? null,
    last_rotation_at:
      growthResult.growth_state === PCAP_GROWTH_STATE.ROTATION_IN_PROGRESS
        ? new Date().toISOString()
        : captureStatus.last_rotation_at ?? null,
    segment_continuity: growthResult.discovery?.sequence_contiguous ?? true,
    creation_grace_deadline: creationDeadline,
    stale_deadline: staleDeadline,
    ring_growth_state: growthResult.growth_state,
    registry_semantic_status: captureStatus.registry_semantic_status ?? 'PASS',
    drops: captureStatus.drops ?? 0,
    health_classification: growthResult.blocked ? growthResult.failure_class : growthResult.growth_state,
    ring_output_spec: ringSpec,
    observed_at: new Date(now).toISOString(),
  };
}

export function persistCaptureStatusRingHealth(outRoot, captureStatus, growthResult) {
  const statusPath = path.join(outRoot, 'pcap/capture-status.json');
  if (!fs.existsSync(statusPath)) return null;
  const enriched = enrichCaptureStatusWithRingHealth(outRoot, captureStatus, growthResult);
  fs.writeFileSync(statusPath, `${JSON.stringify(enriched, null, 2)}\n`, 'utf8');
  return enriched;
}
