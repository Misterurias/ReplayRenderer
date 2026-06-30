// sim.js
// Deterministic driver around bonk's REAL Physics. We never reimplement physics —
// `physics` is the extracted bonk Physics instance (see harness/extract.md). This
// just feeds it inputs in order and collects what we need.
//
// physics contract (verified against alpha2s.js Physics.prototype.step):
//   physics.step(state, playerInputs, adminInputs, stepDuration=30, gameSettings, numPasses=1) -> nextState
//
// Returned-state disc schema (verified, in meters):
//   { x, y, xv, yv, a, av, team, a1, a2, ni, ... }

import { createInputResolver } from "./inputs.js";

const STEP_DURATION = 30; // bonk's fixed sim rate marker (30 steps/sec)

// Pull the renderable disc set out of a state.
export function extractDiscs(state) {
  const out = [];
  const discs = state.discs || [];
  for (let i = 0; i < discs.length; i++) {
    const d = discs[i];
    if (!d) continue;
    out.push({ index: i, x: d.x, y: d.y, a: d.a ?? 0, team: d.team ?? -1, dead: !!d.diedThisStep });
  }
  return out;
}

// Run a replay to completion, sampling disc positions for a trail thumbnail.
// Returns { frames:[[disc,…],…], ppm, discRadius, players, steps, bbox }.
export function simulateTrajectory(replay, physics, opts = {}) {
  const { sampleEvery = 2, maxSteps = 100000 } = opts;
  const resolver = createInputResolver(replay.inputs);

  let state = replay.startingState;
  const ppm = state.physics?.ppm ?? 15;
  const discRadius = state.physics?.discRadius ?? 1;

  const frames = [];
  let bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  const sample = (s) => {
    const discs = extractDiscs(s);
    for (const d of discs) {
      if (d.x < bbox.minX) bbox.minX = d.x;
      if (d.y < bbox.minY) bbox.minY = d.y;
      if (d.x > bbox.maxX) bbox.maxX = d.x;
      if (d.y > bbox.maxY) bbox.maxY = d.y;
    }
    frames.push(discs);
  };

  sample(state); // frame 0

  const end = Math.min(replay.es ?? maxSteps, maxSteps);
  for (let s = 0; s < end; s++) {
    const inputs = resolver.nextStep();
    state = physics.step(state, inputs, replay.adminInputs[s], STEP_DURATION, replay.gameSettings, 1);
    if (!state) break;
    if (s % sampleEvery === 0) sample(state);
    if (state.fte === 0) break; // round-ended sentinel
  }

  return { frames, ppm, discRadius, players: replay.playerArray, steps: frames.length, bbox };
}

// Generic single-step helper (used by the live player on the detail page, which
// keeps its own `steps[]` array so it can scrub forward/back).
export function makeStepper(replay, physics) {
  const resolver = createInputResolver(replay.inputs);
  let curStep = 0;
  return {
    resolver,
    get step() { return curStep; },
    advance(state) {
      const inputs = resolver.nextStep();
      const next = physics.step(state, inputs, replay.adminInputs[curStep], STEP_DURATION, replay.gameSettings, 1);
      curStep++;
      return next;
    },
  };
}
