// browser/thumbClient.js
// One shared worker for the whole grid. requestThumb() returns a Promise<objectURL>.
// Keeps a single worker alive (don't spawn one per card) and matches replies to
// requests by (cycle,id).

let worker = null;
const pending = new Map(); // key -> { resolve, reject }
const k = (cycle, id) => `${cycle}:${id}`;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./thumb.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const { type, cycle, id, webp, message } = e.data;
    const entry = pending.get(k(cycle, id));
    if (!entry) return;
    pending.delete(k(cycle, id));
    if (type === "error") entry.reject(new Error(message));
    else entry.resolve(URL.createObjectURL(new Blob([webp], { type: "image/webp" })));
  };
  return worker;
}

// url = your endpoint serving the raw replaydata bytes for (cycle,id)
export function requestThumb({ cycle, id, url, w = 320, h = 200 }) {
  const key = k(cycle, id);
  if (pending.has(key)) return pending.get(key).promise;
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  pending.set(key, { resolve, reject, promise });
  getWorker().postMessage({ type: "thumb", cycle, id, url, w, h });
  return promise;
}
