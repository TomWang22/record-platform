import config from './config'
import { getClientSessionToken } from './session'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type RequestOpts = RequestInit & {
  auth?: boolean
  data?: Record<string, unknown> | Array<unknown>
}

export async function apiFetch<T>(path: string, { auth = false, data, headers, ...init }: RequestOpts = {}) {
  const controller = new AbortController()
  const isClient = typeof window !== 'undefined'
  const requestHeaders = new Headers(headers)

  if (data) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  if (auth && isClient) {
    const token = getClientSessionToken()
    if (token) {
      requestHeaders.set('Authorization', `Bearer ${token}`)
    }
  }

  const response = await fetch(`${config.gatewayUrl}${path}`, {
    ...init,
    headers: requestHeaders,
    body: data ? JSON.stringify(data) : init.body,
    signal: init.signal ?? controller.signal,
  })

  if (!response.ok) {
    const text = await safeJson(response)
    throw new ApiError(text?.error ?? response.statusText, response.status)
  }

  if (response.status === 204) {
    return null as T
  }

  return (await response.json()) as T
}

async function safeJson(res: Response) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

