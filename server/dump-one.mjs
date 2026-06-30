// server/dump-one.mjs
// Write one raw replaydata blob to ./one.bin so you can test rendering offline.
//
//   DATABASE_URL=postgres://... node server/dump-one.mjs            # newest replay
//   DATABASE_URL=postgres://... node server/dump-one.mjs 7 1542     # cycle 7, id 1542

import { writeFileSync } from "node:fs";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const [cycle, id] = process.argv.slice(2);
const q = cycle && id
  ? { text: "SELECT cycle, id, replaydata FROM replays WHERE cycle=$1 AND id=$2", values: [cycle, id] }
  : { text: "SELECT cycle, id, replaydata FROM replays ORDER BY fetched_at DESC LIMIT 1", values: [] };

const { rows } = await pool.query(q);
if (!rows.length) { console.error("No matching replay."); process.exit(1); }
writeFileSync("./one.bin", rows[0].replaydata);
console.log(`Wrote one.bin from replay (cycle=${rows[0].cycle}, id=${rows[0].id}), ${rows[0].replaydata.length} bytes`);
await pool.end();
