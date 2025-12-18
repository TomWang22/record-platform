import { NextResponse } from 'next/server'

/**
 * Health check endpoint for Kubernetes probes
 * Returns 200 OK if the service is healthy
 */
export async function GET() {
  try {
    // Basic health check - service is running
    return NextResponse.json(
      {
        status: 'healthy',
        service: 'webapp',
        timestamp: new Date().toISOString(),
        version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
      },
      { status: 200 }
    )
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    )
  }
}

