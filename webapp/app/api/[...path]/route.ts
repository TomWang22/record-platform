import type { NextRequest } from 'next/server'

import { gatewayProxyHandlers } from '@/lib/gateway-proxy'

/**
 * Catch-all proxy for `/api/*` → internal api-gateway.
 * More specific routes (forum, messages, health, settings alias) take precedence.
 */
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = gatewayProxyHandlers()

export const dynamic = 'force-dynamic'
