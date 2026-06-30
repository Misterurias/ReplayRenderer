// browser/decodeStored.js
// Browser-safe equivalent of codec.js's decodeStoredReplay, for the thumbnail
// worker (your codec.js uses node:zlib and can't run here). Uses DecompressionStream
// for gunzip and the SAME PSON dictionary. The dict MUST match bonk's Map.dict
// exactly — including the duplicate "d" and "fr" entries — or decode fails.
//
// pson + bytebuffer are browser-compatible (bonk itself uses them client-side).
import ByteBuffer from "bytebuffer";
import PSON from "pson";

const pairs = new PSON.StaticPair([
  "physics", "shapes", "fixtures", "bodies", "bro", "joints", "ppm",
  "lights", "spawns", "lasers", "capZones", "type", "w", "h", "c", "a",
  "v", "l", "s", "sh", "fr", "re", "de", "sn", "fc", "fm", "f", "d", "n",
  "bg", "lv", "av", "ld", "ad", "fr", "bu", "cf", "rv", "p", "d", "bf",
  "ba", "bb", "aa", "ab", "axa", "dr", "em", "mmt", "mms", "ms", "ut",
  "lt", "New body", "Box Shape", "Circle Shape", "Polygon Shape",
  "EdgeChain Shape", "priority", "Light", "Laser", "Cap Zone", "BG Shape",
  "Background Layer", "Rotate Joint", "Slider Joint", "Rod Joint",
  "Gear Joint", 65535, 16777215,
]);

// blob: Uint8Array | ArrayBuffer of the gzip'd PSON bytes from BYTEA.
export async function decodeStoredReplay(blob) {
  const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
  const psonBytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const ab = psonBytes.buffer.slice(psonBytes.byteOffset, psonBytes.byteOffset + psonBytes.byteLength);
  return pairs.decode(ab);
}