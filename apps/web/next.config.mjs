/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@openboat/db", "@openboat/types", "@openboat/utils"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
