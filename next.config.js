/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/q/:slug",
        destination: "https://kfnsnwqylsdsbgnwgxva.supabase.co/functions/v1/qr_redirect?slug=:slug"
      }
    ];
  }
};

module.exports = nextConfig;

