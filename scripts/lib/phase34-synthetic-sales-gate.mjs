/**
 * Phase A live-runtime gate: synthetic completed-sale / force floors must be
 * unreachable from production intelligence APIs unless an explicit test hook
 * is enabled.
 */
export const SYNTHETIC_SALES_HOOK_ENV = 'PHASE34_ALLOW_SYNTHETIC_SALES';
export const UNIT_TEST_HOOKS_ENV = 'PHASE34_UNIT_TEST_HOOKS';

export function syntheticSalesAllowed() {
  return (
    process.env[SYNTHETIC_SALES_HOOK_ENV] === '1' ||
    process.env[UNIT_TEST_HOOKS_ENV] === '1'
  );
}

export function assertSyntheticSalesAllowed(context = 'runtime') {
  if (syntheticSalesAllowed()) return { ok: true, context };
  const err = new Error(`SYNTHETIC_COMPLETED_SALE_PATH_BLOCKED:${context}`);
  err.code = 'SYNTHETIC_COMPLETED_SALE_PATH_BLOCKED';
  err.context = context;
  throw err;
}
