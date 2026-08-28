import React, { useState, useMemo, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import box2d from "../vendor/box2d.esm.js";
import ReplayPlayer from "./ReplayPlayer.jsx";
import "./dev.css";

// In local dev, the API runs as a separate process on its own port (see
// server/dev-api.mjs, started via `npm run api`). In production, a single
// server (server/prod-server.mjs) serves both the built frontend and the
// /api/* routes from the same origin, so relative paths are correct and no
// CORS is needed at all. import.meta.env.DEV is Vite's own dev/build flag —
// true under `vite`/`npm run dev`, false in a `vite build` production bundle.
const API_BASE = import.meta.env.DEV ? "http://127.0.0.1:5174" : "";

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

// ─── Decoded-replay → display data ───────────────────────────────────────────
// Mirrors extractMeta()/extractPlayers() from server.js's decoder route, so the
// renderer surfaces the same facts the decoder tool already knows how to pull
// out of a decoded replay — just read straight off replay.decoded client-side.

function extractMeta(decoded) {
  const ss = decoded?.startingState ?? {};
  const mm = ss.mm ?? {};
  const gs = decoded?.gameSettings ?? {};

  return {
    mapName: decoded?.mn ?? mm.n ?? null,
    mapAuthor: decoded?.ma ?? mm.a ?? null,
    mapId: mm.dbid ?? null,
    mapVersion: mm.dbv ?? null,
    mapVotesUp: typeof mm.vu === "number" ? mm.vu : null,
    mapVotesDown: typeof mm.vd === "number" ? mm.vd : null,
    mapPublished: typeof mm.pub === "boolean" ? mm.pub : null,
    remixOf: mm.rxid > 0 ? { id: mm.rxid, name: mm.rxn || null, author: mm.rxa || null } : null,
    mode: gs.mo ?? null,
    teams: typeof gs.tea === "boolean" ? gs.tea : null,
    winLimit: gs.wl ?? null,
    quickplay: !!gs.q,
    seed: ss.seed ?? null,
    rounds: ss.rc ?? null,
    scores: Array.isArray(ss.scores) ? ss.scores : null,
    frames: decoded?.es ?? null,
  };
}

function extractPlayers(decoded) {
  const scores = decoded?.startingState?.scores;

  return (decoded?.playerArray ?? [])
    .map((p, i) =>
      p && {
        slot: i,
        username: p.userName ?? null,
        level: p.level ?? 0,
        team: p.team ?? null,
        ping: p.ping ?? null,
        guest: !!p.guest,
        avatar: p.avatar ?? null,
        score: Array.isArray(scores) ? scores[i] ?? null : null,
      }
    )
    .filter((p) => p && p.username);
}

// bonk.io's actual team-slot mapping and colors, confirmed straight from the
// decompiled client (MapRenderer.doCapZone()) — these are exactly Material
// Design's standard palette (Red/Blue/Green/Yellow 500), not a guess. Team 1
// has no case in the source's color switch either, confirming it's the FFA
// sentinel rather than a real team.
const TEAM_COLORS = {
  1: "#94a3b8", // FFA — no team (no case in the source; kept neutral here)
  2: "#f44336", // red   (0xF44336 / decimal 16007990)
  3: "#2196f3", // blue  (0x2196F3 / decimal 2201331)
  4: "#4caf50", // green (0x4CAF50 / decimal 5025616)
  5: "#ffeb3b", // yellow(0xFFEB3B / decimal 16771899)
};
const TEAM_LABELS = {
  2: "Red",
  3: "Blue",
  4: "Green",
  5: "Yellow",
};

function teamColor(team) {
  return TEAM_COLORS[team] ?? TEAM_COLORS[1];
}

function teamLabel(team) {
  return TEAM_LABELS[team] ?? null; // null for FFA (team 1) or unknown
}

// bonk.io's game-mode short codes → display names.
const MODE_LABELS = {
  f: "Football",
  bs: "Simple",
  ard: "Death Arrows",
  ar: "Arrows",
  sp: "Grapple",
  v: "VTOL",
  b: "Classic",
};
function modeLabel(code) {
  if (!code) return null;
  return MODE_LABELS[code] ?? code; // unknown codes fall back to showing the raw code
}

function initials(name) {
  return (name || "?").slice(0, 2).toUpperCase();
}

// Passed to ReplayPlayer as decodeReplayData. Defined once at module scope
// (not inline in JSX) so it's the same function reference on every render —
// an inline `(x) => x` in JSX is a new object each render, which would make
// any effect inside ReplayPlayer that depends on this prop re-run every time
// App re-renders for an unrelated reason (like switching tabs), resetting
// playback state.
const identityDecode = (x) => x;

// Renders a player's real bonk.io skin via the decoder tool's skin-render.js
// (window.BONK_SKIN_SHAPES + window.renderBonkAvatar, loaded as globals in
// index.html). Falls back to the initials-on-team-color circle whenever
// there's no avatar, the scripts aren't loaded, or the render fails — so a
// missing/malformed avatar never blocks the player list from rendering.
function PlayerAvatar({ avatar, initialsText, color, size = 46 }) {
  const canvasRef = useRef(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    setRendered(false);

    if (!avatar || typeof window.renderBonkAvatar !== "function") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.round(size * dpr);

    window
      .renderBonkAvatar(canvas, avatar, px)
      .then(() => {
        if (!cancelled) setRendered(true);
      })
      .catch((err) => {
        console.warn("Avatar render failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [avatar, size]);

  return (
    <div
      className="player-avatar"
      style={{ background: rendered ? "transparent" : color, width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{
          display: rendered ? "block" : "none",
          width: size,
          height: size,
          borderRadius: "50%",
        }}
      />
      {!rendered && initialsText}
    </div>
  );
}

// Shows the server-generated map-outline thumbnail (see /api/map/:mapid/
// thumbnail.svg). Falls back to an empty placeholder block whenever there's
// no mapid, the map isn't in the `maps` table yet, or it's made up of shapes
// the thumbnail generator can't draw (currently box shapes only).
function MapThumbnail({ mapid }) {
  const [failed, setFailed] = useState(false);

  if (!mapid || failed) {
    return (
      <div className="result-thumb result-thumb--empty">
        <span>No preview</span>
      </div>
    );
  }

  return (
    <img
      className="result-thumb"
      src={`${API_BASE}/api/map/${mapid}/thumbnail.svg`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [replay, setReplay] = useState(null);
  const [error, setError] = useState(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [searchField, setSearchField] = useState("all");
  const [activeTab, setActiveTab] = useState("overview");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);

  // Export (video/GIF) actions and state live in ReplayPlayer (they need the
  // internal engine ref), but their buttons render here, structurally
  // outside the player's own DOM — export isn't a playback control, so it
  // shouldn't visually live inside the video frame. playerRef calls the
  // exposed exportMp4/exportGif actions; exportState mirrors their
  // in-progress percentages for the buttons' label/disabled state.
  const playerRef = useRef(null);
  const [exportState, setExportState] = useState({
    isExporting: false,
    exportPct: null,
    gifExportPct: null,
  });

  // Scroll position management between the results grid and the replay
  // page. This app toggles between the two views via `replay` state rather
  // than real client-side routing, so the browser has no built-in memory of
  // scroll position across that switch — whether it happened to land near
  // the top or not was just incidental, depending on the relative height of
  // whichever view was showing at the moment. scrollPosRef remembers where
  // the results grid was scrolled to right when a replay is opened;
  // restoreScrollRef flags that the next transition back to the results
  // view (specifically via the explicit "Back to results" button, not a
  // fresh search) should restore that position instead of leaving scroll
  // wherever it incidentally ends up.
  const scrollPosRef = useRef(0);
  const restoreScrollRef = useRef(false);

  useEffect(() => {
    if (replay) {
      // Opening a replay always lands at the top, so the player is in view
      // regardless of where the results grid was scrolled to.
      window.scrollTo(0, 0);
    } else if (restoreScrollRef.current) {
      restoreScrollRef.current = false;
      window.scrollTo(0, scrollPosRef.current);
    }
  }, [replay]);

  const meta = useMemo(() => (replay ? extractMeta(replay.decoded) : null), [replay]);
  const players = useMemo(() => (replay ? extractPlayers(replay.decoded) : []), [replay]);

  // Score table order: highest score first, alphabetical (case-insensitive)
  // as the tiebreaker. Kept separate from `players` so the Players tab grid
  // still reflects each player's original slot order.
  const scoreboard = useMemo(() => {
    return [...players].sort((a, b) => {
      const scoreDiff = (b.score ?? -Infinity) - (a.score ?? -Infinity);
      if (scoreDiff !== 0) return scoreDiff;
      return (a.username || "").localeCompare(b.username || "", undefined, {
        sensitivity: "base",
      });
    });
  }, [players]);

  // Players tab order: highest level first, alphabetical (case-insensitive)
  // as the tiebreaker.
  const playersByLevel = useMemo(() => {
    return [...players].sort((a, b) => {
      const levelDiff = (b.level ?? -Infinity) - (a.level ?? -Infinity);
      if (levelDiff !== 0) return levelDiff;
      return (a.username || "").localeCompare(b.username || "", undefined, {
        sensitivity: "base",
      });
    });
  }, [players]);

  // Land back on the Overview tab whenever a different replay is opened —
  // otherwise switching replays while on "Players" or "Raw data" leaves the
  // tab selection stuck on a tab that no longer matches what's playing.
  useEffect(() => {
    setActiveTab("overview");
  }, [replay?.id, replay?.cycle]);

  async function runSearch(targetPage) {
    setError(null);
    setReplay(null);
    setLoadingSearch(true);

    try {
      const res = await fetch(
        `${API_BASE}/api/search?q=${encodeURIComponent(query)}&field=${searchField}&page=${targetPage}`
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Search failed");
      }

      const data = await res.json();
      setResults(data.results || []);
      setPage(data.page ?? targetPage);
      setTotalPages(data.totalPages ?? 1);
      setTotalResults(data.total ?? (data.results ? data.results.length : 0));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSearch(false);
    }
  }

  function searchReplays(e) {
    e.preventDefault();
    runSearch(1);
  }

  function goToPage(target) {
    if (target < 1 || target > totalPages || target === page || loadingSearch) return;
    runSearch(target);
  }

  async function loadReplay(item) {
    scrollPosRef.current = window.scrollY;
    setError(null);
    setLoadingReplay(true);

    try {
      const res = await fetch(
        `${API_BASE}/api/replay/${item.id}?cycle=${item.cycle}`
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

  async function copyJson() {
    if (!replay) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(replay.decoded, null, 2));
    } catch (err) {
      console.warn("Copy failed:", err);
    }
  }

  function downloadJson() {
    if (!replay) return;
    const blob = new Blob([JSON.stringify(replay.decoded, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bonkverse-replay-${replay.cycle}-${replay.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }


  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-icon">↻</div>
            <div className="brand-text">
              <span className="brand-title">Bonkverse</span>
              <span className="brand-subtitle">Replays</span>
            </div>
          </div>

          <form onSubmit={searchReplays} className="search-bar">
            <select value={searchField} onChange={(e) => setSearchField(e.target.value)}>
              <option value="all">All</option>
              <option value="username">Username</option>
              <option value="id">Replay ID</option>
              <option value="mapid">Map ID</option>
              <option value="mapname">Map name</option>
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search username, replay ID, or map name"
            />
            <button className="primary-btn" type="submit">
              Search
            </button>
          </form>
        </div>
      </header>

      {error && (
        <div className="page">
          <pre className="error-banner">{error}</pre>
        </div>
      )}

      {!loadingReplay && replay && meta ? (
        <main className="page replay-page">
          <button
            className="back-link"
            onClick={() => {
              restoreScrollRef.current = true;
              setReplay(null);
            }}
          >
            ← Back to results
          </button>

          <div className="player-shell" id="player-shell">
            <ReplayPlayer
              key={`${replay.cycle}:${replay.id}`}
              ref={playerRef}
              blob={replay.decoded}
              box2d={box2d}
              decodeReplayData={identityDecode}
              fullscreenTargetId="player-shell"
              onExportStateChange={setExportState}
            />
          </div>

          <div className="title-row">
            <div>
              <h2>Replay {replay.id}</h2>
              <div className="stage-subtitle">
                Cycle {replay.cycle}
                {meta.mapName ? ` · ${meta.mapName}` : ""}
                {meta.mapAuthor ? ` by ${meta.mapAuthor}` : ""}
              </div>
            </div>
            <div className="action-row">
              <button className="ghost-btn" onClick={copyJson}>
                Copy JSON
              </button>
              <button className="ghost-btn" onClick={downloadJson}>
                Download JSON
              </button>
              <button
                className="ghost-btn"
                onClick={() => playerRef.current?.exportMp4()}
                disabled={exportState.isExporting}
              >
                {exportState.exportPct !== null
                  ? `Exporting video… ${exportState.exportPct}%`
                  : "Export video"}
              </button>
              <button
                className="ghost-btn"
                onClick={() => playerRef.current?.exportGif()}
                disabled={exportState.isExporting}
              >
                {exportState.gifExportPct !== null
                  ? `Exporting GIF… ${exportState.gifExportPct}%`
                  : "Export GIF"}
              </button>
            </div>
          </div>

          <div className="chip-row">
            {meta.mapId != null && <span className="chip">map #{meta.mapId}</span>}
            {meta.mode && <span className="chip chip--accent">{modeLabel(meta.mode)}</span>}
            {meta.teams !== null && (
              <span className="chip">{meta.teams ? "Teams" : "Free-for-all"}</span>
            )}
            {players.length > 0 && <span className="chip">{players.length} players</span>}
            {meta.winLimit != null && <span className="chip">win limit {meta.winLimit}</span>}
            {meta.rounds != null && <span className="chip">{meta.rounds} rounds</span>}
            {meta.seed != null && <span className="chip">seed {meta.seed}</span>}
            {meta.frames != null && <span className="chip">{meta.frames} frames</span>}
            {meta.quickplay && <span className="chip">quickplay</span>}
          </div>

          <div className="data-card">
            <div className="tab-row">
              <button
                className={`tab ${activeTab === "overview" ? "tab--active" : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                Overview
              </button>
              <button
                className={`tab ${activeTab === "scores" ? "tab--active" : ""}`}
                onClick={() => setActiveTab("scores")}
              >
                Scores
              </button>
              <button
                className={`tab ${activeTab === "players" ? "tab--active" : ""}`}
                onClick={() => setActiveTab("players")}
              >
                Players ({players.length})
              </button>
              <button
                className={`tab ${activeTab === "raw" ? "tab--active" : ""}`}
                onClick={() => setActiveTab("raw")}
              >
                Raw data
              </button>
            </div>

            {activeTab === "overview" && (
              <div className="tab-panel">
                <div className="info-grid">
                  <div className="info-block">
                    <h3>Map</h3>
                    <dl>
                      <dt>Name</dt>
                      <dd>{meta.mapName ?? "Unknown"}</dd>
                      <dt>Author</dt>
                      <dd>{meta.mapAuthor ?? "Unknown"}</dd>
                      <dt>Map ID</dt>
                      <dd>{meta.mapId ?? "—"}</dd>
                      <dt>Version</dt>
                      <dd>{meta.mapVersion ?? "—"}</dd>
                      <dt>Votes</dt>
                      <dd>
                        {meta.mapVotesUp ?? 0} up · {meta.mapVotesDown ?? 0} down
                      </dd>
                      <dt>Published</dt>
                      <dd>
                        {meta.mapPublished === null ? "—" : meta.mapPublished ? "Yes" : "No"}
                      </dd>
                      {meta.remixOf && (
                        <>
                          <dt>Remix of</dt>
                          <dd>
                            {meta.remixOf.name || `#${meta.remixOf.id}`}
                            {meta.remixOf.author ? ` by ${meta.remixOf.author}` : ""}
                          </dd>
                        </>
                      )}
                    </dl>
                  </div>

                  <div className="info-block">
                    <h3>Match settings</h3>
                    <dl>
                      <dt>Mode</dt>
                      <dd>{modeLabel(meta.mode) ?? "—"}</dd>
                      <dt>Format</dt>
                      <dd>{meta.teams === null ? "—" : meta.teams ? "Teams" : "Free-for-all"}</dd>
                      <dt>Win limit</dt>
                      <dd>{meta.winLimit ?? "—"}</dd>
                      <dt>Rounds</dt>
                      <dd>{meta.rounds ?? "—"}</dd>
                      <dt>Quickplay</dt>
                      <dd>{meta.quickplay ? "Yes" : "No"}</dd>
                      <dt>Seed</dt>
                      <dd>{meta.seed ?? "—"}</dd>
                      <dt>Frames</dt>
                      <dd>{meta.frames ?? "—"}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "scores" && (
              <div className="tab-panel">
                {meta.scores && players.length > 0 ? (
                  <div className="info-block">
                    <h3>Scores</h3>
                    <table className="score-table">
                      <thead>
                        <tr>
                          <th>Slot</th>
                          <th>Player</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scoreboard.map((p) => (
                          <tr key={p.slot}>
                            <td>{p.slot}</td>
                            <td>{p.username}</td>
                            <td>{p.score ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="tab-empty">No score data on this replay.</div>
                )}
              </div>
            )}

            {activeTab === "players" && (
              <div className="tab-panel">
                {players.length === 0 ? (
                  <div className="tab-empty">No player data on this replay.</div>
                ) : (
                  <div className="player-grid">
                    {playersByLevel.map((p) => (
                      <div className="player-card" key={p.slot}>
                        <PlayerAvatar
                          avatar={p.avatar}
                          initialsText={initials(p.username)}
                          color={teamColor(p.team)}
                          size={46}
                        />
                        <div className="player-info">
                          <div className="player-name">
                            {p.username}
                            {p.guest && <span className="badge">guest</span>}
                          </div>
                          <div className="player-meta">
                            lv {p.level} · ping {p.ping ?? "—"}
                            {teamLabel(p.team) ? ` · ${teamLabel(p.team)} team` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "raw" && (
              <div className="tab-panel">
                <pre className="raw-json">{JSON.stringify(replay.decoded, null, 2)}</pre>
              </div>
            )}
          </div>
        </main>
      ) : (
        <main className="page browse-page">
          <div className="field-tabs">
            {[
              ["all", "All"],
              ["username", "Username"],
              ["id", "Replay ID"],
              ["mapid", "Map ID"],
              ["mapname", "Map name"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`tab ${searchField === value ? "tab--active" : ""}`}
                onClick={() => setSearchField(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {loadingReplay && (
            <div className="browse-loading">
              <div className="loading-spinner" />
              <p>Loading replay…</p>
            </div>
          )}

          {loadingSearch && (
            <div className="browse-loading">
              <div className="loading-spinner" />
              <p>Searching…</p>
            </div>
          )}

          {!loadingSearch && results.length === 0 && (
            <div className="browse-empty">
              <div className="empty-icon">↻</div>
              <h2>{totalResults === 0 && query ? "No results found" : "Search to get started"}</h2>
              <p>
                {totalResults === 0 && query
                  ? `Nothing matched "${query}". Try a different field or spelling.`
                  : "Search by username, replay ID, map ID, or map name above."}
              </p>
            </div>
          )}

          {!loadingSearch && results.length > 0 && (
            <>
              <div className="results-meta">
                {totalResults.toLocaleString()} result{totalResults === 1 ? "" : "s"}
              </div>

              <div className="results-grid">
                {results.map((item) => (
                  <button
                    key={`${item.cycle}:${item.id}`}
                    className="result-card"
                    onClick={() => loadReplay(item)}
                  >
                    <MapThumbnail mapid={item.mapid} />
                    <div className="result-body">
                      <div className="result-title">Replay {item.id}</div>
                      <div className="result-line">
                        {item.mapname || "Unknown map"}
                        {item.mapid ? ` (#${item.mapid})` : ""}
                      </div>
                      <div className="result-line result-line--muted">
                        {(item.players || []).join(", ") || "No players"}
                      </div>
                      <div className="result-line result-line--muted">
                        Cycle {item.cycle} ·{" "}
                        {item.fetched_at ? new Date(item.fetched_at).toLocaleDateString() : "Unknown"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="pagination pagination--center">
                  <button
                    className="ghost-btn"
                    onClick={() => goToPage(page - 1)}
                    disabled={page <= 1 || loadingSearch}
                  >
                    ← Prev
                  </button>
                  <span className="pagination-label">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    className="ghost-btn"
                    onClick={() => goToPage(page + 1)}
                    disabled={page >= totalPages || loadingSearch}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);