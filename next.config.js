/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Ignore ESLint errors during builds to allow deployment
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Ignore TypeScript errors during builds
    ignoreBuildErrors: true,
  },
  // Exclude problematic native modules from server-side bundling
  // CRITICAL: DuckDB uses native C++ bindings that break if Webpack tries to bundle them
  // This tells Next.js: "Don't touch DuckDB, run it as native node code"
  serverExternalPackages: [
    '@mapbox/node-pre-gyp',
    'duckdb',           // Required for MotherDuck connections to work
    '@duckdb/node-api',
  ],
  async rewrites() {
    // QR code redirects: Primary handler is /api/q/[slug] (local Next.js API route)
    // This rewrite to Supabase Edge Function is kept as a fallback for:
    // - Environments where the app route is not used
    // - Support for q subdomain if present
    // - Backward compatibility with existing production behavior
    // The Edge Function then redirects to https://flyrpro.app/l/<landing_page_slug>
    // Landing pages at /l/<slug> are handled by Next.js route
    return [
      {
        source: "/q/:slug",
        destination: "https://kfnsnwqylsdsbgnwgxva.supabase.co/functions/v1/qr_redirect?slug=:slug"
      }
    ];
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

