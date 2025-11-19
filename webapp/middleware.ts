import { NextResponse, type NextRequest } from 'next/server'

const DISALLOWED = /[<>\"'`;(){}]/g
const DEFAULT_ORIGINS = [
  'https://record-platform.dev',
  'https://record-platform.local',
  'http://localhost:3000',
  'http://localhost:3001',
]
const ENV_ORIGINS = (process.env.NEXT_PUBLIC_ALLOWED_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const ALLOWED_ORIGINS = Array.from(new Set([...ENV_ORIGINS, ...DEFAULT_ORIGINS]))

const BASE_HEADERS = {
  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
}

function sanitizeUrl(url: URL): URL | null {
  let mutated = false
  for (const [k, v] of url.searchParams.entries()) {
    if (DISALLOWED.test(v)) {
      url.searchParams.set(k, v.replace(DISALLOWED, ''))
      mutated = true
    }
  }
  return mutated ? url : null
}

function buildCorsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin')
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || '*'
  return {
    ...BASE_HEADERS,
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Expose-Headers': 'X-Request-Id, X-Cache',
  }
}

export function middleware(req: NextRequest) {
  const sanitized = sanitizeUrl(req.nextUrl)
  if (sanitized) {
    return NextResponse.redirect(sanitized)
  }

  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders })
  }

  const res = NextResponse.next()
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.headers.set(key, value)
  }
  res.headers.set('X-DNS-Prefetch-Control', 'off')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return res
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
