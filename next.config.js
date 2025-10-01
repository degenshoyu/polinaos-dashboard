/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      // GeckoTerminal token logos
      { protocol: 'https', hostname: 'assets.geckoterminal.com', pathname: '**' },
      // Dexscreener 
      { protocol: 'https', hostname: 'cdn.dexscreener.com', pathname: '**' },
      // Twitter avatars
      { protocol: 'https', hostname: 'pbs.twimg.com', pathname: '**' },
      { protocol: 'https', hostname: 'abs.twimg.com', pathname: '**' },
      // CoinGecko images
      { protocol: 'https', hostname: 'coin-images.coingecko.com', pathname: '**' },
      { protocol: 'https', hostname: 'images.coingecko.com', pathname: '**' },
    ],
  },
  // typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;

