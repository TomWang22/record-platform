/**
 * Phase E6 — typed intelligence action tools.
 * Each requires authz, dry-run/preview, explicit confirmation for side effects,
 * idempotency key, and audit log. Insert ≠ send.
 */
import crypto from 'node:crypto';

export const ACTION_TOOLS_VERSION = 'phase34-action-tools-v1';

export const ACTION_TOOL_NAMES = Object.freeze([
  'insert_negotiation_draft',
  'save_search',
  'watchlist_add',
  'watchlist_remove',
  'update_preference',
  'request_reembed',
  'open_listing_edit',
  'prepare_listing_price_suggestion',
  'generate_report_export',
]);

/** Tools that mutate durable state and require explicit confirmation. */
export const SIDE_EFFECT_TOOLS = Object.freeze(new Set([
  'insert_negotiation_draft',
  'save_search',
  'watchlist_add',
  'watchlist_remove',
  'update_preference',
  'request_reembed',
  'prepare_listing_price_suggestion',
  'generate_report_export',
]));

/** Preview-only / navigation — still needs authz + audit, not confirmation. */
export const PREVIEW_ONLY_TOOLS = Object.freeze(new Set([
  'open_listing_edit',
]));

function nowIso(at) {
  return at || new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function fail(code, message, details = {}) {
  const err = new Error(`${code}:${message}`);
  err.code = code;
  Object.assign(err, details);
  throw err;
}

function assertAuthz(ctx, toolName) {
  if (!ctx?.principal_id) {
    fail('ACTION_AUTHZ_REQUIRED', `principal_id required for ${toolName}`);
  }
  if (ctx.authorized === false) {
    fail('ACTION_AUTHZ_DENIED', `principal ${ctx.principal_id} not authorized for ${toolName}`);
  }
  if (Array.isArray(ctx.allowed_tools) && !ctx.allowed_tools.includes(toolName)) {
    fail('ACTION_AUTHZ_DENIED', `tool ${toolName} not in allowed_tools`);
  }
}

function assertIdempotencyKey(key) {
  if (!key || typeof key !== 'string' || key.length < 8) {
    fail('ACTION_IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key must be a string (≥8 chars)');
  }
}

/**
 * In-memory action tool runtime (audit + idempotency).
 */
export class ActionToolRuntime {
  constructor() {
    this.audit_log = [];
    this.idempotency = new Map();
    this.drafts = new Map();
    this.searches = new Map();
    this.watchlists = new Map();
    this.preferences = new Map();
    this.reembed_requests = new Map();
    this.price_suggestions = new Map();
    this.report_exports = new Map();
  }

  #audit(entry) {
    const row = {
      audit_id: newId('aud'),
      at: nowIso(entry.at),
      ...entry,
    };
    this.audit_log.push(row);
    return row;
  }

  #idempotent(toolName, key, execute) {
    const cacheKey = `${toolName}::${key}`;
    if (this.idempotency.has(cacheKey)) {
      const prior = this.idempotency.get(cacheKey);
      this.#audit({
        tool: toolName,
        idempotency_key: key,
        status: 'IDEMPOTENT_REPLAY',
        result_id: prior.result_id,
      });
      return { ...prior, idempotent_replay: true };
    }
    const result = execute();
    this.idempotency.set(cacheKey, result);
    return { ...result, idempotent_replay: false };
  }

  /**
   * Unified invoke — dry_run defaults true; side effects need confirm=true.
   */
  invoke(toolName, params = {}, ctx = {}) {
    if (!ACTION_TOOL_NAMES.includes(toolName)) {
      fail('UNKNOWN_ACTION_TOOL', `unknown tool: ${toolName}`);
    }
    assertAuthz(ctx, toolName);
    // dry_run defaults true; set dry_run:false to execute
    const isDryRun = params.dry_run === false ? false : true;
    const confirmed = params.confirm === true || params.confirmed === true;
    const idempotency_key = params.idempotency_key || ctx.idempotency_key;

    if (!isDryRun) {
      assertIdempotencyKey(idempotency_key);
      if (SIDE_EFFECT_TOOLS.has(toolName) && !confirmed) {
        fail('ACTION_CONFIRMATION_REQUIRED', `confirm=true required for ${toolName}`, {
          tool: toolName,
          preview: this.#preview(toolName, params, ctx),
        });
      }
    }

    if (isDryRun) {
      const preview = this.#preview(toolName, params, ctx);
      this.#audit({
        tool: toolName,
        principal_id: ctx.principal_id,
        dry_run: true,
        status: 'PREVIEW',
        idempotency_key: idempotency_key || null,
        preview,
      });
      return {
        ok: true,
        tool: toolName,
        dry_run: true,
        preview,
        executed: false,
        message_sent: false,
      };
    }

    return this.#idempotent(toolName, idempotency_key, () => {
      const result = this.#execute(toolName, params, ctx);
      this.#audit({
        tool: toolName,
        principal_id: ctx.principal_id,
        dry_run: false,
        confirmed: true,
        status: 'EXECUTED',
        idempotency_key,
        result_id: result.result_id,
      });
      return result;
    });
  }

  #preview(toolName, params, ctx) {
    switch (toolName) {
      case 'insert_negotiation_draft':
        return {
          action: 'insert_negotiation_draft',
          thread_id: params.thread_id || null,
          draft_body_preview: String(params.body || params.draft_body || '').slice(0, 280),
          message_sent: false,
          note: 'Insert places draft in composer only; send requires separate confirmation',
        };
      case 'save_search':
        return {
          action: 'save_search',
          query: params.query || null,
          name: params.name || null,
        };
      case 'watchlist_add':
        return { action: 'watchlist_add', listing_id: params.listing_id || null };
      case 'watchlist_remove':
        return { action: 'watchlist_remove', listing_id: params.listing_id || null };
      case 'update_preference':
        return {
          action: 'update_preference',
          key: params.key || null,
          value: params.value ?? null,
        };
      case 'request_reembed':
        return {
          action: 'request_reembed',
          entity_id: params.entity_id || params.listing_id || null,
          reason: params.reason || null,
        };
      case 'open_listing_edit':
        return {
          action: 'open_listing_edit',
          listing_id: params.listing_id || null,
          url: params.listing_id ? `/listings/${params.listing_id}/edit` : null,
          mutates: false,
        };
      case 'prepare_listing_price_suggestion':
        return {
          action: 'prepare_listing_price_suggestion',
          listing_id: params.listing_id || null,
          suggested_price: params.suggested_price ?? null,
          currency: params.currency || 'USD',
          applied: false,
        };
      case 'generate_report_export':
        return {
          action: 'generate_report_export',
          report_type: params.report_type || 'market_summary',
          format: params.format || 'json',
        };
      default:
        return { action: toolName };
    }
  }

  #execute(toolName, params, ctx) {
    const result_id = newId('act');
    switch (toolName) {
      case 'insert_negotiation_draft': {
        const draft_id = newId('draft');
        const row = {
          result_id,
          draft_id,
          thread_id: params.thread_id || null,
          body: params.body || params.draft_body || '',
          status: 'INSERTED',
          message_sent: false,
          principal_id: ctx.principal_id,
          inserted_at: nowIso(params.at),
        };
        this.drafts.set(draft_id, row);
        return {
          ok: true,
          tool: toolName,
          dry_run: false,
          executed: true,
          result_id,
          draft_id,
          message_sent: false,
          status: 'INSERTED',
        };
      }
      case 'save_search': {
        const search_id = newId('search');
        const row = {
          result_id,
          search_id,
          query: params.query || '',
          name: params.name || null,
          principal_id: ctx.principal_id,
        };
        this.searches.set(search_id, row);
        return { ok: true, tool: toolName, dry_run: false, executed: true, result_id, search_id };
      }
      case 'watchlist_add': {
        if (!params.listing_id) fail('ACTION_PARAMS_INVALID', 'listing_id required');
        const key = `${ctx.principal_id}::${params.listing_id}`;
        this.watchlists.set(key, { listing_id: params.listing_id, principal_id: ctx.principal_id, active: true });
        return {
          ok: true, tool: toolName, dry_run: false, executed: true, result_id,
          listing_id: params.listing_id, active: true,
        };
      }
      case 'watchlist_remove': {
        if (!params.listing_id) fail('ACTION_PARAMS_INVALID', 'listing_id required');
        const key = `${ctx.principal_id}::${params.listing_id}`;
        this.watchlists.set(key, { listing_id: params.listing_id, principal_id: ctx.principal_id, active: false });
        return {
          ok: true, tool: toolName, dry_run: false, executed: true, result_id,
          listing_id: params.listing_id, active: false,
        };
      }
      case 'update_preference': {
        if (!params.key) fail('ACTION_PARAMS_INVALID', 'key required');
        const pref_id = `${ctx.principal_id}::${params.key}`;
        this.preferences.set(pref_id, { key: params.key, value: params.value, principal_id: ctx.principal_id });
        return {
          ok: true, tool: toolName, dry_run: false, executed: true, result_id,
          key: params.key, value: params.value,
        };
      }
      case 'request_reembed': {
        const entity_id = params.entity_id || params.listing_id;
        if (!entity_id) fail('ACTION_PARAMS_INVALID', 'entity_id required');
        const req_id = newId('reembed');
        this.reembed_requests.set(req_id, {
          req_id, entity_id, reason: params.reason || null, status: 'QUEUED',
        });
        return {
          ok: true, tool: toolName, dry_run: false, executed: true, result_id,
          reembed_request_id: req_id, status: 'QUEUED',
          note: 'Embedding write remains disabled unless separately enabled; MODEL_WEIGHT_TRAINING=NO',
        };
      }
      case 'open_listing_edit': {
        if (!params.listing_id) fail('ACTION_PARAMS_INVALID', 'listing_id required');
        return {
          ok: true,
          tool: toolName,
          dry_run: false,
          executed: true,
          result_id,
          listing_id: params.listing_id,
          url: `/listings/${params.listing_id}/edit`,
          mutates: false,
          message_sent: false,
        };
      }
      case 'prepare_listing_price_suggestion': {
        if (!params.listing_id) fail('ACTION_PARAMS_INVALID', 'listing_id required');
        const suggestion_id = newId('price');
        const row = {
          suggestion_id,
          listing_id: params.listing_id,
          suggested_price: params.suggested_price ?? null,
          currency: params.currency || 'USD',
          applied: false,
          principal_id: ctx.principal_id,
        };
        this.price_suggestions.set(suggestion_id, row);
        return {
          ok: true, tool: toolName, dry_run: false, executed: true, result_id,
          suggestion_id, applied: false,
          note: 'Suggestion prepared only; listing price not mutated',
        };
      }
      case 'generate_report_export': {
        const export_id = newId('export');
        const row = {
          export_id,
          report_type: params.report_type || 'market_summary',
          format: params.format || 'json',
          payload: params.payload || null,
          principal_id: ctx.principal_id,
        };
        this.report_exports.set(export_id, row);
        return {
          ok: true, tool: toolName, dry_run: false, executed: true, result_id, export_id,
        };
      }
      default:
        fail('UNKNOWN_ACTION_TOOL', `unknown tool: ${toolName}`);
    }
  }
}

/** Convenience singletons for tests / local harnesses. */
export function createActionToolRuntime() {
  return new ActionToolRuntime();
}

export function invokeActionTool(runtime, toolName, params, ctx) {
  return runtime.invoke(toolName, params, ctx);
}

export default ActionToolRuntime;
