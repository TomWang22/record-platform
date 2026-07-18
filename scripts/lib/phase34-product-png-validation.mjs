/**
 * Full PNG validation for product smoke screenshots (all rows, not samples).
 * Uses PNG IHDR in-process + Pillow for all-white / all-transparent detection.
 *
 * Locator crops must not be classified as viewport width mismatches.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

function readIhdr(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    return { width: 0, height: 0, ok: false };
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    ok: true,
  };
}

function pillowPixelFlags(filePath) {
  const py = `
from PIL import Image
import sys
im = Image.open(sys.argv[1]).convert("RGBA")
w,h = im.size
px = im.load()
opaque_non_white = 0
any_alpha = 0
for y in range(0,h, max(1,h//80 or 1)):
  for x in range(0,w, max(1,w//80 or 1)):
    r,g,b,a = px[x,y]
    if a > 0: any_alpha += 1
    if a > 8 and (r < 250 or g < 250 or b < 250): opaque_non_white += 1
print(f"{w} {h} {int(opaque_non_white==0 and any_alpha>0)} {int(any_alpha==0)}")
`;
  const r = spawnSync('python3', ['-c', py, filePath], { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
  const parts = (r.stdout || '').trim().split(/\s+/);
  return {
    ok: true,
    width: Number(parts[0]),
    height: Number(parts[1]),
    all_white: parts[2] === '1',
    all_transparent: parts[3] === '1',
  };
}

function normalizeCaptureKind(raw) {
  const s = String(raw || 'VIEWPORT').toUpperCase().replace(/-/g, '_');
  if (s === 'LOCATOR') return 'LOCATOR';
  if (s === 'BOUNDED_REGION' || s === 'BOUNDED') return 'BOUNDED_REGION';
  if (s === 'FULL_PAGE') return 'FULL_PAGE';
  if (s === 'VIEWPORT') return 'VIEWPORT';
  // legacy capture_mode values
  if (s === 'FULL_PAGE' || s === 'FULLPAGE') return 'FULL_PAGE';
  return 'VIEWPORT';
}

/**
 * Decode PNG + validate against expected capture metadata.
 */
export function validatePngFile(filePath, expected = {}) {
  const issues = [];
  if (!fs.existsSync(filePath)) {
    return { ok: false, issues: ['file_missing'], path: filePath };
  }
  const buf = fs.readFileSync(filePath);
  if (buf.length === 0) issues.push('empty_file');
  const ihdr = readIhdr(buf);
  if (!ihdr.ok) issues.push('not_png');
  let width = ihdr.width;
  let height = ihdr.height;
  if (!(width > 0 && height > 0)) issues.push('invalid_dimensions');
  if (expected.sha256) {
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (got !== expected.sha256) issues.push('sha256_mismatch');
  }
  let allWhite = false;
  let allTransparent = false;
  const pix = pillowPixelFlags(filePath);
  if (pix.ok) {
    width = pix.width || width;
    height = pix.height || height;
    allWhite = pix.all_white;
    allTransparent = pix.all_transparent;
    if (allWhite) issues.push('all_white');
    if (allTransparent) issues.push('all_transparent');
  } else {
    issues.push(`pixel_scan_failed:${pix.error || 'unknown'}`);
  }

  const captureKind = normalizeCaptureKind(expected.capture_kind || expected.capture_mode);
  const policy =
    captureKind === 'LOCATOR' || captureKind === 'BOUNDED_REGION'
      ? 'LOCATOR_OR_BOUNDED_MATCH'
      : 'VIEWPORT_MATCH';

  if (width === 1 && height === 1) issues.push('too_small_1x1');
  if (width > 0 && height > 0 && (width < 32 || height < 32)) issues.push('too_small');

  if (policy === 'VIEWPORT_MATCH') {
    if (expected.viewport_width > 0 && width > 0 && width !== Number(expected.viewport_width)) {
      issues.push(`width_mismatch:${width}!=${expected.viewport_width}`);
    }
  } else {
    const box = expected.locator_bounding_box || expected.clip_rectangle || null;
    const tol = Number(expected.dimension_tolerance_px ?? 2);
    if (box && Number(box.width) > 0 && Number(box.height) > 0) {
      const ew = Math.round(Number(box.width));
      const eh = Math.round(Number(box.height));
      if (Math.abs(width - ew) > tol) issues.push(`locator_width_mismatch:${width}!=${ew}`);
      if (Math.abs(height - eh) > tol) issues.push(`locator_height_mismatch:${height}!=${eh}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    path: filePath,
    width,
    height,
    bytes: buf.length,
    all_white: allWhite,
    all_transparent: allTransparent,
    capture_kind: captureKind,
    dimension_validation_policy: policy,
    dimension_validation_result: issues.length === 0 ? 'PASS' : 'FAIL',
  };
}

/**
 * Validate every screenshot row.
 */
export function validateAllProductScreenshots(rows = []) {
  const results = [];
  let ok = 0;
  for (const row of rows) {
    const captureKind = normalizeCaptureKind(row.capture_kind || row.capture_mode);
    const v = validatePngFile(row.absolute_path, {
      viewport_width: row.viewport_width,
      viewport_height: row.viewport_height,
      sha256: row.sha256,
      capture_kind: captureKind,
      capture_mode: row.capture_mode,
      locator_bounding_box: row.locator_bounding_box || null,
      clip_rectangle: row.clip_rectangle || null,
      dimension_tolerance_px: row.dimension_tolerance_px ?? 2,
    });
    if (!(row.viewport_width > 0 && row.viewport_height > 0)) {
      v.issues.push('missing_viewport_dims');
      v.ok = false;
      v.dimension_validation_result = 'FAIL';
    }
    if (v.ok) ok += 1;
    results.push({
      screenshot_id: row.screenshot_id,
      capture_kind: captureKind,
      viewport_width: row.viewport_width,
      viewport_height: row.viewport_height,
      decoded_width: v.width,
      decoded_height: v.height,
      locator_selector: row.expected_locator || row.locator_selector || null,
      locator_bounding_box: row.locator_bounding_box || null,
      clip_rectangle: row.clip_rectangle || null,
      dimension_validation_policy: v.dimension_validation_policy,
      dimension_validation_result: v.dimension_validation_result,
      ...v,
    });
  }
  return {
    screenshots_validated: `${ok} / ${rows.length}`,
    ok_count: ok,
    total: rows.length,
    fail_count: rows.length - ok,
    pass: ok === rows.length && rows.length > 0,
    results,
  };
}
