// browser/ReplayGrid.jsx
// Search-results grid. Each card lazy-loads its trail thumbnail (via the shared
// worker) only when it scrolls into view. Click -> onOpen(item) (route to detail).
//
// Props:
//   results: [{ cycle, id, mapName, mode, players, duration, ... }]
//   rawUrl(item): string   -> endpoint serving that replay's raw replaydata bytes
//   onOpen(item)
import { useEffect, useRef, useState } from "react";
import { requestThumb } from "./thumbClient.js";

function ReplayCard({ item, rawUrl, onOpen }) {
  const ref = useRef(null);
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        requestThumb({ cycle: item.cycle, id: item.id, url: rawUrl(item) })
          .then(setSrc).catch(() => setErr(true));
      }
    }, { rootMargin: "200px" }); // start rendering just before it's visible
    io.observe(el);
    return () => io.disconnect();
  }, [item, rawUrl]);

  // revoke object URL on unmount to avoid leaks
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  return (
    <button ref={ref} onClick={() => onOpen(item)} className="replay-card">
      <div className="replay-thumb">
        {src ? <img src={src} alt={item.mapName} width={320} height={200} />
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

export default function ReplayGrid({ results, rawUrl, onOpen }) {
  return (
    <div className="replay-grid">
      {results.map((item) => (
        <ReplayCard key={`${item.cycle}:${item.id}`} item={item} rawUrl={rawUrl} onOpen={onOpen} />
      ))}
    </div>
  );
}
