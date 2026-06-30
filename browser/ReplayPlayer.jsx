import { useEffect, useRef, useState } from "react";
import { loadBonkCore } from "../core/physics-loader.js";
import { normalizeReplay } from "../core/decode.js";
import { createInputResolver } from "../core/inputs.js";

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

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [step, setStep] = useState(0);
  const [endStep, setEndStep] = useState(1);
  const [exporting, setExporting] = useState(false);

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

      Object.defineProperty(container, "offsetWidth", {
        configurable: true,
        get: () => width,
      });

      Object.defineProperty(container, "offsetHeight", {
        configurable: true,
        get: () => height,
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

  return (
    <div
      className="replay-player"
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
      }}
    >
      <div
        id="bgreplay"
        ref={containerRef}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          minWidth: `${width}px`,
          minHeight: `${height}px`,
          maxWidth: `${width}px`,
          maxHeight: `${height}px`,
          background: "#102033",
          borderRadius: 8,
          overflow: "hidden",
          position: "relative",
          flex: "0 0 auto",
        }}
      />

      <div className="replay-toolbar">
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
            const target =
              document.getElementById(fullscreenTargetId) ||
              containerRef.current;

            target?.requestFullscreen?.();
          }}
          disabled={!ready}
        >
          ⛶
        </button>

        <button
          className="icon-btn"
          title="Export video"
          onClick={exportVisibleReplayVideo}
          disabled={!ready || exporting}
        >
          {exporting ? "…" : "⬇"}
        </button>
      </div>

      {!ready && <div>Loading replay…</div>}
    </div>
  );
}