import { useEffect, useRef, useState } from "react";
import { loadBonkCore } from "../core/physics-loader.js";
import { normalizeReplay } from "../core/decode.js";
import { createInputResolver } from "../core/inputs.js";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

const STEP_DURATION = 30;
const STEPS_PER_SEC = 30;

export default function ReplayPlayer({
  blob,
  box2d,
  decodeReplayData,
  width = 730,
  height = 500,
  fullscreenTargetId,
}) {
  const containerRef = useRef(null);
  const engine = useRef(null);
  const hideTimer = useRef(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [step, setStep] = useState(0);
  const [endStep, setEndStep] = useState(1);
  const [exporting, setExporting] = useState(false); // legacy webm fallback path
  const [exportPct, setExportPct] = useState(null); // null = not exporting (mp4 path)
  const [gifExportPct, setGifExportPct] = useState(null); // null = not exporting (gif path)
  const [isFs, setIsFs] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // ── Track fullscreen state ────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Feed bonk the real on-screen size so it renders natively (no CSS upscale).
  //    Bonk's resizeRenderer() reads domContainer.offsetWidth/offsetHeight, fits a
  //    1.46 rectangle, and draws everything vector-scaled by scaleRatio — exactly
  //    how bonk.io stays sharp. We just mutate the size it reads and repaint.
  useEffect(() => {
    const e = engine.current;
    if (!ready || !e?.sizeRef) return;

    if (isFs) {
      e.sizeRef.w = window.innerWidth;
      e.sizeRef.h = window.innerHeight;
    } else {
      e.sizeRef.w = width;
      e.sizeRef.h = height;
    }

    // Repaint the current frame so bonk re-reads offsetWidth and resizes even
    // when the replay is paused (the render() path detects the size change).
    renderAt(Math.floor(e.playhead || 0));
  }, [isFs, ready, width, height]);

  // ── YouTube-style auto-hide controls in fullscreen ────────────────────────
  useEffect(() => {
    if (!isFs) {
      setControlsVisible(true);
      return;
    }

    const shell = document.getElementById(fullscreenTargetId);

    const show = () => {
      setControlsVisible(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setControlsVisible(false), 2500);
    };

    show();
    shell?.addEventListener("mousemove", show);

    return () => {
      shell?.removeEventListener("mousemove", show);
      clearTimeout(hideTimer.current);
    };
  }, [isFs, fullscreenTargetId]);

  function resetAudio(core) {
    try {
      core?.game?.soundManager?.resetSumVols?.();
    } catch {}

    try {
      globalThis.Howler?.stop?.();
    } catch {}
  }

  function resetReplayToStart({ autoplay = true } = {}) {
    const e = engine.current;
    if (!e) return;

    e.playhead = 0;
    e.playedManualSounds = new Set();

    resetAudio(e.core);

    if (e.core.SoundHandler) {
      e.core.game.soundManager = new e.core.SoundHandler();
    }

    setStep(0);
    setPlaying(autoplay);
    renderAt(0, 0);
  }

  // ── Legacy real-time webm fallback (used only when WebCodecs is missing) ───
  async function exportVisibleReplayVideo() {
    const e = engine.current;
    const canvas = e?.handler?.renderer?.view;

    if (!canvas) {
      alert("No replay canvas found.");
      return;
    }

    if (!canvas.captureStream || typeof MediaRecorder === "undefined") {
      alert("Your browser does not support canvas video export.");
      return;
    }

    setExporting(true);

    try {
      resetReplayToStart({ autoplay: true });

      const stream = canvas.captureStream(60);
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm",
        videoBitsPerSecond: 12_000_000,
      });

      const chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        const videoBlob = new Blob(chunks, { type: "video/webm" });
        const url = URL.createObjectURL(videoBlob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `bonkverse-replay-${Date.now()}.webm`;
        a.click();

        URL.revokeObjectURL(url);
        setExporting(false);
      };

      recorder.start();

      const durationMs = ((e.replay.es || endStep) / STEPS_PER_SEC) * 1000;

      setTimeout(() => {
        try {
          recorder.stop();
        } catch {
          setExporting(false);
        }

        setPlaying(false);
      }, durationMs + 500);
    } catch (err) {
      console.error("Video export failed:", err);
      setExporting(false);
      alert("Video export failed. Check the console.");
    }
  }

  // ── Offline, high-res mp4 export on a fully isolated core ──────────────────
  // Does NOT touch the live player: it builds its own bonk core + offscreen
  // renderer, reuses the steps the live engine already simulated, and reports
  // progress. The live replay keeps playing and stays interactive throughout.
  async function exportReplayMp4({ scale = 2, fps = 60 } = {}) {
    const e = engine.current;
    if (!e || typeof VideoEncoder === "undefined") {
      return exportVisibleReplayVideo(); // fall back to webm path
    }

    setExportPct(0); // drives progress UI; do NOT pause the live player

    // 1) Make sure every step is simulated once, on the LIVE engine (cheap,
    //    physics only) so we don't simulate the whole replay a second time.
    const es = e.replay.es || e.computed;
    ensureSimTo(es);
    const cap = e.stoppedEarly ? e.computed : Math.min(es, e.computed);

    const realPerfNow = performance.now.bind(performance);
    const realDateNow = Date.now.bind(Date);

    let core, handler, container;

    try {
      // 2) Fully isolated core — never repoints the live renderer's pointers.
      core = await loadBonkCore({ box2d, headless: false });
      globalThis.__bonkPatchGame?.(core);
      core.game.mute = true; // silence the export core during the fast render

      const W = Math.round(width * scale),
        H = Math.round(height * scale);

      container = document.createElement("div");
      container.style.cssText = `position:absolute;left:-99999px;top:0;width:${W}px;height:${H}px;`;
      document.body.appendChild(container);
      Object.defineProperty(container, "offsetWidth", { get: () => W });
      Object.defineProperty(container, "offsetHeight", { get: () => H });

      handler = new core.CanvasHandler(container, "replay-export");

      // Rebuild avatars on the export core's Skin class from the raw objects we
      // stashed at setup (the live playerArray now holds live-core Skin
      // instances, which belong to a different core).
      const exportPlayers = e.replay.playerArray.map((p, i) => {
        const clone = { ...p };
        if (e.rawAvatars?.[i] && core.Skin) {
          const skin = new core.Skin();
          skin.fromObject(e.rawAvatars[i]);
          clone.avatar = skin;
        }
        return clone;
      });
      handler.setPlayerArray?.(exportPlayers);

      const exportCanvas = handler.renderer.view;

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: W, height: H },
        fastStart: "in-memory",
      });
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (err) => console.error("encoder", err),
      });
      encoder.configure({
        codec: "avc1.640028",
        width: W,
        height: H,
        bitrate: 16_000_000,
        framerate: fps,
      });

      // Virtual clock so time-based effects (impact particles) advance exactly
      // one frame per encoded frame instead of by ~0 real compute time.
      const frameMs = 1000 / fps;
      const perfBase = realPerfNow();
      const dateBase = realDateNow();
      performance.now = () => perfBase + (performance.__v ?? 0);
      Date.now = () => dateBase + (performance.__v ?? 0);

      const stepsPerFrame = STEPS_PER_SEC / fps; // 30/60 = 0.5
      const frameDurUs = 1e6 / fps;
      const totalFrames = Math.ceil((cap || 1) / stepsPerFrame);

      for (let f = 0; f < totalFrames; f++) {
        performance.__v = f * frameMs; // virtual time for THIS frame
        const playhead = f * stepsPerFrame;
        const whole = Math.min(Math.floor(playhead), cap);
        const t = playhead - whole;

        const cur = e.steps[whole];
        if (cur) {
          const prev = e.steps[Math.max(0, whole - 1)] ?? cur;
          handler.render(
            prev,
            cur,
            t,
            e.replay.gameSettings,
            e.resolver.at(whole),
            whole
          );

          const frame = new VideoFrame(exportCanvas, {
            timestamp: Math.round(f * frameDurUs),
            duration: Math.round(frameDurUs),
          });
          encoder.encode(frame);
          frame.close();
        }

        setExportPct(Math.round((f / totalFrames) * 100));
        if (f % 8 === 0) await new Promise(requestAnimationFrame); // let the live player breathe
      }

      await encoder.flush();
      muxer.finalize();

      const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bonkverse-replay-${realDateNow()}.mp4`; // real clock for filename
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("MP4 export failed:", err);
      alert("Video export failed. Check the console.");
    } finally {
      performance.now = realPerfNow; // always restore
      Date.now = realDateNow;
      delete performance.__v;
      try {
        handler?.destroy?.();
      } catch {}
      try {
        container?.remove();
      } catch {}
      setExportPct(null);
    }
  }

  // ── Offline GIF export on a fully isolated core ─────────────────────────
  // Same isolation pattern as exportReplayMp4: own core, own offscreen
  // renderer, reuses the steps the live engine already simulated.
  //
  // `startStep`/`endStep` let you export a clip instead of the whole replay;
  // wire these to a second (range) scrubber if you want clip selection in
  // the UI. Left as full-replay by default (endStep = null → export to es).
  async function exportReplayGif({
    scale = 1,
    maxWidth = 720, // downscale only if the native size exceeds this
    fps = 15,
    startStep = 0,
    endStep: clipEnd = null,
  } = {}) {
    const e = engine.current;
    if (!e) return;

    const effectiveScale = Math.min(scale, maxWidth / width);

    setGifExportPct(0);

    const es = e.replay.es || e.computed;
    const targetEnd = Math.min(clipEnd ?? es, es);
    ensureSimTo(targetEnd);
    const cap = e.stoppedEarly ? e.computed : Math.min(targetEnd, e.computed);

    const realPerfNow = performance.now.bind(performance);
    const realDateNow = Date.now.bind(Date);

    let core, handler, container;

    try {
      core = await loadBonkCore({ box2d, headless: false });
      globalThis.__bonkPatchGame?.(core);
      core.game.mute = true;

      const W = Math.round(width * effectiveScale),
        H = Math.round(height * effectiveScale);

      container = document.createElement("div");
      container.style.cssText = `position:absolute;left:-99999px;top:0;width:${W}px;height:${H}px;`;
      document.body.appendChild(container);
      Object.defineProperty(container, "offsetWidth", { get: () => W });
      Object.defineProperty(container, "offsetHeight", { get: () => H });

      handler = new core.CanvasHandler(container, "replay-gif-export");

      const exportPlayers = e.replay.playerArray.map((p, i) => {
        const clone = { ...p };
        if (e.rawAvatars?.[i] && core.Skin) {
          const skin = new core.Skin();
          skin.fromObject(e.rawAvatars[i]);
          clone.avatar = skin;
        }
        return clone;
      });
      handler.setPlayerArray?.(exportPlayers);

      const gif = GIFEncoder();

      const frameMs = 1000 / fps;
      const perfBase = realPerfNow();
      const dateBase = realDateNow();
      performance.now = () => perfBase + (performance.__v ?? 0);
      Date.now = () => dateBase + (performance.__v ?? 0);

      const stepsPerFrame = STEPS_PER_SEC / fps;
      const span = cap - startStep;
      const totalFrames = Math.max(1, Math.ceil(span / stepsPerFrame));

      for (let f = 0; f < totalFrames; f++) {
        performance.__v = f * frameMs;
        const playhead = startStep + f * stepsPerFrame;
        const whole = Math.min(Math.floor(playhead), cap);
        const t = playhead - whole;

        const cur = e.steps[whole];
        if (cur) {
          const prev = e.steps[Math.max(0, whole - 1)] ?? cur;
          handler.render(
            prev,
            cur,
            t,
            e.replay.gameSettings,
            e.resolver.at(whole),
            whole
          );

          // extract.canvas() gives a 2D snapshot of the WebGL frame — the
          // renderer view itself is a GL context, so getImageData won't
          // work directly on it.
          const snap = handler.renderer.extract.canvas();
          const ctx2d = snap.getContext("2d");
          const { data } = ctx2d.getImageData(0, 0, W, H);

          const palette = quantize(data, 256);
          const index = applyPalette(data, palette);

          gif.writeFrame(index, W, H, {
            palette,
            delay: frameMs,
            transparent: false,
          });
        }

        setGifExportPct(Math.round((f / totalFrames) * 100));
        if (f % 8 === 0) await new Promise(requestAnimationFrame);
      }

      gif.finish();

      const blob = new Blob([gif.bytes()], { type: "image/gif" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bonkverse-replay-${realDateNow()}.gif`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("GIF export failed:", err);
      alert("GIF export failed. Check the console.");
    } finally {
      performance.now = realPerfNow;
      Date.now = realDateNow;
      delete performance.__v;
      try {
        handler?.destroy?.();
      } catch {}
      try {
        container?.remove();
      } catch {}
      setGifExportPct(null);
    }
  }

  useEffect(() => {
    let alive = true;

    async function setup() {
      setReady(false);
      setPlaying(true);
      setStep(0);
      setEndStep(1);

      globalThis.SafeTrig ??= {};
      Object.assign(globalThis.SafeTrig, {
        safeSin: Math.sin,
        safeCos: Math.cos,
        safeTan: Math.tan,
        safeAsin: Math.asin,
        safeAcos: Math.acos,
        safeAtan: Math.atan,
        safeAtan2: Math.atan2,
        safeASin: Math.asin,
        safeACos: Math.acos,
        safeATan: Math.atan,
        safeATan2: Math.atan2,
      });

      const core = await loadBonkCore({ box2d, headless: false });
      globalThis.__bonkPatchGame?.(core);
      core.game.mute = false;

      resetAudio(core);

      if (core.SoundHandler) {
        core.game.soundManager = new core.SoundHandler();
      }

      const decoded =
        blob instanceof ArrayBuffer || ArrayBuffer.isView(blob)
          ? await decodeReplayData(blob)
          : blob;

      const replay = normalizeReplay(decoded);

      // Stash raw avatar objects BEFORE replacing them with live-core Skin
      // instances — the export core needs to rebuild skins on its own Skin class.
      const rawAvatars = replay.playerArray.map((p) => p?.avatar ?? null);

      for (const p of replay.playerArray) {
        if (p?.avatar && core.Skin) {
          const skin = new core.Skin();
          skin.fromObject(p.avatar);
          p.avatar = skin;
        }
      }

      replay.startingState.rc = (replay.startingState.rc ?? 0) + 1;

      const container = containerRef.current;
      if (!container) throw new Error("Replay container not mounted yet.");

      // Mutable size bonk reads via offsetWidth/offsetHeight. We change w/h on
      // fullscreen and bonk renders natively at that size (see the size effect).
      const sizeRef = { w: width, h: height };
      Object.defineProperty(container, "offsetWidth", {
        configurable: true,
        get: () => sizeRef.w,
      });
      Object.defineProperty(container, "offsetHeight", {
        configurable: true,
        get: () => sizeRef.h,
      });

      const handler = new core.CanvasHandler(container, "replay");
      handler.setPlayerArray?.(replay.playerArray);

      const physics = new core.Physics();
      const resolver = createInputResolver(replay.inputs);

      if (!alive) {
        handler.destroy?.();
        return;
      }

      engine.current = {
        core,
        replay,
        handler,
        physics,
        resolver,
        rawAvatars,
        sizeRef,
        steps: [replay.startingState],
        computed: 0,
        playhead: 0,
        raf: 0,
        last: 0,
        stoppedEarly: false,
      };

      setEndStep(replay.es || 1);
      setReady(true);
    }

    setup().catch((err) => {
      console.error("Replay setup failed:", err);
    });

    return () => {
      alive = false;

      const e = engine.current;
      if (!e) return;

      cancelAnimationFrame(e.raf);
      resetAudio(e.core);

      try {
        e.handler?.renderer?.clear?.();
      } catch {}

      try {
        e.handler?.destroy?.();
      } catch {}

      engine.current = null;
    };
  }, [blob, box2d, decodeReplayData, width, height]);

  function ensureSimTo(target) {
    const e = engine.current;
    if (!e || e.stoppedEarly) return;

    const end = e.replay.es || target;

    while (e.computed < target && e.computed < end) {
      const current = e.steps[e.computed];
      if (!current) break;

      const input = e.resolver.at(e.computed);

      let next;

      try {
        next = e.physics.step(
          current,
          input,
          e.replay.adminInputs[e.computed],
          STEP_DURATION,
          e.replay.gameSettings,
          1
        );
      } catch (err) {
        console.warn("Stopping replay before invalid transition:", {
          step: e.computed,
          error: err,
        });

        e.stoppedEarly = true;
        setEndStep(e.computed);
        setPlaying(false);
        break;
      }

      if (!next) break;

      if (next.rc !== current.rc) {
        console.log("Round transition:", current.rc, "->", next.rc);

        next.dontInterpolate = true;
        e.physics = new e.core.Physics();

        resetAudio(e.core);

        if (e.core.SoundHandler) {
          e.core.game.soundManager = new e.core.SoundHandler();
        }
      }

      e.steps[e.computed + 1] = next;
      e.computed++;
    }
  }

  function renderAt(target, t = 0) {
    const e = engine.current;
    if (!e) return;

    const s = Math.max(0, Math.min(target, e.computed));
    if (!e.steps[s]) return;

    try {
      const prevStep = e.steps[Math.max(0, s - 1)] ?? e.steps[s];
      const currentStep = e.steps[s];

      e.handler.render(
        prevStep,
        currentStep,
        t,
        e.replay.gameSettings,
        e.resolver.at(s),
        s
      );
    } catch (err) {
      console.warn("renderAt skipped bad frame:", {
        step: s,
        error: err,
      });
    }
  }

  useEffect(() => {
    if (!ready) return;

    const e = engine.current;
    if (!e) return;

    e.last = performance.now();

    const tick = (now) => {
      const currentEngine = engine.current;
      if (!currentEngine) return;

      const dt = Math.min(now - currentEngine.last, 100) / 1000;
      currentEngine.last = now;

      if (playing) {
        const effectiveEnd = currentEngine.stoppedEarly
          ? currentEngine.computed
          : currentEngine.replay.es || 0;

        currentEngine.playhead += dt * STEPS_PER_SEC;

        if (currentEngine.playhead >= effectiveEnd) {
          currentEngine.playhead = effectiveEnd;
          setPlaying(false);
        }

        const whole = Math.floor(currentEngine.playhead);

        ensureSimTo(whole + 1);

        if (currentEngine.steps[whole]) {
          renderAt(whole, currentEngine.playhead - whole);
        }

        setStep(whole);
      }

      currentEngine.raf = requestAnimationFrame(tick);
    };

    e.raf = requestAnimationFrame(tick);

    return () => {
      const currentEngine = engine.current;
      if (currentEngine) cancelAnimationFrame(currentEngine.raf);
    };
  }, [ready, playing]);

  function onScrub(value) {
    const e = engine.current;
    if (!e) return;

    e.playedManualSounds = new Set();

    const target = Number(value);
    e.playhead = target;

    resetAudio(e.core);

    if (e.core.SoundHandler) {
      e.core.game.soundManager = new e.core.SoundHandler();
    }

    ensureSimTo(target + 1);

    if (e.steps[target]) {
      renderAt(target, 0);
    }

    setStep(target);
  }

  const isExporting = exportPct !== null || gifExportPct !== null || exporting;

  return (
    <div
      className="replay-player"
      style={{
        width: isFs ? "100vw" : `${width}px`,
        minWidth: isFs ? 0 : `${width}px`,
        position: "relative", // anchor for the export progress overlay
      }}
    >
      <div
        id="bgreplay"
        ref={containerRef}
        style={{
          width: isFs ? "100vw" : `${width}px`,
          height: isFs ? "100vh" : `${height}px`,
          ...(isFs
            ? {}
            : {
                minWidth: `${width}px`,
                minHeight: `${height}px`,
                maxWidth: `${width}px`,
                maxHeight: `${height}px`,
              }),
          background: isFs ? "#0f172a" : "#102033",
          borderRadius: isFs ? 0 : 8,
          overflow: "hidden",
          position: "relative",
          flex: "0 0 auto",
          // bonk renders its canvas at the size we feed via offsetWidth/Height;
          // we just center that canvas. No CSS scaling = no blur.
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      />

      {exportPct !== null && (
        <div className="export-overlay">
          <div className="export-bar">
            <div style={{ width: `${exportPct}%` }} />
          </div>
          <span>Rendering video… {exportPct}%</span>
        </div>
      )}

      {gifExportPct !== null && (
        <div className="export-overlay">
          <div className="export-bar">
            <div style={{ width: `${gifExportPct}%` }} />
          </div>
          <span>Rendering GIF… {gifExportPct}%</span>
        </div>
      )}

      <div
        className={`replay-toolbar ${isFs ? "replay-toolbar--fs" : ""} ${
          isFs && !controlsVisible ? "replay-toolbar--hidden" : ""
        }`}
      >
        <button
          className="icon-btn"
          title={playing ? "Pause" : "Play"}
          onClick={() => {
            const e = engine.current;

            if (e && e.playhead >= (e.replay.es || 0)) {
              resetReplayToStart({ autoplay: true });
              return;
            }

            setPlaying((p) => !p);
          }}
          disabled={!ready}
        >
          {playing ? "⏸" : "▶"}
        </button>

        <button
          className="icon-btn"
          title="Restart"
          onClick={() => resetReplayToStart({ autoplay: true })}
          disabled={!ready}
        >
          ↺
        </button>

        <input
          className="scrubber"
          type="range"
          min={0}
          max={endStep}
          value={step}
          onChange={(ev) => onScrub(ev.target.value)}
          disabled={!ready}
        />

        <span className="time-label">
          {(step / STEPS_PER_SEC).toFixed(1)}s /{" "}
          {(endStep / STEPS_PER_SEC).toFixed(1)}s
        </span>

        <button
          className="icon-btn"
          title="Fullscreen"
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen?.();
            } else {
              const target =
                document.getElementById(fullscreenTargetId) ||
                containerRef.current;
              target?.requestFullscreen?.();
            }
          }}
          disabled={!ready}
        >
          ⛶
        </button>

        <button
          className="icon-btn"
          title="Export video"
          onClick={() => exportReplayMp4()}
          disabled={!ready || isExporting}
        >
          {exportPct !== null ? "…" : "⬇"}
        </button>

        <button
          className="icon-btn"
          title="Export GIF"
          onClick={() => exportReplayGif()}
          disabled={!ready || isExporting}
        >
          {gifExportPct !== null ? "…" : "GIF"}
        </button>
      </div>

      {!ready && <div>Loading replay…</div>}
    </div>
  );
}
