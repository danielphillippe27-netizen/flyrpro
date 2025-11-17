import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/q/:slug",
        destination:
          "https://kfnsnwqylsdsbgnwgxva.supabase.co/functions/v1/qr_redirect?slug=:slug",
      },
    ];
  },
};

export default nextConfig;
