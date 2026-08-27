// server/dev-api.mjs

import express from "express";
import pg from "pg";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { decodeStoredReplay } from "./codec.js";

const gunzip = promisify(zlib.gunzip);

const { Client } = pg;

const app = express();
const port = 5174;

const PAGE_SIZE = 25;

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

// ─── Map thumbnails ──────────────────────────────────────────────────────────
//
// Generates a static SVG outline of a map's wall/platform geometry from the
// already-populated `maps.mapdata` (physics + capZones, gzip'd JSON — see the
// scraper's compressJsonForStorage). Deliberately NOT a rendered replay frame:
// that requires the full box2d + PIXI engine, which is far too heavy to boot
// once per result card in a list. This is pure shape-position math.
//
// Handles the three shape types bonk.io's own client renders, per
// MapRenderer.build() in the decompiled source AND independently confirmed
// against github.com/Misterurias/BonkMapEditor's Shape/Box/Circle/Polygon
// classes (Shape.TYPE only has BOX/CIRCLE/POLYGON — no edge-chain type
// exists in either source, so this coverage is believed complete, not
// partial):
//   "bx" (box)     — w, h, c:[x,y], a (rotation, radians)
//   "ci" (circle)  — r, c:[x,y] (no rotation)
//   "po" (polygon) — v:[[x,y], ...], drawn as absolute/world-space points.
//                    Note: BonkMapEditor's own .bonk file format stores
//                    polygons decomposed (separate c/a/s + local vertices),
//                    but MapRenderer.build() never reads c/a for the "po"
//                    case when rendering a replay — only v[] — and thumbnails
//                    render as coherent shapes under that assumption. Treated
//                    as an authoring-format-vs-runtime-format difference
//                    rather than a bug; worth re-confirming against one real
//                    polygon-heavy replay if this ever looks wrong.
//
// Each shape is filled with its own fixture's real color (fixtures[i].f, a
// packed RGB int matched to shapes[i] by array index — same pattern as
// avatar colors in skin-render.js) rather than one flat color, so thumbnails
// resemble the actual map instead of a uniform silhouette.
//
// One thumbnail is generated per mapid (latest version), not per replay, and
// cached for an hour — most search results share a handful of popular maps,
// so this avoids redundant identical renders across a results page.

const DEFAULT_SHAPE_FILL = "#64748b";

function colorToHex(packedRgb) {
  if (!Number.isFinite(packedRgb)) return null;
  return `#${(packedRgb >>> 0 & 0xffffff).toString(16).padStart(6, "0")}`;
}

function generateMapThumbnailSvg(physics) {
  const shapes = Array.isArray(physics?.shapes) ? physics.shapes : [];
  const fixtures = Array.isArray(physics?.fixtures) ? physics.fixtures : [];

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const grow = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  const elements = [];

  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    if (!s) continue;

    const fill = colorToHex(fixtures[i]?.f) ?? DEFAULT_SHAPE_FILL;

    if (s.type === "bx" && Number.isFinite(s.w) && Number.isFinite(s.h) && Array.isArray(s.c) && s.c.length === 2) {
      const [cx, cy] = s.c;
      const hw = s.w / 2,
        hh = s.h / 2;
      const rad = Number.isFinite(s.a) ? s.a : 0;
      const angleDeg = (rad * 180) / Math.PI;
      const cos = Math.cos(rad),
        sin = Math.sin(rad);

      // Rotate all 4 corners to find this box's true contribution to the
      // overall bounding box (a rotated box's extent isn't just w/h at its center).
      for (const [x, y] of [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ]) {
        grow(cx + x * cos - y * sin, cy + x * sin + y * cos);
      }

      elements.push(
        `<rect x="${-hw}" y="${-hh}" width="${s.w}" height="${s.h}" transform="translate(${cx} ${cy}) rotate(${angleDeg})" fill="${fill}" />`
      );
      continue;
    }

    if (s.type === "ci" && Number.isFinite(s.r) && Array.isArray(s.c) && s.c.length === 2) {
      const [cx, cy] = s.c;
      grow(cx - s.r, cy - s.r);
      grow(cx + s.r, cy + s.r);
      elements.push(`<circle cx="${cx}" cy="${cy}" r="${s.r}" fill="${fill}" />`);
      continue;
    }

    if (s.type === "po" && Array.isArray(s.v) && s.v.length > 0) {
      const valid = s.v.every((pt) => Array.isArray(pt) && pt.length === 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
      if (!valid) continue;

      for (const [x, y] of s.v) grow(x, y);

      const points = s.v.map(([x, y]) => `${x},${y}`).join(" ");
      elements.push(`<polygon points="${points}" fill="${fill}" />`);
      continue;
    }
  }

  if (elements.length === 0) return null;

  const pad = 4;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = Math.max(1, maxX - minX + pad * 2);
  const vbH = Math.max(1, maxY - minY + pad * 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#102033" />
  <g>${elements.join("")}</g>
</svg>`;
}

app.get("/api/map/:mapid/thumbnail.svg", async (req, res) => {
  const mapid = req.params.mapid;
  const client = makeClient();

  try {
    await client.connect();

    const result = await client.query(
      `SELECT mapdata FROM maps WHERE mapid = $1::bigint ORDER BY version DESC LIMIT 1`,
      [mapid]
    );

    if (!result.rows.length || !result.rows[0].mapdata) {
      return res.status(404).send("No map data for this mapid");
    }

    const buf = await gunzip(result.rows[0].mapdata);
    const mapData = JSON.parse(buf.toString());

    const svg = generateMapThumbnailSvg(mapData?.physics);

    if (!svg) {
      return res.status(404).send("No renderable shapes on this map");
    }

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(svg);
  } catch (err) {
    console.error("GET /api/map/:mapid/thumbnail.svg failed:", err);
    return res.status(500).send("Thumbnail generation failed");
  } finally {
    await client.end().catch(() => {});
  }
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const field = String(req.query.field || "all"); // 'all' | 'username' | 'id' | 'mapid' | 'mapname'

  const pageParam = parseInt(req.query.page, 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;

  if (!q) {
    return res.json({ results: [], page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 });
  }

  const client = makeClient();

  try {
    await client.connect();

    let whereClause;
    switch (field) {
      case "username":
        whereClause = `rp.username ILIKE '%' || $1 || '%'`;
        break;
      case "id":
        whereClause = `r.id::text = $1`;
        break;
      case "mapid":
        whereClause = `r.mapid::text = $1`;
        break;
      case "mapname":
        whereClause = `m.name ILIKE '%' || $1 || '%'`;
        break;
      default:
        whereClause = `
          r.id::text = $1
          OR r.mapid::text = $1
          OR rp.username ILIKE '%' || $1 || '%'
          OR m.name ILIKE '%' || $1 || '%'
        `;
    }

    // Total distinct matching replays — mirrors the joins in the main query so
    // the count reflects exactly what's filterable, not raw joined row count
    // (a plain COUNT(*) here would over-count replays with multiple players).
    const countResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT DISTINCT r.cycle, r.id
        FROM replays r
        LEFT JOIN replay_players rp
          ON rp.cycle = r.cycle
          AND rp.replay_id = r.id
        LEFT JOIN LATERAL (
          SELECT name
          FROM maps m2
          WHERE m2.mapid = r.mapid
          ORDER BY m2.version DESC
          LIMIT 1
        ) m ON true
        WHERE ${whereClause}
      ) sub
      `,
      [q]
    );

    const total = countResult.rows[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const result = await client.query(
      `
      SELECT
        r.id::text AS id,
        r.cycle,
        r.mapid::text AS mapid,
        m.name AS mapname,
        r.fetched_at,
        COALESCE(
          array_remove(array_agg(rp.username ORDER BY rp.username), NULL),
          '{}'
        ) AS players
      FROM replays r
      LEFT JOIN replay_players rp
        ON rp.cycle = r.cycle
        AND rp.replay_id = r.id
      LEFT JOIN LATERAL (
        SELECT name
        FROM maps m2
        WHERE m2.mapid = r.mapid
        ORDER BY m2.version DESC
        LIMIT 1
      ) m ON true
      WHERE ${whereClause}
      GROUP BY r.cycle, r.id, r.mapid, m.name, r.fetched_at
      ORDER BY r.fetched_at DESC
      LIMIT $2 OFFSET $3
      `,
      [q, PAGE_SIZE, offset]
    );

    return res.json({
      results: result.rows,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages,
    });
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
