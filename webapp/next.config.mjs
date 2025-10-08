/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone' // so the Dockerfile can copy .next/standalone
};
export default nextConfig;
