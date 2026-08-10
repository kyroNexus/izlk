/** @type {import('next').NextConfig} */
const nextConfig = {
  // Folder import accepts up to 750 MB; the request limit must not be lower.
  experimental: { serverActions: { bodySizeLimit: '800mb' } },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        // SAMEORIGIN blocks third-party framing but lets the protected PDF/image
        // viewer render a document from this very application in Firefox.
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:" },
      ],
    }, {
      // This protected endpoint is intentionally embedded by our own viewer.
      // It follows the global rule so the endpoint-specific headers win.
      source: '/api/documents/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Content-Security-Policy', value: "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'" },
      ],
    }]
  },
};

export default nextConfig;
