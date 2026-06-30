// server/inspect-one.mjs
// Decode ONE real stored replay and print its structure. Run this BEFORE
// render-one.mjs — it confirms the decoded shape matches what the pipeline
// expects, with no box2d involved. Pure decode, fast, safe.
//
//   node server/inspect-one.mjs ./one.bin

import { readFileSync } from "node:fs";

// EDIT: point at your codec.js (the one with decodeStoredReplay added)
import { decodeStoredReplay } from "./codec.js";

const blob = readFileSync(process.argv[2] || "./one.bin");
const r = decodeStoredReplay(blob);

const ss = r.startingState || {};
console.log("─ top-level keys ─");
console.log(" ", Object.keys(r).join(", "));
console.log("─ startingState keys ─");
console.log(" ", Object.keys(ss).join(", "));
console.log("─ physics ─");
console.log(" ", JSON.stringify(ss.physics ? { ppm: ss.physics.ppm, discRadius: ss.physics.discRadius,
  gravity: ss.physics.gravity, bodies: ss.physics.bodies?.length } : null));
console.log("─ discs ─");
console.log("  count:", (ss.discs || []).filter(Boolean).length, " sample:", JSON.stringify((ss.discs || [])[0]));
console.log("─ inputs ─");
console.log("  type:", typeof r.inputs, Array.isArray(r.inputs) ? "(already array)" : "(base64 string -> unpackInputs)");
console.log("─ meta ─");
console.log("  es:", r.es, " players:", (r.playerArray || []).length,
  " mode:", r.gameSettings?.mo ?? ss.gs?.mo, " map:", r.mn, "by", r.ma);

console.log("\nExpected by normalizeReplay: startingState, inputs, adminInputs, playerArray, gameSettings, es.");
console.log("If a name differs (e.g. inputs nested elsewhere), tell me and I'll adjust normalizeReplay.");
