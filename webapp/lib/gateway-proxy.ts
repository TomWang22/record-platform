import { NextRequest, NextResponse } from 'next/server'

import { getApiGatewayUrl } from './server-api'

const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'x-request-id'] as const

/**
 * Proxy a browser `/api/*` request to the internal api-gateway.
 * Preserves path (e.g. `/api/records`) so gateway `/api` rewrite middleware applies.
 */
export async function proxyGatewayRequest(
  request: NextRequest,
  gatewayPath?: string,
): Promise<NextResponse> {
  const path = gatewayPath ?? request.nextUrl.pathname
  const base = getApiGatewayUrl()
  const url = new URL(path, base)
  url.search = request.nextUrl.search

  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) {
      headers.set(name, value)
    }
  }
  if (!headers.has('accept')) {
    headers.set('Accept', 'application/json')
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  const body = hasBody ? await request.arrayBuffer() : undefined

  let upstream: Response
  try {
    upstream = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: hasBody ? body : undefined,
      cache: 'no-store',
    })
  } catch (error) {
    console.error(`[gateway-proxy] ${request.method} ${path}:`, error)
    return NextResponse.json(
      { error: 'API gateway unreachable', path },
      { status: 502 },
    )
  }

  const responseHeaders = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) {
    responseHeaders.set('Content-Type', contentType)
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

type GatewayProxyHandler = (request: NextRequest) => Promise<NextResponse>

function wrapGatewayProxy(
  gatewayPath?: string | ((request: NextRequest) => string),
): GatewayProxyHandler {
  return (request: NextRequest) => {
    const path =
      typeof gatewayPath === 'function'
        ? gatewayPath(request)
        : gatewayPath
    return proxyGatewayRequest(request, path)
  }
}

export function gatewayProxyHandlers(
  gatewayPath?: string | ((request: NextRequest) => string),
) {
  const handler = wrapGatewayProxy(gatewayPath)
  return {
    GET: handler,
    POST: handler,
    PUT: handler,
    PATCH: handler,
    DELETE: handler,
    HEAD: handler,
    OPTIONS: handler,
  }
}
