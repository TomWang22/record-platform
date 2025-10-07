/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  headers: async () => ([
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          "connect-src 'self'",
          "frame-ancestors 'none'"
        ].join('; ') }
      ]
    },
    {
      source: "/:all*(js|css|svg|png|jpg|woff2)",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]
    }
  ])
};
export default nextConfig;
