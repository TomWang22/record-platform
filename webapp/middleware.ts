import { NextResponse, type NextRequest } from 'next/server'
export function middleware(req: NextRequest) {
  const url = req.nextUrl
  for (const [k, v] of url.searchParams.entries()) {
    if (/[<>\"'`;(){}]/.test(v)) {
      url.searchParams.set(k, v.replace(/[<>\"'`;(){}]/g, ''))
      return NextResponse.redirect(url)
    }
  }
  const res = NextResponse.next()
  res.headers.set('X-DNS-Prefetch-Control','off')
  return res
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
