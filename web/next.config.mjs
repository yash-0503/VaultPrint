/** @type {import('next').NextConfig} */
const nextConfig = {
  // WebRTC + Socket.io are sensitive to double effect invocation in React 18 Strict Mode.
  reactStrictMode: false,
  webpack: (config) => {
    // pdfjs-dist ships ESM worker; Next bundles the main lib without extra rules here.
    return config;
  },
};

export default nextConfig;
