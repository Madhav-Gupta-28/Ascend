import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // hashconnect and its WalletConnect deps have duplicate-var issues when
  // minified by Next.js's production bundler. Transpiling them through
  // Next's pipeline fixes the identifier collision.
  transpilePackages: [
    "hashconnect",
    "@walletconnect/sign-client",
    "@walletconnect/modal",
    "@walletconnect/auth-client",
    "@walletconnect/types",
    "@hashgraph/hedera-wallet-connect",
  ],
  // Next 16 uses Turbopack by default — provide empty config to acknowledge
  turbopack: {},
};

export default nextConfig;
