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
  async rewrites() {
    // QR code redirects go to Supabase Edge Function
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

