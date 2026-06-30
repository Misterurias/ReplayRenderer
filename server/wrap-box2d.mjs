// server/wrap-box2d.mjs
// Box2DModuleGJMod.js is an AMD module (define(...)). Vite/browser ESM and Node
// ESM can't import it directly. This wraps it into a single ESM file that default-
// exports the box2d namespace, usable identically in the browser, a Web Worker,
// and Node.
//
//   node server/wrap-box2d.mjs ./vendor/Box2DModuleGJMod.js ./vendor/box2d.esm.js
//   import box2d from "../vendor/box2d.esm.js";  // box2d.Dynamics.b2World

import { readFileSync, writeFileSync } from "node:fs";

const inPath = process.argv[2] || "./vendor/Box2DModuleGJMod.js";
const outPath = process.argv[3] || "./vendor/box2d.esm.js";

const code = readFileSync(inPath, "utf8");

const wrapped = `// AUTO-GENERATED from ${inPath} — do not edit, gitignore this.
let __captured = null;
const define = (...a) => { const f = a[a.length - 1]; __captured = typeof f === "function" ? f() : f; };
define.amd = {};
const module = { exports: {} };
const exports = module.exports;
const __win = (typeof globalThis !== "undefined" ? globalThis : {});

(function () {
${code}
}).call(__win);

const __mod = (module.exports && Object.keys(module.exports).length) ? module.exports : null;
const __ns = __captured || __mod || __win.Box2D || __win.box2d;
const box2d = (__ns && __ns.Dynamics) ? __ns : { Dynamics: __ns };
export default box2d;
`;

writeFileSync(outPath, wrapped);
console.log(`Wrote ${outPath} (${(wrapped.length / 1024).toFixed(0)} KB)`);
