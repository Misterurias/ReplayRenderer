// inputs.js
// Resolve the per-player input state at any step.
//
// Source does this with getInputs(step): for each player, walk *backwards* from
// `step` until a recorded input is found. That's O(players * step) per frame and
// O(players * es^2) over a whole replay. We precompute instead.
//
// Two access patterns:
//   nextStep()  -> O(1) amortized, for the forward sim loop
//   at(step)    -> O(log k) binary search, for scrubbing on the detail page

const NEUTRAL = Object.freeze({
  left: false, right: false, up: false, down: false, action: false, action2: false,
});

export function createInputResolver(sparseInputs) {
  // For each player, collect the sorted list of steps that have a recorded change.
  const players = sparseInputs.map((perPlayer) => {
    if (!perPlayer) return null;
    const steps = [];
    for (let s = 0; s < perPlayer.length; s++) if (perPlayer[s]) steps.push(s);
    return { steps, data: perPlayer };
  });

  const cursors = players.map(() => 0);   // forward-iteration pointers
  const current = players.map(() => NEUTRAL);
  let curStep = -1;

  function nextStep() {
    curStep++;
    for (let id = 0; id < players.length; id++) {
      const p = players[id];
      if (!p) continue;
      // advance this player's cursor past every change at/<= curStep
      while (cursors[id] < p.steps.length && p.steps[cursors[id]] <= curStep) {
        current[id] = p.data[p.steps[cursors[id]]];
        cursors[id]++;
      }
    }
    return current;
  }

  // Random access: last input at or before `step` per player (for scrubbing).
  function at(step) {
    const out = [];
    for (let id = 0; id < players.length; id++) {
      const p = players[id];
      if (!p) { out[id] = NEUTRAL; continue; }
      // binary search rightmost steps[k] <= step
      let lo = 0, hi = p.steps.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (p.steps[mid] <= step) { found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      out[id] = found === -1 ? NEUTRAL : p.data[p.steps[found]];
    }
    return out;
  }

  // Reset the forward cursor (e.g. after a scrub, before resuming forward play).
  function seek(step) {
    curStep = step;
    for (let id = 0; id < players.length; id++) {
      const p = players[id];
      if (!p) { cursors[id] = 0; continue; }
      let k = 0;
      while (k < p.steps.length && p.steps[k] <= step) k++;
      cursors[id] = k;
      current[id] = k === 0 ? NEUTRAL : p.data[p.steps[k - 1]];
    }
  }

  return { nextStep, at, seek, playerCount: players.length };
}
