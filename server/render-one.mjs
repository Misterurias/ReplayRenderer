// server/render-one.mjs
// The moment of truth: one real replay -> real bonk Physics -> PNG.
//
// Prereqs (run once):
//   node server/build-core.mjs ./vendor/alpha2s.js ./vendor/bonk-core.mjs
//   node server/wrap-box2d.mjs ./vendor/Box2DModuleGJMod.js ./vendor/box2d.esm.js
//   DATABASE_URL=... node server/dump-one.mjs        # -> ./one.bin
//
// Run:
//   node server/render-one.mjs ./one.bin             # -> ./replay-render.png

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import box2d from "../vendor/box2d.esm.js";
import { loadBonkCore } from "../core/physics-loader.js";
import { normalizeReplay } from "../core/decode.js";
import { simulateTrajectory } from "../core/sim.js";
import { renderTrailThumbnail, encodeThumbnail } from "../core/trail.js";
import { decodeStoredReplay } from "./codec.js";

globalThis.SafeTrig ??= {};

Object.assign(globalThis.SafeTrig, {
  safeSin: Math.sin,
  safeCos: Math.cos,
  safeTan: Math.tan,

  safeAsin: Math.asin,
  safeAcos: Math.acos,
  safeAtan: Math.atan,
  safeAtan2: Math.atan2,

  safeASin: Math.asin,
  safeACos: Math.acos,
  safeATan: Math.atan,
  safeATan2: Math.atan2,
});


if (!existsSync("./vendor/bonk-core.mjs")) { console.error("Run build-core.mjs first."); process.exit(1); }
console.log("box2d:", typeof box2d?.Dynamics?.b2World === "function" ? "OK" : "?? (check wrap-box2d output)");

const blob = readFileSync(process.argv[2] || "./one.bin");
const core = await loadBonkCore({ box2d, headless: true });
const physics = new core.Physics();
console.log("real Physics instance:", physics.constructor.name);

const replay = normalizeReplay(decodeStoredReplay(blob));
replay.startingState.rc = (replay.startingState.rc ?? 0) + 1;
console.log(`replay: ${replay.startingState.discs.length} discs, es=${replay.es}, mode=${replay.gameSettings.mo}`);

console.time("simulate");
const traj = simulateTrajectory(replay, physics, { sampleEvery: 2 });
console.timeEnd("simulate");

const canvas = createCanvas(640, 400);
renderTrailThumbnail(traj, canvas, { width: 640, height: 400, padding: 16 });
writeFileSync("./replay-render.png", await encodeThumbnail(canvas, "image/png"));
console.log("wrote replay-render.png ✓");
