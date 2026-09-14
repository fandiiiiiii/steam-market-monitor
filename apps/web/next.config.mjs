/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@steam-monitor/core"],
  // 依赖安装环境可能无法稳定运行 lint 插件，lint 统一走根目录 pnpm lint
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
