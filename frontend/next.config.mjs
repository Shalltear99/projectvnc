/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The noVNC bundle in public/novnc is plain static ES modules; nothing to compile.
  // Keep the build fully offline: no remote font fetching, no image optimisation service.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        // vnc_lite.html must be same-origin with the dashboard so the gamepad can
        // reach iframe.contentWindow. Do not add a cross-origin isolation header here.
        source: '/novnc/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ];
  },
};

export default nextConfig;
