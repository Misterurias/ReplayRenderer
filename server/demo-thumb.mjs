// server/demo-thumb.mjs
// Standalone visual demo: proves decode→sim→trail and emits a real image WITHOUT
// box2d. StandInPhysics is ONLY a visual stand-in (same step() contract, real bonk
// constants). The real Physics drops into simulateTrajectory unchanged.
//
//   node server/demo-thumb.mjs   ->  ./demo-thumb.png

import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { simulateTrajectory } from "../core/sim.js";
import { renderTrailThumbnail, encodeThumbnail } from "../core/trail.js";

const GRAVITY = 20, DT = 1 / 30, FORCE = 12, MASS = Math.PI, REST = 0.8;
const B = { minX: -28, maxX: 28, minY: -18, maxY: 18 };

class StandInPhysics {
  step(state, inputs) {
    const next = { physics: state.physics, fte: state.fte - 1, discs: [] };
    for (let i = 0; i < state.discs.length; i++) {
      const d = state.discs[i]; if (!d) continue;
      const inp = inputs[i] || {};
      let ax = 0, ay = GRAVITY; const f = FORCE / MASS;
      if (inp.left) ax -= f; else if (inp.right) ax += f;
      if (inp.up) ay -= f * 1.6; else if (inp.down) ay += f;
      let xv = (d.xv + ax * DT) * 0.995, yv = (d.yv + ay * DT) * 0.995;
      let x = d.x + xv * DT, y = d.y + yv * DT;
      if (x < B.minX) { x = B.minX; xv = -xv * REST; } if (x > B.maxX) { x = B.maxX; xv = -xv * REST; }
      if (y < B.minY) { y = B.minY; yv = -yv * REST; } if (y > B.maxY) { y = B.maxY; yv = -yv * REST; }
      next.discs[i] = { x, y, xv, yv, a: d.a + d.av * DT, av: d.av, team: d.team };
    }
    return next;
  }
}

function syntheticReplay() {
  const teams = [2, 3, 4, 5];
  const discs = teams.map((team, i) => ({ x: -20 + i * 13, y: -14, xv: (i - 1.5) * 6, yv: 0, a: 0, av: (i - 1.5) * 2, team }));
  const es = 360;
  const inputs = teams.map((_, id) => {
    const seq = [];
    for (let s = 0; s < es; s += 18 + id * 5) {
      const dir = (s / 18 + id) % 4;
      seq[s] = { left: dir === 0, right: dir === 2, up: dir === 1 || s % 54 === 0, down: dir === 3 };
    }
    return seq;
  });
  return { startingState: { physics: { ppm: 12, discRadius: 1 }, fte: 99999, discs },
           inputs, adminInputs: Array(es).fill(null), gameSettings: { mo: "b" }, es,
           playerArray: teams.map((t, i) => ({ userName: `p${i}`, avatar: null })) };
}

const traj = simulateTrajectory(syntheticReplay(), new StandInPhysics(), { sampleEvery: 2 });
const canvas = createCanvas(640, 400);
renderTrailThumbnail(traj, canvas, { width: 640, height: 400, padding: 16 });
writeFileSync("./demo-thumb.png", await encodeThumbnail(canvas, "image/png"));
console.log(`wrote demo-thumb.png  (${traj.frames.length} frames, ${traj.frames[0].length} discs)`);
