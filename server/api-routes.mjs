// server/api-routes.mjs
//
// The actual API logic (search, thumbnails, replay fetch), factored out of
// dev-api.mjs so it has exactly one implementation shared by both:
//   - server/dev-api.mjs — local dev, its own port, permissive localhost CORS
//   - server/prod-server.mjs — production, same origin as the built
//     frontend, no CORS needed
// Keeping this in one place means a fix or change here applies to both
// automatically, rather than needing to be copy-pasted and kept in sync.
import zlib from "node:zlib";
import { promisify } from "node:util";
import { decodeStoredReplay } from "./codec.js";
import { renderMapThumbnailSvg } from "./map-render/renderMapThumbnailSvg.mjs";

const gunzip = promisify(zlib.gunzip);

const PAGE_SIZE = 25;

export function registerApiRoutes(app, pool) {
  app.get("/api/replay/:id", async (req, res) => {
    const { id } = req.params;
    const cycle = req.query.cycle ? Number(req.query.cycle) : null;

    try {
      const result = await pool.query(
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
    }
  });

  // ─── Map thumbnails ─────────────────────────────────────────────────────
  //
  // Real SVG markup (see server/map-render/renderMapThumbnailSvg.mjs)
  // rendered from the already-populated `maps.mapdata` (physics + capZones,
  // gzip'd JSON — see the scraper's compressJsonForStorage). One thumbnail
  // per mapid (latest version), not per replay, and cached for an hour.
  app.get("/api/map/:mapid/thumbnail.svg", async (req, res) => {
    const mapid = req.params.mapid;

    try {
      const result = await pool.query(
        `SELECT mapdata FROM maps WHERE mapid = $1::bigint ORDER BY version DESC LIMIT 1`,
        [mapid]
      );

      if (!result.rows.length || !result.rows[0].mapdata) {
        return res.status(404).send("No map data for this mapid");
      }

      const buf = await gunzip(result.rows[0].mapdata);
      const mapData = JSON.parse(buf.toString());

      const svg = renderMapThumbnailSvg(mapData);

      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(svg);
    } catch (err) {
      console.error("GET /api/map/:mapid/thumbnail.svg failed:", err);
      return res.status(500).send("Thumbnail generation failed");
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

    try {
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

      // Total distinct matching replays — mirrors the joins in the main
      // query so the count reflects exactly what's filterable, not raw
      // joined row count (a plain COUNT(*) here would over-count replays
      // with multiple players).
      const countResult = await pool.query(
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

      const result = await pool.query(
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
    }
  });
}

// Shared pool factory, also used by both servers — same connection-pooling
// rationale as before (see dev-api.mjs git history / prior conversation):
// avoids a fresh TCP+TLS+auth handshake on every single request.
export function createPool(Pool) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

  pool.on("error", (err) => {
    console.error("Unexpected error on idle DB client:", err);
  });

  return pool;
}
