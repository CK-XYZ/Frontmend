#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const hosting = path.join(root, ".openai", "hosting.json");

for (const file of [index, worker, hosting]) {
  if (!existsSync(file)) throw new Error(`Missing Sites build input: ${file}`);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
const result = await Bun.build({
  entrypoints: [worker],
  target: "browser",
  format: "esm",
  minify: false,
  write: false,
});
if (!result.success) {
  throw new AggregateError(result.logs, "Could not bundle the Frontmend server artifact.");
}
const entrypoint = result.outputs.find((output) => output.kind === "entry-point") ?? result.outputs[0];
if (!entrypoint) {
  throw new Error("Worker build did not emit an entrypoint.");
}
await Bun.write(path.join(dist, "server", "index.js"), entrypoint);
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

console.log("Prepared Sites build: dist/server/index.js and dist/.openai/hosting.json");
