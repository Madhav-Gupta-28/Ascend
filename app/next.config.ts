import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile hashconnect + WalletConnect through Next's pipeline
  // to fix identifier collisions in production minification
  transpilePackages: [
    "hashconnect",
    "@walletconnect/sign-client",
    "@walletconnect/modal",
    "@walletconnect/auth-client",
    "@walletconnect/types",
    "@hashgraph/hedera-wallet-connect",
  ],

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // hashconnect and @hashgraph/sdk use Node.js builtins —
      // provide browser polyfills / stubs
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: require.resolve("buffer/"),
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        net: false,
        tls: false,
        fs: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

export default nextConfig;
