import ByteBuffer from "bytebuffer";
import LZString    from "lz-string";
import PSON        from "pson";
import zlib        from "node:zlib";
import { promisify } from "node:util";

const gzip   = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ─── PSON dictionary (must match bonk.io's pair list exactly) ────────────────

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

// ─── Decode ───────────────────────────────────────────────────────────────────

/**
 * Decodes a raw replaydata string from the bonk.io API.
 *
 * The encoding pipeline (in reverse):
 *   1. First 100 chars have their case flipped (bonk quirk).
 *   2. LZString.decompressFromEncodedURIComponent → base64 string.
 *   3. ByteBuffer.fromBase64 → binary buffer.
 *   4. PSON.decode → plain JS object.
 *
 * Returns { decoded (JS object), rawBuffer (Buffer of PSON binary bytes) }.
 */
export function decodeReplayData(rawdata) {
    // Step 1 — case-flip first 100 chars
    const flipped = rawdata
        .split("")
        .map((ch, i) =>
            i <= 100
                ? ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
                : ch
        )
        .join("");

    // Step 2 — LZ decompress → base64 string
    const decompressed = LZString.decompressFromEncodedURIComponent(flipped);
    if (!decompressed) throw new Error("LZString decompression returned null");

    // Step 3 — base64 → ByteBuffer
    const bb = ByteBuffer.fromBase64(decompressed);

    // Step 4 — PSON decode → JS object (also gives us the raw bytes)
    const decoded = pairs.decode(bb.buffer);

    // Keep the raw PSON bytes; we'll gzip them for storage.
    // bb.buffer is an ArrayBuffer — wrap it in a Node Buffer.
    const rawBuffer = Buffer.from(bb.buffer);

    return { decoded, rawBuffer };
}

// ─── Storage compression ──────────────────────────────────────────────────────
//
// Why not just store the original encoded string?
//
//   original string  =  LZ-compressed data  →  base64-encoded  →  ~33 % larger
//
// We decode back to raw PSON binary (already compact), then gzip it.
// Typical savings vs. the original string: 40–60 %.
// Gzip level 6 (Node default) is a good speed/size tradeoff for bulk inserts.

/** Compress raw PSON bytes → gzip Buffer ready for BYTEA storage. */
export async function compressForStorage(rawBuffer) {
    return gzip(rawBuffer);
}

/** Decompress a BYTEA blob back to raw PSON bytes. */
export async function decompressFromStorage(blob) {
    return gunzip(blob);
}

/**
 * Full round-trip: encoded API string → gzip Buffer for DB storage.
 * Returns { replayBytes, decoded } or throws on decode failure.
 */
export async function encodeForStorage(rawdata) {
    const { decoded, rawBuffer } = decodeReplayData(rawdata);
    const replayBytes = await compressForStorage(rawBuffer);
    return { replayBytes, decoded };
}

export function decodeStoredReplay(blob) {
    const psonBytes = zlib.gunzipSync(blob);
    const ab = psonBytes.buffer.slice(psonBytes.byteOffset, psonBytes.byteOffset + psonBytes.byteLength);
    return pairs.decode(ab);
}