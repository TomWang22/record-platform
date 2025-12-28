/** @type {import('next').NextConfig} */
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  swcMinify: true,
  // Disable source maps for faster builds
  productionBrowserSourceMaps: false,
  // Reduce build output size
  compress: true,
  // Optimize compilation - faster builds
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  // Faster builds in Docker
  typescript: {
    // Skip type-checking during build to prevent hangs (type-check separately)
    ignoreBuildErrors: true, // Set to true to prevent build hangs - type-check separately
  },
  eslint: {
    // Don't run ESLint during build (faster, lint separately)
    ignoreDuringBuilds: true,
  },
  // Faster builds
  webpack: (config, { dev, isServer }) => {
    // Explicitly resolve path aliases for Docker builds
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname),
    }
    if (dev && !isServer) {
      // Reduce bundle size in dev
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
      }
    }
    return config
  },
  experimental: {
    // Faster refresh and package imports
    optimizePackageImports: ['lucide-react', 'recharts'],
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
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
