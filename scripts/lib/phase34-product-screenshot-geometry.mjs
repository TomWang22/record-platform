/**
 * Screenshot geometry gates — reject pathological full-page captures.
 */
export const MAX_NORMAL_PAGE_HEIGHT_RATIO = 4;
export const MAX_SCREENSHOT_PIXEL_COUNT = 1280 * 720 * 8; // ~7.4M px bound
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // 8 MiB

/**
 * @param {import('playwright').Page} page
 */
export async function measurePageHeightGeometry(page) {
  const viewport = (await page.viewportSize?.()) || { width: 1280, height: 720 };
  const viewport_height = Number(viewport.height) || 720;
  const viewport_width = Number(viewport.width) || 1280;

  let measured = {
    document_scroll_height: viewport_height,
    document_client_height: viewport_height,
    body_scroll_height: viewport_height,
    largest_dom_element: null,
    largest_element_height: 0,
    scroll_container_candidates: [],
  };

  if (typeof page.evaluate === 'function') {
    try {
      measured = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const document_scroll_height = Math.max(
          doc?.scrollHeight || 0,
          body?.scrollHeight || 0,
          doc?.offsetHeight || 0,
        );
        const document_client_height = doc?.clientHeight || window.innerHeight || 0;
        const body_scroll_height = body?.scrollHeight || 0;
        let largest_dom_element = null;
        let largest_element_height = 0;
        const scroll_container_candidates = [];
        const nodes = document.querySelectorAll('body *');
        for (const el of nodes) {
          const h = el.scrollHeight || 0;
          if (h > largest_element_height) {
            largest_element_height = h;
            largest_dom_element = el.tagName + (el.id ? `#${el.id}` : '') + (el.className ? `.${String(el.className).split(' ')[0]}` : '');
          }
          const style = window.getComputedStyle(el);
          if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 40) {
            scroll_container_candidates.push({
              tag: el.tagName,
              id: el.id || null,
              testid: el.getAttribute('data-testid'),
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
            });
          }
        }
        return {
          document_scroll_height,
          document_client_height,
          body_scroll_height,
          largest_dom_element,
          largest_element_height,
          scroll_container_candidates: scroll_container_candidates.slice(0, 8),
        };
      });
    } catch {
      /* keep defaults */
    }
  }

  const document_scroll_height = Number(measured.document_scroll_height) || viewport_height;
  const height_ratio = document_scroll_height / Math.max(1, viewport_height);
  return {
    viewport_width,
    viewport_height,
    document_scroll_height,
    document_client_height: Number(measured.document_client_height) || viewport_height,
    body_scroll_height: Number(measured.body_scroll_height) || viewport_height,
    height_ratio,
    largest_dom_element: measured.largest_dom_element || null,
    largest_element_height: Number(measured.largest_element_height) || 0,
    scroll_container_candidates: measured.scroll_container_candidates || [],
  };
}

/**
 * Hard gate before page-level screenshots.
 * @param {object} geometry
 * @param {object} meta
 */
export function assertScreenshotGeometryAllowed(geometry, meta = {}) {
  const ratio = Number(geometry?.height_ratio);
  const docH = Number(geometry?.document_scroll_height) || 0;
  const vpH = Number(geometry?.viewport_height) || 0;
  if (!Number.isFinite(ratio) || ratio > MAX_NORMAL_PAGE_HEIGHT_RATIO || docH > vpH * MAX_NORMAL_PAGE_HEIGHT_RATIO) {
    const err = new Error(
      `VISUAL_PAGE_HEIGHT_PATHOLOGY: height_ratio=${ratio} document=${docH} viewport=${vpH} route=${meta.route || ''}`,
    );
    err.code = 'VISUAL_PAGE_HEIGHT_PATHOLOGY';
    err.geometry = geometry;
    err.meta = {
      route: meta.route || null,
      session_id: meta.session_id || null,
      turn_id: meta.turn_id || null,
      viewport: meta.viewport || null,
      document_height: docH,
      viewport_height: vpH,
      height_ratio: ratio,
      largest_dom_element: geometry?.largest_dom_element || null,
      largest_element_height: geometry?.largest_element_height || null,
      scroll_container_candidates: geometry?.scroll_container_candidates || [],
    };
    throw err;
  }
  return true;
}

export function assertCapturedImageBounds({ width, height, bytes, viewport_height, capture_mode }) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const px = w * h;
  if (px > MAX_SCREENSHOT_PIXEL_COUNT) {
    const err = new Error(`screenshot pixel count ${px} exceeds bound ${MAX_SCREENSHOT_PIXEL_COUNT}`);
    err.code = 'VISUAL_SCREENSHOT_PIXEL_BOUND';
    throw err;
  }
  if (Number(bytes) > MAX_SCREENSHOT_BYTES) {
    const err = new Error(`screenshot bytes ${bytes} exceed bound ${MAX_SCREENSHOT_BYTES}`);
    err.code = 'VISUAL_SCREENSHOT_BYTE_BOUND';
    throw err;
  }
  if (capture_mode === 'viewport' && viewport_height > 0 && h > viewport_height * MAX_NORMAL_PAGE_HEIGHT_RATIO) {
    const err = new Error(`viewport capture height ${h} exceeds ${MAX_NORMAL_PAGE_HEIGHT_RATIO}× viewport`);
    err.code = 'VISUAL_PAGE_HEIGHT_PATHOLOGY';
    throw err;
  }
  if (capture_mode === 'locator' && viewport_height > 0 && h > viewport_height * MAX_NORMAL_PAGE_HEIGHT_RATIO) {
    const err = new Error(`locator capture height ${h} exceeds ${MAX_NORMAL_PAGE_HEIGHT_RATIO}× viewport`);
    err.code = 'VISUAL_LOCATOR_HEIGHT_PATHOLOGY';
    throw err;
  }
  return true;
}

export function readPngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return { width: 0, height: 0 };
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return { width: 0, height: 0 };
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}
