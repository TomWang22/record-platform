/**
 * Fail-closed entity/media/status consistency for Phase 34 owner-proof seeds.
 */
export const ENTITY_MEDIA_MISMATCH = 'ENTITY_MEDIA_MISMATCH';
export const SOLD_STATUS_CONTRADICTION = 'SOLD_STATUS_CONTRADICTION';
export const LISTING_RECORD_MISMATCH = 'LISTING_RECORD_MISMATCH';
export const CAPABILITY_ENTITY_MISMATCH = 'CAPABILITY_ENTITY_MISMATCH';

const FORBIDDEN_MEDIA_HOSTS = Object.freeze([
  'picsum.photos',
  'loremflickr.com',
  'unsplash.com',
  'placekitten.com',
]);

/**
 * @param {object} entity
 * @param {object} [opts]
 */
export function assertEntityConsistency(entity, opts = {}) {
  const issues = [];
  const title = String(entity?.title || entity?.name || '');
  const status = String(entity?.status || entity?.listing_status || '').toLowerCase();
  const soldFlag = Boolean(entity?.sold) || /\[sold\]/i.test(title);
  const mediaUrls = collectMediaUrls(entity);

  for (const url of mediaUrls) {
    if (isForbiddenMediaUrl(url)) {
      issues.push({
        code: ENTITY_MEDIA_MISMATCH,
        message: `Forbidden stock/placeholder media URL: ${url}`,
      });
    }
  }

  if (soldFlag && (status === 'active' || status === 'published')) {
    issues.push({
      code: SOLD_STATUS_CONTRADICTION,
      message: `Title or sold flag indicates sold while status is ${status || 'active'}`,
    });
  }

  if (opts.requireVinylCoverPath) {
    const ok = mediaUrls.some((u) => String(u).includes('/e2e-fixtures/covers/'));
    if (mediaUrls.length > 0 && !ok) {
      issues.push({
        code: ENTITY_MEDIA_MISMATCH,
        message: 'Expected vinyl cover fixture path under /e2e-fixtures/covers/',
      });
    }
  }

  if (
    entity?.source_record_id &&
    entity?.linked_record_id &&
    String(entity.source_record_id) !== String(entity.linked_record_id)
  ) {
    issues.push({
      code: LISTING_RECORD_MISMATCH,
      message: 'Listing source_record_id does not match linked record id',
    });
  }

  if (opts.expectedCapability && entity?.capability && entity.capability !== opts.expectedCapability) {
    issues.push({
      code: CAPABILITY_ENTITY_MISMATCH,
      message: `Entity capability ${entity.capability} != ${opts.expectedCapability}`,
    });
  }

  if (issues.length && opts.failClosed !== false) {
    const err = new Error(
      `${issues[0].code}: ${issues.map((i) => i.message).join('; ')}`,
    );
    err.code = issues[0].code;
    err.issues = issues;
    throw err;
  }
  return { ok: issues.length === 0, issues };
}

export function isForbiddenMediaUrl(url) {
  const u = String(url || '').toLowerCase();
  return FORBIDDEN_MEDIA_HOSTS.some((h) => u.includes(h));
}

function collectMediaUrls(entity) {
  const out = [];
  if (!entity || typeof entity !== 'object') return out;
  for (const key of ['imageUrl', 'coverUrl', 'primaryImageUrl', 'image_url']) {
    if (entity[key]) out.push(entity[key]);
  }
  if (Array.isArray(entity.images)) {
    for (const img of entity.images) {
      if (typeof img === 'string') out.push(img);
      else if (img?.url) out.push(img.url);
      else if (img?.image_url) out.push(img.image_url);
    }
  }
  if (Array.isArray(entity.mediaPieces)) {
    for (const m of entity.mediaPieces) {
      if (m?.urlOrPath) out.push(m.urlOrPath);
      if (m?.url) out.push(m.url);
    }
  }
  return out.map(String);
}
