// core/physics-loader.js

let _core = null;

function makeStub() {
  const fn = function () {
    return STUB;
  };

  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "length") return 0;
      return STUB;
    },
    apply: () => STUB,
    construct: () => STUB,
    set: () => true,
  });
}

const STUB = makeStub();

function installPeerJsStub(g = globalThis) {
  const MockPeer = class {
    constructor() {}
    on() {}
    connect() {
      return {
        on() {},
        send() {},
        close() {},
      };
    }
    destroy() {}
  };

  g.peerjs = {
    peerjs: {
      Peer: MockPeer,
    },
  };

  g.Peer = MockPeer;
}

function installPsonStub(g = globalThis) {
  g.dcodeIO = {
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
}

export function installHeadlessStubs(g = globalThis) {
  const names = [
    "document",
    "window",
    "navigator",
    "localStorage",
    "sessionStorage",
    "$",
    "jQuery",
    "PIXI",
    "Howler",
    "Howl",
    "anime",
    "io",
    "WebSocket",
    "FontFace",
  ];

  for (const name of names) {
    if (g[name] === undefined) g[name] = STUB;
  }

  if (typeof g.requestAnimationFrame !== "function") {
    g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  }

  if (typeof g.cancelAnimationFrame !== "function") {
    g.cancelAnimationFrame = (id) => clearTimeout(id);
  }

  if (g.window === STUB) g.window = g;
  if (g.self === undefined) g.self = g;

  installPeerJsStub(g);
  installPsonStub(g);

  g.GameResources ??= {
    soundStrings: new Proxy({}, {
      get: () => "",
    }),
  };
}

export async function loadBonkCore({ box2d, headless = false } = {}) {
  if (_core) return _core;

  if (!box2d) {
    throw new Error("loadBonkCore: pass the Box2DModuleGJMod build as `box2d`.");
  }

  if (headless) {
    installHeadlessStubs(globalThis);
  }

  const { createBonkCore } = await import("../vendor/bonk-core.mjs");

  _core = createBonkCore(box2d);
  return _core;
}

export async function makePhysics(opts) {
  const core = await loadBonkCore(opts);
  return new core.Physics();
}