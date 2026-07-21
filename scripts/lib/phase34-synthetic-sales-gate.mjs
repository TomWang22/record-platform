/**
 * Phase A/C live-runtime gate: synthetic completed-sale / force floors / unit-test
 * fixtures must be unreachable from production intelligence APIs unless an
 * explicit test hook is enabled.
 */
export const SYNTHETIC_SALES_HOOK_ENV = 'PHASE34_ALLOW_SYNTHETIC_SALES';
export const UNIT_TEST_HOOKS_ENV = 'PHASE34_UNIT_TEST_HOOKS';

export const FORCE_FLOOR_FIELD_NAMES = Object.freeze([
  'force_sold_floor',
  'force_watchlist_floor',
  'force_search_floor',
  'force_recommendation_floor',
  'force_analytics_floor',
  'force_negotiation_market_floor',
  'force_success_floor',
]);

export function syntheticSalesAllowed(env = process.env) {
  return env[SYNTHETIC_SALES_HOOK_ENV] === '1' || env[UNIT_TEST_HOOKS_ENV] === '1';
}

/** Alias: unit-test fixtures / force floors share the same env gate. */
export function unitTestHooksAllowed(env = process.env) {
  return syntheticSalesAllowed(env);
}

export function assertSyntheticSalesAllowed(context = 'runtime', env = process.env) {
  if (syntheticSalesAllowed(env)) return { ok: true, context };
  const err = new Error(`SYNTHETIC_COMPLETED_SALE_PATH_BLOCKED:${context}`);
  err.code = 'SYNTHETIC_COMPLETED_SALE_PATH_BLOCKED';
  err.context = context;
  throw err;
}

export function assertUnitTestHooksAllowed(context = 'runtime', env = process.env) {
  if (unitTestHooksAllowed(env)) return { ok: true, context };
  const err = new Error(`PHASE34_UNIT_TEST_HOOKS_REQUIRED:${context}`);
  err.code = 'PHASE34_UNIT_TEST_HOOKS_REQUIRED';
  err.context = context;
  throw err;
}

/**
 * Production must never boot with unit-test / synthetic-sale hooks enabled.
 * Call from service startup (Node or Python via env check).
 */
export function assertPhase34HooksDisabledInProduction(env = process.env) {
  const isProduction =
    env.NODE_ENV === 'production' ||
    String(env.RP_RUNTIME_ENV || '').toLowerCase() === 'production' ||
    String(env.ENVIRONMENT || '').toLowerCase() === 'production';
  if (!isProduction) return { ok: true };
  if (env[UNIT_TEST_HOOKS_ENV] === '1' || env[SYNTHETIC_SALES_HOOK_ENV] === '1') {
    const err = new Error(
      `PHASE34_HOOKS_FORBIDDEN_IN_PRODUCTION:${UNIT_TEST_HOOKS_ENV}=${env[UNIT_TEST_HOOKS_ENV] || ''},${SYNTHETIC_SALES_HOOK_ENV}=${env[SYNTHETIC_SALES_HOOK_ENV] || ''}`,
    );
    err.code = 'PHASE34_HOOKS_FORBIDDEN_IN_PRODUCTION';
    throw err;
  }
  return { ok: true };
}

/**
 * Live/public API bodies must not carry force_* floor fields unless hooks are on.
 * Returns the list of rejected field names (empty when allowed / absent).
 */
export function rejectForceFloorFields(body, env = process.env) {
  if (!body || typeof body !== 'object') return [];
  if (unitTestHooksAllowed(env)) return [];
  const rejected = [];
  for (const key of FORCE_FLOOR_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] != null) {
      rejected.push(key);
    }
  }
  return rejected;
}

export function assertNoForceFloorFieldsInLiveBody(body, env = process.env) {
  const rejected = rejectForceFloorFields(body, env);
  if (rejected.length === 0) return { ok: true };
  const err = new Error(`FORCE_FLOOR_FIELDS_REJECTED:${rejected.join(',')}`);
  err.code = 'FORCE_FLOOR_FIELDS_REJECTED';
  err.fields = rejected;
  throw err;
}
