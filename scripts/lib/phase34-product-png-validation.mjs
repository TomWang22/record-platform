/**
 * Full PNG validation for product smoke screenshots (all rows, not samples).
 * Uses PNG IHDR in-process + Pillow for all-white / all-transparent detection.
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
step = max(1, (w*h)//5000)
px = im.load()
opaque_non_white = 0
any_alpha = 0
n = 0
for y in range(0,h, max(1,h//80 or 1)):
  for x in range(0,w, max(1,w//80 or 1)):
    r,g,b,a = px[x,y]
    n += 1
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

/**
 * Decode PNG + validate against expected viewport metadata.
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
  // fullPage captures may exceed viewport height; width must match viewport
  if (expected.viewport_width > 0 && width > 0 && width !== Number(expected.viewport_width)) {
    issues.push(`width_mismatch:${width}!=${expected.viewport_width}`);
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
  };
}

/**
 * Validate every screenshot row.
 */
export function validateAllProductScreenshots(rows = []) {
  const results = [];
  let ok = 0;
  for (const row of rows) {
    const v = validatePngFile(row.absolute_path, {
      viewport_width: row.viewport_width,
      viewport_height: row.viewport_height,
      sha256: row.sha256,
    });
    if (!(row.viewport_width > 0 && row.viewport_height > 0)) {
      v.issues.push('missing_viewport_dims');
      v.ok = false;
    }
    if (v.ok) ok += 1;
    results.push({ screenshot_id: row.screenshot_id, ...v });
  }
  return {
    screenshots_validated: `${ok} / ${rows.length}`,
    ok_count: ok,
    total: rows.length,
    pass: ok === rows.length && rows.length > 0,
    results,
  };
}
