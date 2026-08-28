import pg from 'pg';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
const gunzip = promisify(zlib.gunzip);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const mapid = process.argv[2];
const r = await client.query(
  'SELECT mapdata FROM maps WHERE mapid = $1::bigint ORDER BY version DESC LIMIT 1',
  [mapid]
);
if (!r.rows.length) { console.error('no such mapid'); process.exit(1); }
const buf = await gunzip(r.rows[0].mapdata);
console.log(buf.toString());
await client.end();
