/** @type {import('next').NextConfig} */
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : null;

if (!supabaseHost) {
  console.warn('NEXT_PUBLIC_SUPABASE_URL is not set; Supabase image remote pattern and function rewrite are disabled.');
}

const supabaseRemotePatterns = supabaseHost
  ? [
      {
        protocol: 'https',
        hostname: supabaseHost,
      },
    ]
  : [];

const supabaseFunctionsBaseUrl = supabaseHost ? `https://${supabaseHost}/functions/v1` : null;

const nextConfig = {
  eslint: {
    // TODO: Re-enable once TypeScript errors are resolved.
    // Current error count: 343 (as of May 2026). See KNOWN_ISSUES.md.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // TODO: Re-enable once TypeScript errors are resolved.
    // Current error count: 343 (as of May 2026). See KNOWN_ISSUES.md.
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      ...supabaseRemotePatterns,
    ],
  },
  // Exclude problematic native modules from server-side bundling
  // CRITICAL: DuckDB uses native C++ bindings that break if Webpack tries to bundle them
  // This tells Next.js: "Don't touch DuckDB, run it as native node code"
  serverExternalPackages: [
    '@mapbox/node-pre-gyp',
    'duckdb',           // Required for MotherDuck connections to work
    '@duckdb/node-api',
  ],
  async redirects() {
    return [
      {
        source: "/members",
        destination: "/routes",
        permanent: true,
      },
      {
        source: "/members/:path*",
        destination: "/routes/:path*",
        permanent: true,
      },
      {
        source: "/terms-of-service",
        destination: "/terms",
        permanent: true,
      },
      {
        source: "/terms-and-conditions",
        destination: "/terms",
        permanent: true,
      },
      {
        source: "/tos",
        destination: "/terms",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
        ],
      },
      {
        source: "/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
        ],
      },
    ];
  },
  async rewrites() {
    // QR code redirects: Primary handler is /api/q/[slug] (local Next.js API route)
    // This rewrite to Supabase Edge Function is kept as a fallback for:
    // - Environments where the app route is not used
    // - Support for q subdomain if present
    // - Backward compatibility with existing production behavior
    // The Edge Function then redirects to https://flyrpro.app/l/<landing_page_slug>
    // Landing pages at /l/<slug> are handled by Next.js route
    return supabaseFunctionsBaseUrl
      ? [
          {
            source: "/q/:slug",
            destination: `${supabaseFunctionsBaseUrl}/qr_redirect?slug=:slug`
          }
        ]
      : [];
  },
  webpack: (config, { isServer }) => {
    // Fix for Mapbox GL JS
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    
    // Handle Mapbox worker files
    config.module.rules.push({
      test: /\.worker\.js$/,
      type: 'asset/resource',
      generator: {
        filename: 'static/[hash][ext][query]'
      }
    });

    return config;
  },
};

module.exports = nextConfig;
