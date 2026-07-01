import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) so the app
  // can run as `node server.js` under systemd on a single EC2 instance without
  // shipping all of node_modules. Ignored by Vercel's own build, so this is safe
  // to land while still on Vercel. (AWS migration Phase 0.)
  output: "standalone",
  turbopack: {
    root: __dirname
  }
};

export default nextConfig;
