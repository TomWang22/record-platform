import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Deterministic deploy marker for edge rollout proof (not secret). */
export async function GET() {
  const buildSha =
    process.env.NEXT_PUBLIC_RP_WEBAPP_BUILD_SHA ||
    process.env.RP_WEBAPP_BUILD_SHA ||
    'unknown'
  const buildAt =
    process.env.NEXT_PUBLIC_RP_WEBAPP_BUILD_AT ||
    process.env.RP_WEBAPP_BUILD_AT ||
    'unknown'

  return NextResponse.json(
    {
      service: 'webapp',
      buildSha,
      buildAt,
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-RP-Webapp-Build-Sha': buildSha,
        'X-RP-Webapp-Build-At': buildAt,
      },
    },
  )
}
