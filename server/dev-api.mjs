// server/dev-api.mjs
//
// Local development entry point: its own port, permissive localhost-only
// CORS (the Vite dev server runs on a different port, so cross-origin
// requests need explicit CORS headers here). The actual route logic lives in
// api-routes.mjs, shared with server/prod-server.mjs so there's exactly one
// implementation of search/thumbnail/replay-fetch to maintain.

import express from "express";
import pg from "pg";
import { registerApiRoutes, createPool } from "./api-routes.mjs";

const { Pool } = pg;

const app = express();
const port = 5174;

const pool = createPool(Pool);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

registerApiRoutes(app, pool);

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.url}` });
});

app.listen(port, () => {
  console.log(`Replay dev API running at http://127.0.0.1:${port}`);
});
