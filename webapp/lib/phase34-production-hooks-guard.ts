/**
 * Webapp production startup guard: PHASE34_UNIT_TEST_HOOKS / synthetic sales
 * hooks must never be enabled when NODE_ENV=production.
 *
 * Import from instrumentation / server entrypoints that run at boot, e.g.:
 *   import { guardPhase34ProductionHooks } from '@/lib/phase34-production-hooks-guard'
 *   guardPhase34ProductionHooks()
 */
export const UNIT_TEST_HOOKS_ENV = 'PHASE34_UNIT_TEST_HOOKS'
export const SYNTHETIC_SALES_HOOK_ENV = 'PHASE34_ALLOW_SYNTHETIC_SALES'

export function assertPhase34HooksDisabledInProduction(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } {
  const isProduction =
    env.NODE_ENV === 'production' ||
    String(env.RP_RUNTIME_ENV || '').toLowerCase() === 'production' ||
    String(env.ENVIRONMENT || '').toLowerCase() === 'production'
  if (!isProduction) return { ok: true }
  if (env[UNIT_TEST_HOOKS_ENV] === '1' || env[SYNTHETIC_SALES_HOOK_ENV] === '1') {
    const err = new Error(
      `PHASE34_HOOKS_FORBIDDEN_IN_PRODUCTION:${UNIT_TEST_HOOKS_ENV}=${env[UNIT_TEST_HOOKS_ENV] || ''},${SYNTHETIC_SALES_HOOK_ENV}=${env[SYNTHETIC_SALES_HOOK_ENV] || ''}`,
    ) as Error & { code: string }
    err.code = 'PHASE34_HOOKS_FORBIDDEN_IN_PRODUCTION'
    throw err
  }
  return { ok: true }
}

/** Call once during webapp server bootstrap. Throws if misconfigured. */
export function guardPhase34ProductionHooks(env: NodeJS.ProcessEnv = process.env) {
  return assertPhase34HooksDisabledInProduction(env)
}
