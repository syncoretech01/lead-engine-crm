import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) so the app
  // runs as `node server.js` under systemd on the EC2 instance without shipping
  // all of node_modules.
  output: "standalone",
  turbopack: {
    root: __dirname
  },
  experimental: {
    // 1:1 email attachments post through a server action as multipart FormData;
    // the default 1 MB cap would reject them. Headroom over the 10 MB attachment
    // total enforced in readEmailAttachments.
    serverActions: {
      bodySizeLimit: "12mb"
    }
  }
};

export default nextConfig;
