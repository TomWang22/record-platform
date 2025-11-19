/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const corsHeaders = [
  { key: 'Access-Control-Allow-Origin', value: process.env.NEXT_PUBLIC_ALLOWED_ORIGIN || '*' },
  { key: 'Access-Control-Allow-Headers', value: 'Origin, X-Requested-With, Content-Type, Accept, Authorization' },
  { key: 'Access-Control-Allow-Methods', value: 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS' },
  { key: 'Access-Control-Allow-Credentials', value: 'true' },
]

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // so the Dockerfile can copy .next/standalone
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [...securityHeaders, ...corsHeaders],
      },
    ]
  },
}

export default nextConfig;
