import type { NextRequest } from 'next/server'

import { proxyGatewayRequest } from '@/lib/gateway-proxy'

const settingsPath = '/listings/settings'

/** Alias `/api/settings` → marketplace listings settings on the gateway. */
export async function GET(request: NextRequest) {
  return proxyGatewayRequest(request, settingsPath)
}

export async function PUT(request: NextRequest) {
  return proxyGatewayRequest(request, settingsPath)
}

export const dynamic = 'force-dynamic'
