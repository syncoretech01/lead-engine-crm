import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) so the app
  // runs as `node server.js` under systemd on the EC2 instance without shipping
  // all of node_modules.
  output: "standalone",
  // `@syncore/contracts` is installed as `file:../syncore-contracts`, so it is a
  // symlink whose real path is OUTSIDE this project. Node, tsc and vitest all
  // follow it happily; the bundler does not, and `next build` fails with
  // "Module not found: Can't resolve '@syncore/contracts'" while every other
  // lane stays green. Listing it here makes Next compile it as first-party
  // source rather than trying to resolve it as an external dependency.
  transpilePackages: ["@syncore/contracts"],
  turbopack: {
    // The parent directory, so the `file:../syncore-contracts` sibling is inside
    // the bundler's root and resolvable. Pinned to this repo, Turbopack refuses
    // to resolve a module whose real path is outside it.
    //
    // ⚠️ `outputFileTracingRoot` must NOT be set to a different value: Next
    // requires the two to match and silently uses one of them, which makes an
    // attempt to widen only the bundler root look like it did nothing.
    root: path.join(__dirname, "..")
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
