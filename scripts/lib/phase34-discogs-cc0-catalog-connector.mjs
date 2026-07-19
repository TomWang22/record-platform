/**
 * Phase 34 Discogs CC0 catalog connector stub.
 *
 * Ingests only CC0 dump catalog metadata. Does not download dumps in this stub.
 * Never touches Discogs restricted marketplace fields or API secrets.
 */
export const CONNECTOR_STATUS = 'ENABLED';

export const ALLOWED_FIELDS = Object.freeze([
  'artist',
  'release',
  'master',
  'label',
  'title',
  'date',
  'format',
  'track_list',
  'credits',
  'barcode',
  'catalog_identifiers',
  'version_relationships',
  'permitted_notes',
  'permitted_urls',
]);

export const RESTRICTED_FIELD_KEYS = Object.freeze([
  'marketplace_inventory',
  'marketplace_prices',
  'pricing_suggestions',
  'marketplace_sales_history',
  'collection',
  'wantlist',
  'user_data',
  'restricted_images',
  'orders',
  'fees',
  'api_key',
  'discogs_api_key',
  'oauth_token',
  'oauth_token_secret',
]);

export const DUMP_INDEX_URL =
  'https://discogs-data-dumps.s3.us-west-2.amazonaws.com/index.html';

const PROVENANCE_KEYS = Object.freeze([
  'source_release_id',
  'source_master_id',
  'source_artist_id',
  'source_label_id',
  'source_dump_date',
  'source_content_hash',
  'source_url',
  'license',
  'ingested_at',
  'normalized_at',
]);

/**
 * Build a normalized CC0 catalog record retaining required provenance fields.
 */
export function buildCatalogRecord(input = {}) {
  assertNoRestrictedFields(input);
  const now = new Date().toISOString();
  const record = {
    source_release_id: input.source_release_id ?? null,
    source_master_id: input.source_master_id ?? null,
    source_artist_id: input.source_artist_id ?? null,
    source_label_id: input.source_label_id ?? null,
    source_dump_date: input.source_dump_date ?? null,
    source_content_hash: input.source_content_hash ?? null,
    source_url: input.source_url ?? null,
    license: 'CC0',
    ingested_at: input.ingested_at ?? now,
    normalized_at: input.normalized_at ?? now,
  };

  for (const key of ALLOWED_FIELDS) {
    if (key in input && input[key] !== undefined) {
      record[key] = input[key];
    }
  }

  for (const key of PROVENANCE_KEYS) {
    if (!(key in record)) {
      throw new Error(`missing_provenance:${key}`);
    }
  }
  if (record.license !== 'CC0') {
    throw new Error('license_must_be_CC0');
  }
  assertNoRestrictedFields(record);
  return record;
}

/**
 * Fail closed if any restricted marketplace / secret field key is present.
 */
export function assertNoRestrictedFields(obj) {
  if (!obj || typeof obj !== 'object') return true;
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    for (const [k, v] of Object.entries(cur)) {
      const key = String(k).toLowerCase();
      if (RESTRICTED_FIELD_KEYS.some((r) => key === r || key.includes(r))) {
        const err = new Error(`restricted_field_present:${k}`);
        err.code = 'DISCOGS_CC0_RESTRICTED_FIELD';
        throw err;
      }
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return true;
}

/**
 * Stub dump-manifest ingest: reports readiness without downloading.
 */
export function ingestDumpManifest(options = {}) {
  const dump_index_url = options.dump_index_url || DUMP_INDEX_URL;
  return {
    status: 'READY_NOT_INGESTED',
    dump_index_url,
    connector_status: CONNECTOR_STATUS,
    allowed_fields: [...ALLOWED_FIELDS],
    note: 'Discogs CC0 dump connector stub — manifest acknowledged; no download performed.',
  };
}
