// server/prod-server.mjs
//
// Production entry point (npm start). Combines what dev.jsx / vite and
// dev-api.mjs are as two separate processes locally into a single service:
// one Express app serves both the built static frontend (vite build's
// `dist/`) and the /api/* routes, from the same origin. That means:
//   - No CORS needed at all — dev-api.mjs's permissive localhost CORS
//     middleware is dev-only and intentionally not used here.
//   - browser/dev.jsx's API_BASE resolves to "" (relative paths) in this
//     build, so /api/search etc. just hit this same server.
//   - Railway (or any host) only needs to run one service, one port, one
//     DATABASE_URL — simpler and cheaper than two services that would need
//     to be wired together over the network.
//
// Must listen on process.env.PORT — Railway assigns a port at runtime and
// injects it via that env var; a hardcoded port won't receive traffic.
import express from "express";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerApiRoutes, createPool } from "./api-routes.mjs";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

const app = express();
const port = process.env.PORT || 8080;

const pool = createPool(Pool);

registerApiRoutes(app, pool);

// Static frontend build output (index.html, hashed JS/CSS bundles, and
// everything from public/ — vendor/, skin-render.js, fonts, etc. — copied
// through by vite build as-is).
app.use(express.static(distDir));

// SPA fallback: any non-API, non-file GET (e.g. a future direct-link route)
// still gets index.html so client-side state/routing can take over. Must be
// registered after express.static and after the API routes so it only
// catches what neither of those already handled. Deliberately app.use()
// with no path string, not app.get("*", ...) — Express 5's stricter
// path-to-regexp parsing doesn't accept a bare "*" the way Express 4 did.
app.use((req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Replay renderer running on port ${port}`);
});
