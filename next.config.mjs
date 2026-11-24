const headers = [
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "X-Robots-Tag", value: "noindex" }, // ads are shared by link, not found through search
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" }, // may be embedded by other sites
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No X-Frame-Options: who may embed is set by frame-ancestors in middleware.ts.
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true }, // the image optimizer isn't used
  headers: async () => [{ source: "/:path*", headers }],
};

export default nextConfig;
