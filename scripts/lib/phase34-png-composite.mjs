/**
 * Vertically stitch PNG screenshots into owner-pack composites (PIL via python3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

/**
 * @param {string[]} inputPaths
 * @param {string} outputPath
 * @param {{ labels?: string[], maxWidth?: number }} [opts]
 */
export function stitchPngsVertically(inputPaths, outputPath, opts = {}) {
  const paths = (inputPaths || []).filter((p) => p && fs.existsSync(p));
  if (paths.length === 0) {
    const err = new Error('PNG_COMPOSITE_NO_SOURCES');
    err.code = 'PNG_COMPOSITE_NO_SOURCES';
    throw err;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const labels = opts.labels || [];
  const maxWidth = opts.maxWidth ?? 1400;
  const script = `
import json, sys
from PIL import Image, ImageDraw, ImageFont

paths = json.loads(${JSON.stringify(JSON.stringify(paths))})
labels = json.loads(${JSON.stringify(JSON.stringify(labels))})
out = ${JSON.stringify(outputPath)}
max_w = ${maxWidth}

imgs = []
for i, p in enumerate(paths):
    im = Image.open(p).convert("RGB")
    if im.width > max_w:
        ratio = max_w / im.width
        im = im.resize((max_w, max(1, int(im.height * ratio))), Image.Resampling.LANCZOS)
    label = labels[i] if i < len(labels) else ""
    pad = 28 if label else 8
    canvas = Image.new("RGB", (im.width, im.height + pad), (248, 250, 252))
    if label:
        draw = ImageDraw.Draw(canvas)
        draw.text((8, 6), label[:120], fill=(15, 23, 42))
    canvas.paste(im, (0, pad))
    imgs.append(canvas)

width = max(i.width for i in imgs)
height = sum(i.height for i in imgs) + 8 * (len(imgs) - 1)
sheet = Image.new("RGB", (width, height), (255, 255, 255))
y = 0
for i, im in enumerate(imgs):
    sheet.paste(im, (0, y))
    y += im.height
    if i < len(imgs) - 1:
        y += 8
sheet.save(out, format="PNG", optimize=True)
print(out)
`;
  const res = spawnSync('python3', ['-c', script], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (res.status !== 0) {
    const err = new Error(`PNG_COMPOSITE_FAILED:${res.stderr || res.stdout || res.status}`);
    err.code = 'PNG_COMPOSITE_FAILED';
    throw err;
  }
  if (!fs.existsSync(outputPath)) {
    const err = new Error('PNG_COMPOSITE_MISSING_OUTPUT');
    err.code = 'PNG_COMPOSITE_MISSING_OUTPUT';
    throw err;
  }
  return {
    path: outputPath,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex'),
  };
}
