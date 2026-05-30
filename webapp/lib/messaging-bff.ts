import type { NextRequest } from 'next/server'

import { getApiGatewayUrl } from './server-api'

/** Inbox thread list: api-gateway /api/messaging/threads → messaging-service /threads */
export function messagingThreadsBaseUrl(): string {
  return `${getApiGatewayUrl()}/api/messaging/threads`
}

/** Messaging REST: api-gateway /api/messages/* → messaging-service /messages/* */
export function messagingMessagesBaseUrl(): string {
  return `${getApiGatewayUrl()}/api/messages`
}

export function messagingProxyHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {}
  const auth = request.headers.get('Authorization')
  if (auth) headers.Authorization = auth
  const userId = userIdFromAuthHeader(auth)
  if (userId) headers['x-user-id'] = userId
  const email = request.headers.get('x-user-email')
  if (email) headers['x-user-email'] = email
  return headers
}

export function userIdFromAuthHeader(authHeader: string | null): string | null {
  const token = String(authHeader || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      sub?: string
    }
    return payload.sub ? String(payload.sub) : null
  } catch {
    return null
  }
}
