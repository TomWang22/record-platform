/**
 * Phase 34 deterministic pressing / entity resolution.
 * Exact-pressing valuation/scarcity claims only for EXACT or documented
 * high-confidence PROBABLE results.
 */
export const RESOLUTION_VERSION = 'phase34-pressing-resolution-v1';

export const RESOLUTION_STATUSES = Object.freeze([
  'EXACT',
  'PROBABLE',
  'RELEASE_LEVEL_ONLY',
  'AMBIGUOUS',
  'CONTRADICTED',
  'UNRESOLVED',
]);

const IDENTITY_FIELDS = Object.freeze([
  'artist',
  'title',
  'catalog_number',
  'barcode',
  'label',
  'country',
  'release_year',
  'format',
  'matrix_runout',
  'vinyl_color',
  'edition',
  'release_id',
]);

function norm(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function normCatalog(value) {
  if (value === null || value === undefined) return null;
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function fieldPresent(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/**
 * Compare subject attributes against a candidate pressing/release record.
 */
export function comparePressingFields(subject = {}, candidate = {}) {
  const matched_fields = [];
  const contradicting_fields = [];

  for (const field of IDENTITY_FIELDS) {
    const sRaw = subject[field] ?? subject[field === 'release_year' ? 'year' : field];
    const cRaw = candidate[field] ?? candidate[field === 'release_year' ? 'year' : field];
    if (!fieldPresent(sRaw) || !fieldPresent(cRaw)) continue;

    let equal;
    if (field === 'catalog_number') {
      equal = normCatalog(sRaw) === normCatalog(cRaw);
    } else if (field === 'release_year') {
      equal = Number(sRaw) === Number(cRaw);
    } else {
      equal = norm(sRaw) === norm(cRaw);
    }

    if (equal) matched_fields.push(field);
    else contradicting_fields.push(field);
  }

  return { matched_fields, contradicting_fields };
}

/**
 * Resolve pressing identity against optional candidates.
 *
 * @param {object} input
 * @param {object} [input.subject] subject attributes
 * @param {object[]} [input.candidates] candidate pressings/releases
 * @param {string} [input.source_release_id]
 * @returns resolution result
 */
export function resolvePressing(input = {}) {
  const subject = input.subject || input;
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const sourceReleaseId = subject.release_id || input.source_release_id || null;

  if (!candidates.length) {
    const hasStrong =
      fieldPresent(subject.catalog_number) &&
      fieldPresent(subject.country) &&
      (fieldPresent(subject.matrix_runout) || fieldPresent(subject.barcode));
    const hasRelease =
      fieldPresent(sourceReleaseId) ||
      (fieldPresent(subject.artist) && fieldPresent(subject.title));

    if (hasStrong && fieldPresent(subject.pressing_id)) {
      return {
        resolved_release_id: sourceReleaseId,
        resolved_master_id: subject.master_release_id || null,
        resolved_pressing_id: subject.pressing_id,
        resolution_confidence: 0.95,
        matched_fields: IDENTITY_FIELDS.filter((f) => fieldPresent(subject[f])),
        contradicting_fields: [],
        ambiguous_candidates: [],
        resolution_version: RESOLUTION_VERSION,
        resolution_status: 'EXACT',
        high_confidence_probable_documented: false,
        limitations: [],
      };
    }

    if (hasRelease && !fieldPresent(subject.pressing_id) && !fieldPresent(subject.catalog_number)) {
      return {
        resolved_release_id: sourceReleaseId,
        resolved_master_id: subject.master_release_id || null,
        resolved_pressing_id: null,
        resolution_confidence: 0.4,
        matched_fields: ['artist', 'title'].filter((f) => fieldPresent(subject[f])),
        contradicting_fields: [],
        ambiguous_candidates: [],
        resolution_version: RESOLUTION_VERSION,
        resolution_status: 'RELEASE_LEVEL_ONLY',
        high_confidence_probable_documented: false,
        limitations: ['pressing identity not established; release-level only'],
      };
    }

    return {
      resolved_release_id: sourceReleaseId,
      resolved_master_id: subject.master_release_id || null,
      resolved_pressing_id: null,
      resolution_confidence: 0,
      matched_fields: [],
      contradicting_fields: [],
      ambiguous_candidates: [],
      resolution_version: RESOLUTION_VERSION,
      resolution_status: 'UNRESOLVED',
      high_confidence_probable_documented: false,
      limitations: ['insufficient identity attributes'],
    };
  }

  const scored = candidates.map((candidate) => {
    const { matched_fields, contradicting_fields } = comparePressingFields(subject, candidate);
    const score =
      matched_fields.length * 2 -
      contradicting_fields.length * 3 +
      (candidate.pressing_id && subject.pressing_id && candidate.pressing_id === subject.pressing_id
        ? 5
        : 0);
    return { candidate, matched_fields, contradicting_fields, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const topScore = best.score;
  const topTied = scored.filter((s) => s.score === topScore && s.score > 0);

  if (best.contradicting_fields.length && best.matched_fields.length === 0) {
    return {
      resolved_release_id: sourceReleaseId || best.candidate.release_id || null,
      resolved_master_id: subject.master_release_id || best.candidate.master_release_id || null,
      resolved_pressing_id: null,
      resolution_confidence: 0,
      matched_fields: best.matched_fields,
      contradicting_fields: best.contradicting_fields,
      ambiguous_candidates: [],
      resolution_version: RESOLUTION_VERSION,
      resolution_status: 'CONTRADICTED',
      high_confidence_probable_documented: false,
      limitations: [`contradictions: ${best.contradicting_fields.join(',')}`],
    };
  }

  if (best.contradicting_fields.includes('country') || best.contradicting_fields.includes('matrix_runout')) {
    // Strong identity contradictions → CONTRADICTED even with partial matches.
    if (best.contradicting_fields.length >= 2 || best.contradicting_fields.includes('matrix_runout')) {
      return {
        resolved_release_id: sourceReleaseId || best.candidate.release_id || null,
        resolved_master_id: subject.master_release_id || best.candidate.master_release_id || null,
        resolved_pressing_id: null,
        resolution_confidence: 0.15,
        matched_fields: best.matched_fields,
        contradicting_fields: best.contradicting_fields,
        ambiguous_candidates: topTied.map((t) => t.candidate.pressing_id || t.candidate.release_id),
        resolution_version: RESOLUTION_VERSION,
        resolution_status: 'CONTRADICTED',
        high_confidence_probable_documented: false,
        limitations: [`hard contradiction on ${best.contradicting_fields.join(',')}`],
      };
    }
  }

  if (topTied.length > 1) {
    return {
      resolved_release_id: sourceReleaseId || best.candidate.release_id || null,
      resolved_master_id: subject.master_release_id || best.candidate.master_release_id || null,
      resolved_pressing_id: null,
      resolution_confidence: 0.35,
      matched_fields: best.matched_fields,
      contradicting_fields: best.contradicting_fields,
      ambiguous_candidates: topTied.map(
        (t) => t.candidate.pressing_id || t.candidate.release_id || t.candidate.catalog_number,
      ),
      resolution_version: RESOLUTION_VERSION,
      resolution_status: 'AMBIGUOUS',
      high_confidence_probable_documented: false,
      limitations: ['multiple equally matching candidates'],
    };
  }

  const hardIdentity =
    best.matched_fields.includes('catalog_number') &&
    (best.matched_fields.includes('country') || best.matched_fields.includes('matrix_runout')) &&
    best.contradicting_fields.length === 0;

  const barcodeExact =
    best.matched_fields.includes('barcode') && best.contradicting_fields.length === 0;

  if (
    (hardIdentity || barcodeExact || (best.matched_fields.length >= 5 && best.contradicting_fields.length === 0)) &&
    (best.candidate.pressing_id || subject.pressing_id)
  ) {
    return {
      resolved_release_id: best.candidate.release_id || sourceReleaseId,
      resolved_master_id: best.candidate.master_release_id || subject.master_release_id || null,
      resolved_pressing_id: best.candidate.pressing_id || subject.pressing_id,
      resolution_confidence: 0.98,
      matched_fields: best.matched_fields,
      contradicting_fields: best.contradicting_fields,
      ambiguous_candidates: [],
      resolution_version: RESOLUTION_VERSION,
      resolution_status: 'EXACT',
      high_confidence_probable_documented: false,
      limitations: [],
    };
  }

  // Probable: strong catalog+label match without full pressing confirmation.
  if (
    best.matched_fields.includes('catalog_number') &&
    best.matched_fields.includes('label') &&
    best.contradicting_fields.length === 0 &&
    best.matched_fields.length >= 3
  ) {
    const documented = input.document_probable === true || input.high_confidence_probable === true;
    return {
      resolved_release_id: best.candidate.release_id || sourceReleaseId,
      resolved_master_id: best.candidate.master_release_id || subject.master_release_id || null,
      resolved_pressing_id: best.candidate.pressing_id || null,
      resolution_confidence: documented ? 0.85 : 0.7,
      matched_fields: best.matched_fields,
      contradicting_fields: best.contradicting_fields,
      ambiguous_candidates: [],
      resolution_version: RESOLUTION_VERSION,
      resolution_status: 'PROBABLE',
      high_confidence_probable_documented: documented,
      limitations: documented
        ? ['PROBABLE high-confidence with documented limitations']
        : ['PROBABLE without documented high-confidence waiver'],
    };
  }

  if (
    best.matched_fields.includes('artist') &&
    best.matched_fields.includes('title') &&
    !best.matched_fields.includes('catalog_number') &&
    !best.matched_fields.includes('barcode')
  ) {
    return {
      resolved_release_id: best.candidate.release_id || sourceReleaseId,
      resolved_master_id: best.candidate.master_release_id || subject.master_release_id || null,
      resolved_pressing_id: null,
      resolution_confidence: 0.45,
      matched_fields: best.matched_fields,
      contradicting_fields: best.contradicting_fields,
      ambiguous_candidates: [],
      resolution_version: RESOLUTION_VERSION,
      resolution_status: 'RELEASE_LEVEL_ONLY',
      high_confidence_probable_documented: false,
      limitations: ['artist/title match only — release-level, not exact pressing'],
    };
  }

  if (best.score <= 0) {
    return {
      resolved_release_id: sourceReleaseId,
      resolved_master_id: subject.master_release_id || null,
      resolved_pressing_id: null,
      resolution_confidence: 0,
      matched_fields: best.matched_fields,
      contradicting_fields: best.contradicting_fields,
      ambiguous_candidates: [],
      resolution_version: RESOLUTION_VERSION,
      resolution_status: 'UNRESOLVED',
      high_confidence_probable_documented: false,
      limitations: ['no positive candidate match'],
    };
  }

  return {
    resolved_release_id: best.candidate.release_id || sourceReleaseId,
    resolved_master_id: best.candidate.master_release_id || subject.master_release_id || null,
    resolved_pressing_id: null,
    resolution_confidence: 0.5,
    matched_fields: best.matched_fields,
    contradicting_fields: best.contradicting_fields,
    ambiguous_candidates: [],
    resolution_version: RESOLUTION_VERSION,
    resolution_status: 'AMBIGUOUS',
    high_confidence_probable_documented: false,
    limitations: ['partial match insufficient for exact pressing'],
  };
}

/**
 * Valuation/scarcity may claim exact pressing only for EXACT, or documented
 * high-confidence PROBABLE with visible limitations.
 */
export function mayClaimExactPressing(resolution = {}) {
  if (resolution.resolution_status === 'EXACT') return true;
  if (
    resolution.resolution_status === 'PROBABLE' &&
    resolution.high_confidence_probable_documented === true &&
    Array.isArray(resolution.limitations) &&
    resolution.limitations.length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * Built-in adversarial fixtures for pressing confusion cases.
 */
export const ADVERSARIAL_PRESSING_FIXTURES = Object.freeze({
  us_mono_vs_jp: {
    id: 'us_mono_vs_jp',
    subject: {
      artist: 'Miles Davis',
      title: 'Kind of Blue',
      catalog_number: 'CL 1355',
      country: 'US',
      edition: 'mono',
      vinyl_color: 'black',
      pressing_id: 'pressing:us-mono-cl1355',
    },
    candidates: [
      {
        artist: 'Miles Davis',
        title: 'Kind of Blue',
        catalog_number: 'CL 1355',
        country: 'US',
        edition: 'mono',
        vinyl_color: 'black',
        pressing_id: 'pressing:us-mono-cl1355',
        release_id: 'rel-us-mono',
      },
      {
        artist: 'Miles Davis',
        title: 'Kind of Blue',
        catalog_number: 'SONY-123',
        country: 'JP',
        edition: 'stereo',
        vinyl_color: 'black',
        pressing_id: 'pressing:jp-stereo',
        release_id: 'rel-jp',
      },
    ],
    expected_status: 'EXACT',
    expected_pressing_id: 'pressing:us-mono-cl1355',
  },
  original_vs_reissue: {
    id: 'original_vs_reissue',
    subject: {
      artist: 'Art Blakey',
      title: 'Moanin',
      catalog_number: 'BLP-4003',
      country: 'US',
      release_year: 1958,
      edition: 'original',
      label: 'Blue Note',
    },
    candidates: [
      {
        artist: 'Art Blakey',
        title: 'Moanin',
        catalog_number: 'BLP-4003',
        country: 'US',
        release_year: 1958,
        edition: 'original',
        label: 'Blue Note',
        pressing_id: 'pressing:blp4003-orig',
        release_id: 'rel-orig',
      },
      {
        artist: 'Art Blakey',
        title: 'Moanin',
        catalog_number: 'BLP-4003',
        country: 'US',
        release_year: 2009,
        edition: 'reissue',
        label: 'Blue Note',
        pressing_id: 'pressing:blp4003-reissue',
        release_id: 'rel-reissue',
      },
    ],
    expected_status: 'EXACT',
    expected_pressing_id: 'pressing:blp4003-orig',
  },
  promo_vs_stock: {
    id: 'promo_vs_stock',
    subject: {
      artist: 'Kenny Dorham',
      title: 'Quiet Kenny',
      catalog_number: 'NJLP-8225',
      country: 'US',
      edition: 'promo',
      label: 'New Jazz',
    },
    candidates: [
      {
        artist: 'Kenny Dorham',
        title: 'Quiet Kenny',
        catalog_number: 'NJLP-8225',
        country: 'US',
        edition: 'promo',
        label: 'New Jazz',
        pressing_id: 'pressing:njlp8225-promo',
        release_id: 'rel-promo',
      },
      {
        artist: 'Kenny Dorham',
        title: 'Quiet Kenny',
        catalog_number: 'NJLP-8225',
        country: 'US',
        edition: 'stock',
        label: 'New Jazz',
        pressing_id: 'pressing:njlp8225-stock',
        release_id: 'rel-stock',
      },
    ],
    expected_status: 'EXACT',
    expected_pressing_id: 'pressing:njlp8225-promo',
  },
  picture_disc_vs_black: {
    id: 'picture_disc_vs_black',
    subject: {
      artist: 'Test Artist',
      title: 'Picture Test',
      catalog_number: 'PIC-1',
      vinyl_color: 'picture disc',
      country: 'US',
      label: 'Test',
    },
    candidates: [
      {
        artist: 'Test Artist',
        title: 'Picture Test',
        catalog_number: 'PIC-1',
        vinyl_color: 'picture disc',
        country: 'US',
        label: 'Test',
        pressing_id: 'pressing:pic-1-picture',
        release_id: 'rel-pic',
      },
      {
        artist: 'Test Artist',
        title: 'Picture Test',
        catalog_number: 'PIC-1',
        vinyl_color: 'black',
        country: 'US',
        label: 'Test',
        pressing_id: 'pressing:pic-1-black',
        release_id: 'rel-black',
      },
    ],
    expected_status: 'EXACT',
    expected_pressing_id: 'pressing:pic-1-picture',
  },
  catalog_reuse: {
    id: 'catalog_reuse',
    subject: {
      artist: 'Artist A',
      title: 'Title A',
      catalog_number: 'XYZ-100',
      country: 'US',
      label: 'Label A',
    },
    candidates: [
      {
        artist: 'Artist A',
        title: 'Title A',
        catalog_number: 'XYZ-100',
        country: 'US',
        label: 'Label A',
        pressing_id: 'pressing:xyz100-a',
        release_id: 'rel-a',
      },
      {
        artist: 'Artist B',
        title: 'Title B',
        catalog_number: 'XYZ-100',
        country: 'UK',
        label: 'Label B',
        pressing_id: 'pressing:xyz100-b',
        release_id: 'rel-b',
      },
    ],
    expected_status: 'EXACT',
    expected_pressing_id: 'pressing:xyz100-a',
  },
  label_variation: {
    id: 'label_variation',
    subject: {
      artist: 'Lee Morgan',
      title: 'The Sidewinder',
      catalog_number: 'BLP-4157',
      country: 'US',
      label: 'Blue Note',
      release_year: 1964,
    },
    candidates: [
      {
        artist: 'Lee Morgan',
        title: 'The Sidewinder',
        catalog_number: 'BLP-4157',
        country: 'US',
        label: 'Blue Note',
        release_year: 1964,
        pressing_id: 'pressing:blp4157-bn',
        release_id: 'rel-bn',
      },
      {
        artist: 'Lee Morgan',
        title: 'The Sidewinder',
        catalog_number: 'BLP-4157',
        country: 'US',
        label: 'Liberty',
        release_year: 1967,
        pressing_id: 'pressing:blp4157-liberty',
        release_id: 'rel-liberty',
      },
    ],
    expected_status: 'EXACT',
    expected_pressing_id: 'pressing:blp4157-bn',
  },
  matrix_mismatch: {
    id: 'matrix_mismatch',
    subject: {
      artist: 'John Coltrane',
      title: 'Blue Train',
      catalog_number: 'BLP-1577',
      country: 'US',
      label: 'Blue Note',
      matrix_runout: 'BN-LP-1577-A',
    },
    candidates: [
      {
        artist: 'John Coltrane',
        title: 'Blue Train',
        catalog_number: 'BLP-1577',
        country: 'US',
        label: 'Blue Note',
        matrix_runout: 'BN-LP-1577-A-RE',
        pressing_id: 'pressing:blp1577-re',
        release_id: 'rel-re',
      },
    ],
    expected_status: 'CONTRADICTED',
    expected_pressing_id: null,
  },
  wrong_country: {
    id: 'wrong_country',
    subject: {
      artist: 'Miles Davis',
      title: 'Kind of Blue',
      catalog_number: 'CL 1355',
      country: 'US',
      label: 'Columbia',
      matrix_runout: 'XLP-123',
    },
    candidates: [
      {
        artist: 'Miles Davis',
        title: 'Kind of Blue',
        catalog_number: 'CL 1355',
        country: 'JP',
        label: 'Columbia',
        matrix_runout: 'JP-OTHER',
        pressing_id: 'pressing:jp-cl1355',
        release_id: 'rel-jp-cl',
      },
    ],
    expected_status: 'CONTRADICTED',
    expected_pressing_id: null,
  },
  unknown_pressing: {
    id: 'unknown_pressing',
    subject: {
      artist: 'Unknown Artist',
      title: 'Unknown Title',
    },
    candidates: [],
    expected_status: 'RELEASE_LEVEL_ONLY',
    expected_pressing_id: null,
  },
});

export function runAdversarialPressingFixture(fixtureOrId) {
  const fixture =
    typeof fixtureOrId === 'string'
      ? ADVERSARIAL_PRESSING_FIXTURES[fixtureOrId]
      : fixtureOrId;
  if (!fixture) throw new Error(`UNKNOWN_ADVERSARIAL_FIXTURE:${fixtureOrId}`);
  const resolution = resolvePressing({
    subject: fixture.subject,
    candidates: fixture.candidates,
  });
  return { fixture, resolution };
}

export function listAdversarialPressingFixtureIds() {
  return Object.keys(ADVERSARIAL_PRESSING_FIXTURES);
}
