export const MAX_LISTING_IMAGES_PER_CREATE = Math.min(
  24,
  Math.max(1, Number(process.env.MAX_LISTING_IMAGES_PER_CREATE || "16") || 16),
);

export type ListingImageUrlValidation =
  | { ok: true }
  | { ok: false; message: string };

/** Playwright contract placeholders (picsum does not support HEAD). */
function isRpContractPlaceholderUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && u.hostname === "picsum.photos" && /^\/seed\/rp-/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** Deterministic vinyl sleeve fixtures served by the webapp (contract seeds). */
function isE2eVinylCoverFixtureUrl(raw: string): boolean {
  const s = String(raw).trim();
  if (s.startsWith("data:image/svg+xml") || s.startsWith("data:image/png")) return true;
  if (s.startsWith("/e2e-fixtures/covers/") && s.endsWith(".svg")) return true;
  if (s.startsWith("/album-sleeves/") && s.endsWith(".svg")) return true;
  if (s.startsWith("/test-covers/") && s.endsWith(".svg")) return true;
  try {
    const u = new URL(s);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      (u.pathname.startsWith("/e2e-fixtures/covers/") ||
        u.pathname.startsWith("/album-sleeves/") ||
        u.pathname.startsWith("/test-covers/")) &&
      u.pathname.endsWith(".svg")
    );
  } catch {
    return false;
  }
}

/** Same-origin paths proxied to media-service (inline signed URLs, etc.). */
function isOchMediaGatewayPath(raw: string): boolean {
  const s = String(raw).trim();
  if (!s.startsWith("/")) return false;
  return s.startsWith("/api/media/") || s.startsWith("/media/") || isE2eVinylCoverFixtureUrl(s);
}

export function validateListingImageUrlShape(url: string): ListingImageUrlValidation {
  const raw = String(url).trim();
  if (!raw) {
    return { ok: false, message: "empty image URL" };
  }
  if (isE2eVinylCoverFixtureUrl(raw) || isOchMediaGatewayPath(raw)) {
    return { ok: true };
  }
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") {
      return { ok: true };
    }
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      message: `invalid image URL (https or /api/media/... path required): ${raw.slice(0, 96)}`,
    };
  } catch {
    return {
      ok: false,
      message: `invalid image URL: ${raw.slice(0, 96)}`,
    };
  }
}

export async function validateListingImageUrlHead(
  url: string,
): Promise<ListingImageUrlValidation> {
  const shape = validateListingImageUrlShape(url);
  if (!shape.ok) return shape;
  const raw = String(url).trim();
  if (isOchMediaGatewayPath(raw) || isRpContractPlaceholderUrl(raw) || isE2eVinylCoverFixtureUrl(raw)) {
    return { ok: true };
  }
  if (
    process.env.LISTINGS_SKIP_MEDIA_HEAD === "1" ||
    process.env.LISTINGS_SKIP_MEDIA_HEAD === "true" ||
    process.env.VITEST === "true"
  ) {
    return { ok: true };
  }
  try {
    const res = await fetch(raw, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    const ct = res.headers.get("content-type") || "";
    if (res.ok && /^image\//i.test(ct)) {
      return { ok: true };
    }
    return {
      ok: false,
      message: `image URL failed validation: ${raw.slice(0, 96)}`,
    };
  } catch {
    return {
      ok: false,
      message: `image URL failed validation: ${raw.slice(0, 96)}`,
    };
  }
}

export async function validateListingImageUrlsForCreate(
  urls: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const uniq = [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))];
  for (const u of uniq) {
    const shape = validateListingImageUrlShape(u);
    if (!shape.ok) {
      return shape;
    }
  }
  for (const u of uniq) {
    const head = await validateListingImageUrlHead(u);
    if (!head.ok) {
      return head;
    }
  }
  return { ok: true };
}
