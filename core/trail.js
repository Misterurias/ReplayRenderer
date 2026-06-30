// trail.js
// Render a replay's disc trajectories as a single motion-trail composite.
// Pure Canvas2D: works on OffscreenCanvas (worker) and @napi-rs/canvas (Node).
//
// A single frozen frame of bonk is unreadable (tiny discs, no context). Trails
// show the *paths taken* — instantly recognizable and distinctive. Free to produce
// since the sim already steps through every state.

// Bonkverse-ish palette: navy field, bright disc colors.
const BG = "#0d1b2a";
const BG2 = "#102a43";
const FFA_PALETTE = ["#2ec4b6", "#ff6b6b", "#ffd166", "#a78bfa", "#4cc9f0", "#f72585", "#80ed99", "#ff9f1c"];
const TEAM_PALETTE = { 2: "#ff5d5d", 3: "#5d8bff", 4: "#5dff8b", 5: "#ffd95d" }; // red/blue/green/yellow

function discColor(disc) {
  if (disc.team > 1 && TEAM_PALETTE[disc.team]) return TEAM_PALETTE[disc.team];
  return FFA_PALETTE[disc.index % FFA_PALETTE.length];
}

// Build per-disc trajectories from sampled frames: { [index]: [{x,y,a,team,color,t}] }
function trajectories(frames) {
  const tracks = new Map();
  const n = frames.length;
  for (let f = 0; f < n; f++) {
    const t = n > 1 ? f / (n - 1) : 1; // 0 = oldest, 1 = newest
    for (const d of frames[f]) {
      if (!tracks.has(d.index)) tracks.set(d.index, []);
      tracks.get(d.index).push({ x: d.x, y: d.y, a: d.a, team: d.team, index: d.index, t });
    }
  }
  return tracks;
}

// World(meters) -> canvas(px) transform that fits bbox with padding, preserving aspect.
function makeTransform(bbox, W, H, padPx, discRadiusM) {
  // expand bbox slightly so discs near edges aren't clipped
  const margin = discRadiusM * 2;
  const minX = bbox.minX - margin, maxX = bbox.maxX + margin;
  const minY = bbox.minY - margin, maxY = bbox.maxY + margin;
  const wM = Math.max(maxX - minX, 1e-6);
  const hM = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((W - 2 * padPx) / wM, (H - 2 * padPx) / hM);
  const offX = (W - scale * wM) / 2 - scale * minX;
  const offY = (H - scale * hM) / 2 - scale * minY;
  return {
    scale,
    x: (xm) => offX + scale * xm,
    y: (ym) => offY + scale * ym,
  };
}

export function renderTrailThumbnail(traj, canvas, opts = {}) {
  const { width = 320, height = 200, padding = 16 } = opts;
  const { frames, bbox, discRadius = 1 } = traj;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  // background (subtle vertical gradient)
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, BG2);
  g.addColorStop(1, BG);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  if (!frames || frames.length === 0) return canvas;

  const tf = makeTransform(bbox, width, height, padding, discRadius);
  const rPx = Math.max(2, discRadius * tf.scale);
  const tracks = trajectories(frames);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 1) trails — alpha + width ramp from old (faint/thin) to recent (bright/thick)
  for (const track of tracks.values()) {
    if (track.length < 2) continue;
    const color = discColor(track[0]);
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1], b = track[i];
      const tt = b.t;                       // recency of this segment
      ctx.globalAlpha = 0.06 + 0.5 * tt;    // older = faint
      ctx.lineWidth = rPx * (0.35 + 0.55 * tt);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(tf.x(a.x), tf.y(a.y));
      ctx.lineTo(tf.x(b.x), tf.y(b.y));
      ctx.stroke();
    }
  }

  // 2) heads — final position of each disc, with glow + outline
  ctx.globalAlpha = 1;
  for (const track of tracks.values()) {
    const last = track[track.length - 1];
    const color = discColor(last);
    const cx = tf.x(last.x), cy = tf.y(last.y);

    ctx.shadowColor = color;
    ctx.shadowBlur = rPx * 1.4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.lineWidth = Math.max(1, rPx * 0.18);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
    ctx.stroke();

    // facing tick (uses disc angle)
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = Math.max(1, rPx * 0.16);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(last.a) * rPx, cy + Math.sin(last.a) * rPx);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

// Encode helper that works in both environments.
export async function encodeThumbnail(canvas, mime = "image/webp", quality = 0.85) {
  if (typeof canvas.encode === "function") {
    // @napi-rs/canvas
    const fmt = mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : "jpeg";
    return await canvas.encode(fmt, Math.round(quality * 100));
  }
  if (typeof canvas.convertToBlob === "function") {
    // OffscreenCanvas (browser worker)
    const blob = await canvas.convertToBlob({ type: mime, quality });
    return new Uint8Array(await blob.arrayBuffer());
  }
  throw new Error("No encode path on this canvas");
}
