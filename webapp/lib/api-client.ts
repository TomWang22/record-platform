import config from './config'
import { getClientSessionToken } from './session'

export class ApiError extends Error {
  readonly details: {
    method: string
    path: string
    status?: number
    body?: string
    cause?: unknown
  }

  constructor(
    message: string,
    details: {
      method: string
      path: string
      status?: number
      body?: string
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'ApiError'
    this.details = details
  }

  get status(): number {
    return this.details.status ?? 0
  }
}

type RequestOpts = RequestInit & {
  auth?: boolean
  data?: Record<string, unknown> | Array<unknown>
}

/**
 * Resolve the fetch URL for a given API path.
 *
 * Browser-side: paths starting with "/" are kept as same-origin relative URLs
 * so the browser fetches through the Caddy TLS edge (same host).
 * Absolute URLs (http(s)://) are passed through unchanged.
 *
 * Server-side (SSR): a gateway base URL is prepended so Next.js API routes
 * can reach the internal api-gateway service.
 */
function resolveUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  const isClient = typeof window !== 'undefined'
  if (isClient) {
    return path
  }
  return `${config.gatewayUrl}${path}`
}

export async function apiFetch<T>(path: string, { auth = false, data, headers, ...init }: RequestOpts = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const requestHeaders = new Headers(headers)

  requestHeaders.set('Accept', 'application/json')

  if (data) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  const isClient = typeof window !== 'undefined'
  if (auth && isClient) {
    const token = getClientSessionToken()
    if (token) {
      requestHeaders.set('Authorization', `Bearer ${token}`)
    }
  }

  const url = resolveUrl(path)

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      method,
      headers: requestHeaders,
      body: data ? JSON.stringify(data) : init.body,
      credentials: isClient ? 'include' : init.credentials,
    })
  } catch (error) {
    throw new ApiError(`API ${method} ${path} failed: network error`, {
      method,
      path,
      cause: error,
    })
  }

  if (!response.ok) {
    const text = await safeText(response)
    const body = text.slice(0, 1_000)
    const parsed = safeJsonParse(text)
    const errorMessage = parsed?.error ?? parsed?.message ?? response.statusText
    throw new ApiError(`API ${method} ${path} → ${response.status}: ${errorMessage}`, {
      method,
      path,
      status: response.status,
      body,
    })
  }

  if (response.status === 204) {
    return null as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()

  if (
    contentType.includes('text/html') ||
    raw.trimStart().startsWith('<!DOCTYPE') ||
    raw.trimStart().startsWith('<html')
  ) {
    throw new ApiError(
      'Expected JSON but received HTML. This usually means an API route was routed to the webapp page server.',
      {
        method,
        path,
        status: response.status,
        body: raw.slice(0, 1_000),
      },
    )
  }

  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new ApiError(`API ${method} ${path} → invalid JSON response`, {
      method,
      path,
      status: response.status,
      body: raw.slice(0, 1_000),
      cause: error,
    })
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

