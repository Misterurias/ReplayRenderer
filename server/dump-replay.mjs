// server/dump-replay.mjs
import { writeFileSync } from "node:fs";
import pg from "pg";

const { Client } = pg;

const id = process.argv[2];
if (!id) throw new Error("Usage: node server/dump-replay.mjs <replay_id>");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const result = await client.query(
  `SELECT replaydata FROM replays WHERE id = $1 LIMIT 1`,
  [id]
);

await client.end();

if (!result.rows.length) throw new Error(`Replay not found: ${id}`);

writeFileSync("./one.bin", result.rows[0].replaydata);

console.log(`wrote ./one.bin for replay ${id}`);