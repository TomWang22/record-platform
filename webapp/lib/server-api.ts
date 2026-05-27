/**
 * Server-side API helpers for Next.js API routes that proxy to the api-gateway.
 * These must NOT be imported in client components.
 */

const INTERNAL_GATEWAY_DEFAULT =
  'http://api-gateway.record-platform.svc.cluster.local:4000'

export function getApiGatewayUrl(): string {
  // Server-side proxies must reach the in-cluster gateway, not the public TLS edge
  // (NEXT_PUBLIC_GATEWAY_URL is for browser-relative fetches only).
  const value =
    process.env.API_GATEWAY_URL ??
    process.env.INTERNAL_API_GATEWAY_URL ??
    (process.env.NODE_ENV === 'production'
      ? INTERNAL_GATEWAY_DEFAULT
      : process.env.NEXT_PUBLIC_GATEWAY_URL ?? '')
  if (!value) {
    throw new Error(
      'API_GATEWAY_URL is required for server-side API proxy routes. ' +
        'Set API_GATEWAY_URL or INTERNAL_API_GATEWAY_URL (in-cluster), or NEXT_PUBLIC_GATEWAY_URL for local dev.',
    )
  }
  return value.replace(/\/+$/, '')
}

export async function proxyToGateway(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = getApiGatewayUrl()
  const url = `${base}${path}`
  return fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init.headers,
    },
  })
}
