// server/dev-api.mjs

import express from "express";
import pg from "pg";
import { decodeStoredReplay } from "./codec.js";

const { Client } = pg;

const app = express();
const port = 5174;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

function makeClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  return new Client({
    connectionString: process.env.DATABASE_URL,
  });
}

app.get("/api/replay/:id", async (req, res) => {
  const { id } = req.params;
  const cycle = req.query.cycle ? Number(req.query.cycle) : null;

  const client = makeClient();

  try {
    await client.connect();

    const result = await client.query(
      `
      SELECT cycle, id, replaydata
      FROM replays
      WHERE id = $1::bigint
        AND ($2::int IS NULL OR cycle = $2::int)
      ORDER BY fetched_at DESC
      LIMIT 1
      `,
      [id, cycle]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: `Replay not found: ${id}` });
    }

    const row = result.rows[0];
    const decoded = decodeStoredReplay(row.replaydata);

    return res.json({
      cycle: row.cycle,
      id: row.id,
      decoded,
    });
  } catch (err) {
    console.error("GET /api/replay/:id failed:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();

  if (!q) {
    return res.json({ results: [] });
  }

  const client = makeClient();

  try {
    await client.connect();

    const isNumeric = /^\d+$/.test(q);

    const result = await client.query(
      `
      SELECT
        r.id::text AS id,
        r.cycle,
        r.mapid::text AS mapid,
        r.fetched_at,
        COALESCE(
          array_remove(array_agg(rp.username ORDER BY rp.username), NULL),
          '{}'
        ) AS players
      FROM replays r
      LEFT JOIN replay_players rp
        ON rp.cycle = r.cycle
      AND rp.replay_id = r.id
      WHERE
        r.id::text = $1
        OR rp.username ILIKE '%' || $1 || '%'
        OR r.mapid::text = $1
      GROUP BY r.cycle, r.id, r.mapid, r.fetched_at
      ORDER BY r.fetched_at DESC
      LIMIT 25
      `,
      [q]
    );

    return res.json({ results: result.rows });
  } catch (err) {
    console.error("GET /api/search failed:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.url}` });
});

app.listen(port, () => {
  console.log(`Replay dev API running at http://127.0.0.1:${port}`);
});