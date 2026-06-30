import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { decodeStoredReplay } from "./codec.js";

mkdirSync("./public", { recursive: true });

const blob = readFileSync("./one.bin");
const decoded = decodeStoredReplay(blob);

writeFileSync(
  "./public/one.json",
  JSON.stringify({
    id: process.env.REPLAY_ID ?? "one.bin",
    decoded,
  })
);

console.log("wrote ./public/one.json");