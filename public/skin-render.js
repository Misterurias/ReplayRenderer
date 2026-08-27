// ─── Bonk avatar renderer ────────────────────────────────────────────────────
//
// Ported from the skin-gallery canvas engine. Renders a bonk.io avatar object
// (the `{ layers, bc }` form that lives in a replay's playerArray) onto a 2D
// canvas, using the "draw white template → recolor with source-in" trick so
// there's no per-pixel JS work.
//
// Public API (attached to window):
//   await loadBonkShapes()                 → preloads + caches all base shapes
//   await renderBonkAvatar(canvas, avatar, size=128)
//                                          → draws `avatar` into `canvas`
//
// `avatar` is { layers: [{id,scale,angle,x,y,flipX,flipY,color}], bc }.
// Robust to missing/extra fields and bad layer ids — it skips what it can't draw
// instead of throwing, so one weird avatar never takes down the whole grid.

(function () {
  "use strict";

  const SHAPES = window.BONK_SKIN_SHAPES || [];
  const DEFAULT_BC = 4492031;       // bonk's default background colour
  const DEFAULT_COLOR = 16777215;   // white
  const SHAPE_UNITS = 15;           // avatar authored on a ~15-unit radius

  // ── Base-shape image cache (decode every SVG data: URI exactly once) ───────
  let shapesPromise = null;
  const images = new Array(SHAPES.length).fill(null); // images[id] aligns with SHAPES[id]

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // tolerate a bad template
      img.src = src;
    });
  }

  function loadBonkShapes() {
    if (shapesPromise) return shapesPromise;
    shapesPromise = (async () => {
      const jobs = [];
      for (let id = 1; id < SHAPES.length; id++) {
        const src = SHAPES[id];
        if (typeof src !== "string") continue;
        jobs.push(loadImage(src).then((img) => { images[id] = img; }));
      }
      await Promise.all(jobs);
      return images;
    })();
    return shapesPromise;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const toHex = (n) =>
    "#" + ((Number(n) >>> 0) & 0xffffff).toString(16).padStart(6, "0");

  function makeScratch(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function normalizeLayer(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = raw.id | 0;
    if (id < 1 || id >= SHAPES.length) return null;
    return {
      id,
      scale: Number.isFinite(raw.scale) ? raw.scale : 0.25,
      angle: Number.isFinite(raw.angle) ? raw.angle : 0,
      x: Number.isFinite(raw.x) ? raw.x : 0,
      y: Number.isFinite(raw.y) ? raw.y : 0,
      flipX: !!raw.flipX,
      flipY: !!raw.flipY,
      color: Number.isFinite(raw.color) ? raw.color : DEFAULT_COLOR,
    };
  }

  // ── Draw ─────────────────────────────────────────────────────────────────
  // Renders the avatar filling a circle of radius `size/2` centered in `ctx`.
  async function draw(ctx, avatar, size) {
    await loadBonkShapes();

    const radius = size / 2;
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;
    const bc = Number.isFinite(avatar && avatar.bc) ? avatar.bc : DEFAULT_BC;
    const layers = (avatar && Array.isArray(avatar.layers) ? avatar.layers : [])
      .map(normalizeLayer)
      .filter(Boolean);

    const scratch = makeScratch(ctx.canvas.width, ctx.canvas.height);
    const g = scratch.getContext("2d");

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    g.save();
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.clip();

    // Background fill (inside the circular clip).
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = toHex(bc);
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    // Move scratch origin to centre and scale into shape units.
    g.translate(cx, cy);
    g.scale(radius / SHAPE_UNITS, radius / SHAPE_UNITS);

    // Back-to-front: layer 0 is on top, so paint the last layer first.
    for (let u = layers.length - 1; u >= 0; u--) {
      const L = layers[u];
      const shape = images[L.id];
      if (!shape) continue;

      const w = shape.width * L.scale;
      const h = shape.height * L.scale;

      // Clear scratch (respecting its circular clip) before drawing this layer.
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, scratch.width, scratch.height);
      g.restore();

      g.save();
      g.translate(L.x, L.y);
      g.rotate(L.angle * (Math.PI / 180));
      g.scale(L.flipX ? -1 : 1, L.flipY ? -1 : 1);

      // White template …
      g.drawImage(shape, -w / 2, -h / 2, w, h);
      // … recoloured in one composite op.
      g.globalCompositeOperation = "source-in";
      g.fillStyle = toHex(L.color);
      g.fillRect(-w / 2, -h / 2, w, h);
      g.globalCompositeOperation = "source-over";
      g.restore();

      // Composite this finished layer onto the target.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
    }

    g.restore();
    ctx.restore();
  }

  async function renderBonkAvatar(canvas, avatar, size = 128) {
    if (!canvas) throw new Error("renderBonkAvatar: no canvas");
    if (size) { canvas.width = size; canvas.height = size; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    await draw(ctx, avatar || {}, size || canvas.width);
  }

  window.loadBonkShapes = loadBonkShapes;
  window.renderBonkAvatar = renderBonkAvatar;
})();