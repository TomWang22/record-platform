import { request } from '@playwright/test'

import {
  AUTH_EMAIL,
  BUYER_CONTRACT_EMAIL,
  SELLER_CONTRACT_EMAIL,
  warmContractAuthCache,
} from './helpers/auth'

async function globalSetup(): Promise<void> {
  const baseURL = (process.env.E2E_API_BASE ?? 'https://record-platform.test').replace(/\/$/, '')
  const ctx = await request.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'X-RP-E2E-Contract': '1',
    },
  })
  await warmContractAuthCache(ctx, [AUTH_EMAIL, SELLER_CONTRACT_EMAIL, BUYER_CONTRACT_EMAIL])
  await ctx.dispose()
}

export default globalSetup
