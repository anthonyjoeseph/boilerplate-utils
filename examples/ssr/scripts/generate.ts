import fs from "node:fs/promises";
import path from "node:path";
import { generatePages } from "@boilerplate-utils/server";
import * as R from "../routes/index.js";

// Full server render for static pages (source-relative script paths).
const { files } = await generatePages({ routes: R, dependencies: {} });
for (const [key, file] of Object.entries(files)) {
  console.log(`${key} -> ${file}`);
}

// Minimal stubs for dynamic pages. Vite needs an HTML entry pointing at each
// client bundle so it can build a manifest entry. The actual document is
// rendered at request time; only the <script> tag matters here.
const dynamicStubs: { routeKey: string; entryFile: string }[] = [
  {
    routeKey: "user/[userId]",
    entryFile: path.resolve("routes/user/[userId]/App.entry.ts")
  },
  {
    routeKey: "ticker",
    entryFile: path.resolve("routes/ticker/App.entry.ts")
  }
];

for (const { routeKey, entryFile } of dynamicStubs) {
  const outFile = path.resolve("generated", routeKey, "index.html");
  const rel = path
    .relative(path.dirname(outFile), entryFile)
    .split(path.sep)
    .join("/");
  const src = rel.startsWith(".") ? rel : `./${rel}`;
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(
    outFile,
    `<html><body><script type="module" src="${src}"></script></body></html>`
  );
  console.log(`${routeKey} (stub) -> ${outFile}`);
}
