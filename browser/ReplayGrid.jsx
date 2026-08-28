// browser/ReplayGrid.jsx
// Search-results grid. Each card lazy-loads its map thumbnail only when it
// scrolls into view. Click -> onOpen(item) (route to detail).
//
// Thumbnails are static map geometry, not a replay trail — one per mapid,
// server-rendered at GET /api/map/:mapid/thumbnail.webp (server/map-render/,
// see that endpoint for why). No box2d, no simulation, no per-replay fetch:
// it's a plain <img>, so rows sharing a map (the common case — a search for
// one map name returns many replays on the same mapid) hit the browser's
// normal HTTP cache instead of re-rendering. The full trail-simulation path
// (thumbClient.js / thumb.worker.js) is still used on the replay detail page,
// just not here.
//
// Props:
//   results: [{ cycle, id, mapid, mapName, mode, players, duration, ... }]
//   mapThumbUrl(item): string  -> endpoint serving that replay's map thumbnail
//   onOpen(item)
import { useEffect, useRef, useState } from "react";

function ReplayCard({ item, mapThumbUrl, onOpen }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        setVisible(true);
      }
    }, { rootMargin: "200px" }); // start loading just before it's visible
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <button ref={ref} onClick={() => onOpen(item)} className="replay-card">
      <div className="replay-thumb">
        {visible && !err
          ? <img
              src={mapThumbUrl(item)}
              alt={item.mapName}
              width={320}
              height={200}
              loading="lazy"
              onError={() => setErr(true)}
            />
          : <div className={`replay-thumb-ph${err ? " err" : ""}`} />}
      </div>
      <div className="replay-meta">
        <span className="replay-map">{item.mapName ?? "Unknown map"}</span>
        <span className="replay-sub">{item.mode} · {item.players}p · {fmt(item.duration)}</span>
      </div>
    </button>
  );
}

function fmt(steps) { if (!steps) return ""; const s = Math.round(steps / 30); return `${(s / 60 | 0)}:${String(s % 60).padStart(2, "0")}`; }

export default function ReplayGrid({ results, mapThumbUrl, onOpen }) {
  return (
    <div className="replay-grid">
      {results.map((item) => (
        <ReplayCard key={`${item.cycle}:${item.id}`} item={item} mapThumbUrl={mapThumbUrl} onOpen={onOpen} />
      ))}
    </div>
  );
}
