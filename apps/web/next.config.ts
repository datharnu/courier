import type { NextConfig } from "next";

const scriptSrc = ["'self'", "'unsafe-inline'", process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""]
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  // @qorechain/pqc 0.2.3 verifies in JavaScript. It does not load WebAssembly.
  "connect-src 'self' https://evm-testnet.qore.host",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * The one QoreChain REST route the browser needs: the ML-KEM-1024 key registry, for a qor1 address.
 * The REST API sends no CORS headers, so /app/try reads it through this same-origin rewrite. It is a
 * read-only path: no other REST route is exposed, no key or token is held, and the upstream serves GET only.
 */
const QORE_REST = "https://api-testnet.qore.host";
const QOR_ADDRESS = "qor1[02-9ac-hj-np-z]{38}";

const nextConfig: NextConfig = {
  agentRules: false,
  turbopack: { root: process.cwd() },
  async rewrites() {
    return [{ source: `/chain-rest/kem/:address(${QOR_ADDRESS})`, destination: `${QORE_REST}/qorechain/pqc/v1/kem/:address` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
