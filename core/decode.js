// core/decode.js  — environment-agnostic (no Node-only imports).
//
// gzip + PSON are handled by YOUR codec.js (same in browser and Node), so this
// file only owns the two pure pieces the rest of the pipeline needs:
//   • unpackInputs   — faithful port of bonk's Map.halfUnserialize
//   • normalizeReplay — shape whatever your codec returns into the canonical form
//
// Canonical replay shape (consumed by sim.js / ReplayPlayer):
// { startingState, inputs, adminInputs, playerArray, gameSettings, es, meta }

// ── BonkView reader (minimal) ────────────────────────────────────────────────
// bonk serialization is Java DataOutput-style: big-endian, unsigned reads.
class BonkViewReader {
  constructor(u8) {
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.p = 0;
  }
  readUShort() { const v = this.dv.getUint16(this.p, false); this.p += 2; return v; }
  readUint()   { const v = this.dv.getUint32(this.p, false); this.p += 4; return v; }
  readByte()   { const v = this.dv.getUint8(this.p);         this.p += 1; return v; }
}

function b64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Exact port of Map.halfUnserialize(): base64 stream -> sparse inputs[id][step].
// Bits: left=1 right=2 up=4 down=8 action=16 action2=32.
export function unpackInputs(inputsBase64) {
  const view = new BonkViewReader(b64ToBytes(inputsBase64));
  const inputs = [];
  const n = view.readUShort();
  for (let i = 0; i < n; i++) {
    const id = view.readUShort();
    const step = view.readUint();
    const b = view.readByte();
    if (!inputs[id]) inputs[id] = [];
    inputs[id][step] = {
      left:    (b & 1)  === 1,
      right:   (b & 2)  === 2,
      up:      (b & 4)  === 4,
      down:    (b & 8)  === 8,
      action:  (b & 16) === 16,
      action2: (b & 32) === 32,
    };
  }
  return inputs;
}

// `raw` is the decoded Map object from your codec. If raw.inputs is still a
// base64 string, unpack it here (mirrors halfUnserialize after fromDatabase).
export function normalizeReplay(raw) {
  const inputs = typeof raw.inputs === "string" ? unpackInputs(raw.inputs) : raw.inputs;
  return {
    startingState: raw.startingState,
    inputs,
    adminInputs: raw.adminInputs ?? [],
    playerArray: raw.playerArray ?? [],
    gameSettings: raw.gameSettings ?? raw.startingState?.gs ?? {},
    es: raw.es ?? inputsMaxStep(inputs),
    meta: { mn: raw.mn, ma: raw.ma, mid: raw.mid, rxn: raw.rxn, rxa: raw.rxa },
  };
}

function inputsMaxStep(inputs) {
  let max = 0;
  for (const perPlayer of inputs) {
    if (!perPlayer) continue;
    for (let s = perPlayer.length - 1; s >= 0; s--) {
      if (perPlayer[s]) { if (s > max) max = s; break; }
    }
  }
  return max;
}
