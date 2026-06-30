# replay-renderer

Deterministic bonk.io replay renderer. One decode→sim→draw spine, two outputs:

- **Trail thumbnails** for the search grid (cheap, no WebGL, runs in a Web Worker).
- **Live interactive playback** for the detail page (real PIXI `CanvasHandler` + scrubber).

Both re-simulate the replay with bonk's **real** `Physics`, so nothing is reimplemented
and replays never desync. No video is ever stored — the gzipped-PSON blob is the source
of truth and renders on demand.

## Tree

```
replay-renderer/
├── core/                  SHARED, environment-agnostic (pure — no Node/DOM imports)
│   ├── decode.js          input unpacker (halfUnserialize port) + normalize
│   ├── inputs.js          O(1) forward resolver + O(log) scrub
│   ├── sim.js             deterministic driver around the real Physics
│   ├── trail.js           Canvas2D trail thumbnail (OffscreenCanvas + node-canvas)
│   └── physics-loader.js  loads vendor/bonk-core.mjs (browser + headless paths)
│
├── browser/               FRONTEND (Vite)
│   ├── thumb.worker.js     grid thumbnails off-thread + IndexedDB cache
│   ├── thumbClient.js      singleton worker + promise API
│   ├── ReplayGrid.jsx      lazy IntersectionObserver thumbnails
│   └── ReplayPlayer.jsx    live player on CanvasHandler + scrubber
│
├── server/                NODE (build steps + dev harness)
│   ├── build-core.mjs      alpha2s.js  -> vendor/bonk-core.mjs
│   ├── wrap-box2d.mjs       Box2DModuleGJMod.js -> vendor/box2d.esm.js
│   ├── load-box2d.mjs       (fallback AMD loader for Node)
│   ├── dump-one.mjs         pull one raw blob from Postgres -> one.bin
│   ├── render-one.mjs       one real replay -> real Physics -> PNG  (the proof)
│   └── demo-thumb.mjs        visual demo (stand-in physics, no box2d) -> PNG
│
├── vendor/                BONK'S CODE — gitignored, you supply (see vendor/README.md)
│   ├── alpha2s.js · Box2DModuleGJMod.js     (inputs you provide)
│   └── bonk-core.mjs · box2d.esm.js         (generated)
│
├── package.json
├── README.md
└── SETUP.md               ← start here
```

## Where this goes in your repos

- **core/ + browser/** → Bonkverse frontend (Vite), under `src/replay/`.
- **core/ + server/** → the scraper repo (next to `db.js` / `codec.js`), for the
  build steps, the dev harness, and the future server-side thumbnail worker.

`core/` is needed in both — share it via a workspace package or just duplicate the four
small files for now. See **SETUP.md** for the step-by-step.
