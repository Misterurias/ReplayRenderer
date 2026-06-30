// load-box2d.mjs
// Box2DModuleGJMod is an AMD module (define(...)), which Node ESM can't import
// directly. This shims define()/global so we can run the file and capture the
// box2d namespace it exports — regardless of whether it uses AMD, a global, or CJS.
//
//   const box2d = await loadBox2D("/path/to/Box2DModuleGJMod.js");
//   box2d.Dynamics.b2World   // should exist

import { readFileSync } from "node:fs";
import vm from "node:vm";

export async function loadBox2D(path) {
  const code = readFileSync(path, "utf8");
  let captured = null;

  // AMD: define([deps], factory) or define(factory)
  const define = (...args) => {
    const factory = args[args.length - 1];
    captured = typeof factory === "function" ? factory() : factory;
  };
  define.amd = {};

  const sandbox = {
    define,
    module: { exports: {} },
    exports: {},
    window: {},
    self: {},
    global: {},
    console,
  };
  sandbox.window.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: path });

  // Resolve the namespace from whichever convention the file used.
  const candidates = [
    captured,
    sandbox.module.exports && Object.keys(sandbox.module.exports).length ? sandbox.module.exports : null,
    sandbox.window.Box2D, sandbox.Box2D, sandbox.window.box2d,
  ].filter(Boolean);

  for (const c of candidates) {
    if (c?.Dynamics?.b2World) return c;            // box2dweb namespace
    if (c?.b2World) return { Dynamics: c };         // already flattened
  }
  if (candidates[0]) return candidates[0];          // last resort: hand back what we got
  throw new Error("Could not capture box2d namespace — inspect the module's export style.");
}
