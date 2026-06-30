# SETUP — what you do

Five things only YOU can provide are marked **[YOU]**. Everything else is built.

## 0. See it work right now (no box2d, 1 minute)

```bash
cd replay-renderer
npm install
npm run demo            # -> demo-thumb.png   (the trail look; stand-in physics)
```

If you get a trail image, the decode→sim→trail spine works. The motion is fake here
(stand-in physics); the real physics comes next.

## 1. Drop in bonk's two files  **[YOU]**

Put these in `vendor/` (gitignored, never committed):

- `vendor/alpha2s.js`           — bonk's client source
- `vendor/Box2DModuleGJMod.js`  — the exact box2d build your client loads

## 2. Generate the two build artifacts

```bash
npm run build:core      # vendor/alpha2s.js          -> vendor/bonk-core.mjs
npm run build:box2d     # vendor/Box2DModuleGJMod.js -> vendor/box2d.esm.js
```

Both validated to parse. `bonk-core.mjs` exports `createBonkCore(box2d)` returning the
real `Physics` / `Map` / `CanvasHandler` / `BonkView` / `Skin`.

## 3. Wire your codec  **[YOU]**

Your `codec.js` already does gzip+PSON for the decoder UI. Expose one function:

```js
export function decodeReplayData(blobBuffer) { /* gzip + PSON -> Map object */ }
```

Point three files at it (search for `EDIT THIS` / the codec import):
- `server/render-one.mjs`     (the `decodeReplayData` stub)
- `browser/thumb.worker.js`   (the `import { decodeReplayData }` line)
- pass it as a prop to `browser/ReplayPlayer.jsx`

## 4. Render one REAL replay (the proof)  **[YOU provide DATABASE_URL]**

```bash
DATABASE_URL=postgres://... npm run dump      # -> one.bin (newest replay)
npm run render                                # -> replay-render.png
```

Expected output:
```
box2d: OK
real Physics instance: Physics
replay: N discs, es=...., mode=b
wrote replay-render.png ✓
```

That PNG is a real replay from your DB, rendered through bonk's real deterministic
physics. **This is the milestone** — everything else reuses this exact path.

### If step 4 errors on load
The `headless: true` stubs let the factory load without a DOM. If a load-time line
reaches past the Proxy (e.g. a specific `document.getElementById(...).something`
chain), you'll get an error pointing at the line. Add one targeted shim to
`installHeadlessStubs` in `core/physics-loader.js` and re-run. Paste me the error and
I'll give you the exact shim.

## 5. Frontend (Bonkverse, Vite)  **[YOU]**

Copy `core/` + `browser/` into `src/replay/`. Then:

- **Search grid:** render `<ReplayGrid results={...} rawUrl={item => \`/api/replays/${item.cycle}/${item.id}/raw\`} onOpen={goToDetail} />`. You provide:
  - a search API returning result rows, and
  - a `rawUrl` endpoint that streams a replay's raw `replaydata` bytes.
- **Detail page:** `<ReplayPlayer blob={...} box2d={box2d} decodeReplayData={...} />`
  where `box2d` is `import box2d from "../vendor/box2d.esm.js"`.

Vite serves `thumb.worker.js` via `new Worker(new URL(...), { type: "module" })` — already
wired in `thumbClient.js`. Make sure `vendor/box2d.esm.js` is importable from your build
(copy it into the frontend's vendor dir too, or alias it).

## 6. One ingest change for search  **[YOU]**

Mode + map name live inside the PSON. You already decode at ingest to pull players —
extract these into indexed columns so search doesn't decode every row:

```sql
ALTER TABLE replays ADD COLUMN mode TEXT, ADD COLUMN map_name TEXT,
                    ADD COLUMN map_author TEXT, ADD COLUMN player_count INT,
                    ADD COLUMN duration_steps INT;   -- es
CREATE INDEX idx_replays_mode ON replays(mode);
-- + a pg_trgm index on map_name for fuzzy search
```

---

### Checklist
- [ ] `npm run demo` produced an image
- [ ] `vendor/alpha2s.js` + `vendor/Box2DModuleGJMod.js` in place
- [ ] `npm run build:core` + `npm run build:box2d`
- [ ] codec wired into the 3 spots
- [ ] `npm run render` produced `replay-render.png` from a real replay
- [ ] `core/` + `browser/` copied into the frontend; grid + player mounted
- [ ] search columns added at ingest
