import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import box2d from "../vendor/box2d.esm.js";
import ReplayPlayer from "./ReplayPlayer.jsx";
import "./dev.css";

globalThis.peerjs ??= {
  peerjs: {
    Peer: class MockPeer {
      constructor() {}
      on() {}
      connect() {
        return { on() {}, send() {}, close() {} };
      }
      destroy() {}
    },
  },
};

globalThis.dcodeIO ??= {
  PSON: {
    StaticPair: class StaticPair {
      constructor(dict) {
        this.dict = dict;
      }

      encode(obj) {
        return obj;
      }

      decode(obj) {
        return obj;
      }
    },
  },
};

console.log("GameResources loaded:", !!globalThis.GameResources);
console.log("PIXI loaded:", globalThis.PIXI?.VERSION);
console.log("Howler loaded:", !!globalThis.Howler);

globalThis.__bonkPatchGame = (core) => {
  core.game.getPageHeight = () => window.innerHeight;
  core.game.getPageWidth = () => window.innerWidth;
  core.game.mute = false;
};

globalThis.anime ??= function animeStub(config = {}) {
  if (typeof config.complete === "function") {
    setTimeout(config.complete, 0);
  }

  return {
    play() {},
    pause() {},
    restart() {},
    seek() {},
    finished: Promise.resolve(),
  };
};

globalThis.anime.timeline ??= function timelineStub() {
  return {
    add() {
      return this;
    },
    play() {},
    pause() {},
    restart() {},
    seek() {},
    finished: Promise.resolve(),
  };
};

if (globalThis.PIXI?.resources?.SVGResource) {
  const SVGResource = globalThis.PIXI.resources.SVGResource;
  const originalLoad = SVGResource.prototype.load;

  SVGResource.prototype.load = function patchedLoad() {
    if (typeof this.svg !== "string") {
      this.svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`;
    }

    return originalLoad.call(this);
  };
}

async function loadBonkFonts() {
  await document.fonts.load('16px "fptmed"');
  await document.fonts.load('16px "fptbook"');
  await document.fonts.load('16px "fptb"');
  await document.fonts.load('16px "fptl"');
  await document.fonts.load('16px "futurept_medium"');
  await document.fonts.load('16px "futurept_book"');
  await document.fonts.ready;
}

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [replay, setReplay] = useState(null);
  const [error, setError] = useState(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingReplay, setLoadingReplay] = useState(false);

  async function searchReplays(e) {
    e.preventDefault();

    setError(null);
    setReplay(null);
    setLoadingSearch(true);

    try {
      const res = await fetch(
        `http://127.0.0.1:5174/api/search?q=${encodeURIComponent(query)}`
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Search failed");
      }

      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSearch(false);
    }
  }

  async function loadReplay(item) {
    setError(null);
    setLoadingReplay(true);

    try {
      const res = await fetch(
        `http://127.0.0.1:5174/api/replay/${item.id}?cycle=${item.cycle}`
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load replay ${item.id}`);
      }

      const data = await res.json();

      await loadBonkFonts();

      setReplay(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingReplay(false);
    }
  }

  return (
    <div className="bonkverse-app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">↻</div>
          <div>
            <h1 style={{ margin: 0 }}>Bonkverse Replays</h1>
            <div style={{ color: "#94a3b8" }}>
              Search, preview, and render matches
            </div>
          </div>
        </div>

        <form onSubmit={searchReplays} className="search-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search username, replay ID, or map ID"
          />
          <button className="primary-btn" type="submit">
            Search
          </button>
        </form>

        {loadingSearch && <div>Searching...</div>}
        {error && <pre style={{ color: "tomato" }}>{error}</pre>}

        <h2>Results</h2>

        {results.map((item) => (
          <button
            key={`${item.cycle}:${item.id}`}
            onClick={() => loadReplay(item)}
            className={`result-card ${
              replay?.id === item.id && replay?.cycle === item.cycle
                ? "active"
                : ""
            }`}
          >
            <strong>Replay {item.id}</strong>
            <div>Map ID: {item.mapid || "Unknown"}</div>
            <div>Players: {(item.players || []).join(", ") || "Unknown"}</div>
            <div className="result-meta">
              Cycle {item.cycle} ·{" "}
              {item.fetched_at
                ? new Date(item.fetched_at).toLocaleString()
                : "Unknown"}
            </div>
          </button>
        ))}
      </aside>

      <main className="player-pane">
        <div className="player-shell" id="player-shell">
          {loadingReplay && <div>Loading replay...</div>}

          {replay ? (
            <>
              <h2>
                Replay {replay.id}{" "}
                {replay.cycle !== undefined ? `(Cycle ${replay.cycle})` : ""}
              </h2>

              <ReplayPlayer
                key={`${replay.cycle}:${replay.id}`}
                blob={replay.decoded}
                box2d={box2d}
                decodeReplayData={(x) => x}
                fullscreenTargetId="player-shell"
              />
            </>
          ) : (
            <div className="empty-player">Select a replay to start watching</div>
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);