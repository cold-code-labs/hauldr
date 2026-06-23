/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: [
    "@cold-code-labs/yggdrasil-tokens",
    "@cold-code-labs/yggdrasil-brand",
    "@cold-code-labs/yggdrasil-react",
  ],
};
export default nextConfig;
