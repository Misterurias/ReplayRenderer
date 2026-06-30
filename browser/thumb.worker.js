// browser/thumb.worker.js  (module Web Worker)
// Grid thumbnails off the main thread. Fetches a replay blob by URL, simulates,
// renders the trail composite, caches the WebP in IndexedDB by (cycle,id).
//
// box2d + your codec are IMPORTED here (they're code, not postMessage-able data).
//
// Message in:  { type:"thumb", cycle, id, url, w?, h? }
// Message out: { type:"thumb", cycle, id, webp:ArrayBuffer }   (transferable)

import box2d from "../vendor/box2d.esm.js";
import { loadBonkCore } from "../core/physics-loader.js";
import { normalizeReplay } from "../core/decode.js";
import { simulateTrajectory } from "../core/sim.js";
import { renderTrailThumbnail, encodeThumbnail } from "../core/trail.js";

// ── EDIT THIS: your codec.js (gzipped-PSON ArrayBuffer -> decoded Map object) ──
import { decodeReplayData } from "../../scraper/codec.js"; // <-- point at your codec
// ──────────────────────────────────────────────────────────────────────────────

let physics = null;
async function getPhysics() {
  if (!physics) {
    const core = await loadBonkCore({ box2d, headless: true }); // worker has no DOM
    physics = new core.Physics();
  }
  return physics;
}

// tiny IndexedDB cache
const DB = "bonkverse-thumbs", STORE = "webp";
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const cacheGet = async (k) => { const db = await idb(); return new Promise((res) => { const t = db.transaction(STORE).objectStore(STORE).get(k); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); };
const cachePut = async (k, v) => { const db = await idb(); return new Promise((res) => { const t = db.transaction(STORE, "readwrite").objectStore(STORE).put(v, k); t.onsuccess = () => res(); t.onerror = () => res(); }); };

self.onmessage = async (e) => {
  const { type, cycle, id, url, w = 320, h = 200 } = e.data;
  if (type !== "thumb") return;
  const key = `${cycle}:${id}:${w}x${h}`;
  try {
    const hit = await cacheGet(key);
    if (hit) { const buf = hit.buffer.slice(0); self.postMessage({ type: "thumb", cycle, id, webp: buf }, [buf]); return; }

    const phys = await getPhysics();
    const blob = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const replay = normalizeReplay(await decodeReplayData(blob));
    replay.startingState.rc = (replay.startingState.rc ?? 0) + 1;

    const traj = simulateTrajectory(replay, phys, { sampleEvery: 2 });
    const canvas = new OffscreenCanvas(w, h);
    renderTrailThumbnail(traj, canvas, { width: w, height: h, padding: 16 });
    const webp = await encodeThumbnail(canvas, "image/webp", 0.85);

    await cachePut(key, webp);
    self.postMessage({ type: "thumb", cycle, id, webp: webp.buffer }, [webp.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", cycle, id, message: String(err) });
  }
};
