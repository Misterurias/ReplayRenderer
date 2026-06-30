// server/build-core.mjs
// Converts bonk's alpha2s.js into an importable factory:
//
//   vendor/alpha2s.js -> vendor/bonk-core.mjs
//
// The generated module exports createBonkCore(box2d), which exposes the pieces
// needed for replay rendering without booting Bonk's full menu/lobby UI.

import { readFileSync, writeFileSync } from "node:fs";

const inPath = process.argv[2] || "./vendor/alpha2s.js";
const outPath = process.argv[3] || "./vendor/bonk-core.mjs";

let src = readFileSync(inPath, "utf8");

// 1) Replace Bonk's requirejs wrapper with an exported factory.
const headerRe = /^requirejs\(\[[^\]]*\],\s*function\(([^)]*)\)\s*\{/;

if (!headerRe.test(src)) {
  throw new Error("Could not find requirejs(...) header — file layout changed.");
}

src = src.replace(headerRe, (_match, params) => {
  const names = params
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const ordered = ["box2d", ...names.filter((name) => name !== "box2d")];

  const withDefaults = ordered.map((name) => {
    if (name === "box2d") return "box2d";
    return `${name} = globalThis.${name}`;
  });

  return `export function createBonkCore(${withDefaults.join(", ")}) {`;
});

// 2) Return after renderer + sound bootstrap, before menu/lobby boot.
const exportReturn =
  "\n\t// ── injected by build-core.mjs: renderer + sound bootstrap finished; skip menu/lobby boot ──\n" +
  "\tGraphicsHandler.replayRenderer ??= GraphicsHandler.gameRenderer;\n" +
  "\tgame.soundManager = new SoundHandler;\n" +
  "\tgame.mute = false;\n" +
  "\treturn {\n" +
  "\t\tPhysics,\n" +
  "\t\tMap,\n" +
  "\t\tMap2,\n" +
  "\t\tBonkView,\n" +
  "\t\tSkin,\n" +
  "\t\tCanvasHandler,\n" +
  "\t\tGraphicsHandler,\n" +
  "\t\tPlayerRenderer,\n" +
  "\t\tSoundHandler,\n" +
  "\t\tgame,\n" +
  "\t};\n\n";

const bootAnchors = [
  /const f0v49 = new Howl\(/,
  /moment\.updateLocale/,
  /\$\(document\)\.ready\(function\(\)\s*\{\s*\n\s*game\.simpleFPS/,
];

let injected = false;

for (const anchor of bootAnchors) {
  if (anchor.test(src)) {
    src = src.replace(anchor, (match) => exportReturn + match);
    injected = true;
    break;
  }
}

if (!injected) {
  throw new Error("Could not find a safe boot anchor — alpha2s.js layout changed.");
}

// 3) Disable Bonk's original camera shake.
// In the full Bonk runtime this works, but in the extracted replay renderer it
// can push/blank the PIXI container during platform impacts.
src = src.replace(
  `this.particleManager.render(prevStep, currentStep, t, this.renderer, this.isReplay);
\t\tif (currentStep.shk && (currentStep.shk.x != 0 || currentStep.shk.y != 0)) {`,
  `this.particleManager.render(prevStep, currentStep, t, this.renderer, this.isReplay);
\t\t// patched by build-core.mjs: disable original camera shake in external replay player
\t\tif (false && currentStep.shk && (currentStep.shk.x != 0 || currentStep.shk.y != 0)) {`
);

src = src.replace(
  "game.soundManager.resetSumVols();\n\t\tcurrentStep.sts = null;",
  "game.soundManager.resetSumVols();\n\t\t// patched: keep sts so audio still works after scrubbing\n\t\t// currentStep.sts = null;"
);

src = src.replace(
  `const sound = new Howl({
\t\t\t\tsrc: soundURI,
\t\t\t\tvolume: volume
\t\t\t});`,
  `const sound = new Howl({
\t\t\t\tsrc: [soundURI],
\t\t\t\tvolume: volume
\t\t\t});`
);

// Patch Howler v2 compatibility.
// Bonk passes src as a string, but this Howler build expects an array.
src = src.replaceAll(
  /src:\s*GameResources\.soundStrings\.([a-zA-Z0-9_]+)/g,
  "src: [GameResources.soundStrings.$1]"
);

src = src.replaceAll(
  /src:\s*soundURI/g,
  "src: [soundURI]"
);

// 4) Close the generated factory.
src = src.replace(/\}\);\s*$/, "}\n");

writeFileSync(outPath, src);

console.log(`Wrote ${outPath} (${(src.length / 1024).toFixed(0)} KB)`);