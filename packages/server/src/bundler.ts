import fs from "node:fs/promises";
import path from "node:path";
import type { MethodHandlers } from "./request-handler.js";

type AnyRoutes = Record<string, MethodHandlers<any, any>>;

/* -------------------------------------------------------------------------- */
/* the portability seam                                                        */
/* -------------------------------------------------------------------------- */

export interface EntryAssets {
  scripts: string[];
  styles: string[];
}

/**
 * The entire bundler-specific surface: given a source module's absolute file
 * path, what URLs should the document reference right now?
 *
 * dev  — passthrough to the dev server's origin, plus whatever preamble that
 *        bundler's HMR needs (vite: `/@vite/client` + the react-refresh shim;
 *        parcel: nothing, it injects its own).
 * prod — a lookup in that bundler's manifest for the hashed name, plus the CSS
 *        it pulled in. Vite writes `.vite/manifest.json`; parcel and webpack
 *        each write their own shape — that shape is the only bundler-specific
 *        knowledge in the whole system.
 *
 * Everything above this interface — rendering, routing, hydration, data
 * serialization, the generate step — is shared across bundlers. An adapter is
 * a manifest reader and a URL joiner.
 */
export interface BundlerAdapter {
  mode: "dev" | "prod";
  resolveEntry: (sourcePath: string) => EntryAssets;
  /** inline JS run before any entry script; dev-only (e.g. the react-refresh shim) */
  preambleScript?: () => string;
}

/** Injected into `dependencies` so page handlers can resolve their own entry URLs. */
export interface PageDependencies {
  bundler: BundlerAdapter;
}

/* -------------------------------------------------------------------------- */
/* the generate step                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Adapter used only by {@link generatePages}: writes the literal, unbundled
 * source path as the script `src`, relative to the HTML file being written.
 * No hashes, no manifest — the point of `generate` is that its output is
 * exactly what a bundler will read, in a form a human can also read first.
 */
const sourceAdapter = (outFile: string): BundlerAdapter => ({
  mode: "dev",
  resolveEntry: (sourcePath) => {
    const rel = path.relative(path.dirname(outFile), sourcePath).split(path.sep).join("/");
    return { scripts: [rel.startsWith(".") ? rel : `./${rel}`], styles: [] };
  }
});

/**
 * Renders every static page to a plain HTML file, before any bundler runs.
 *
 * Each file's `<script type="module">` points at the *source* entry —
 * `<script type="module" src="../routes/home/App.tsx">` — a path you can click
 * through in your editor. That's also, not coincidentally, the one thing every
 * bundler already knows how to follow: point it at these files and it walks
 * that `src` to a source module and rewrites the tag to the hashed output.
 *
 * Dynamic pages are skipped — they have no build-time HTML. They render through
 * the same `staticPage`/`dynamicPage` code path at request time instead,
 * resolving their script src through a {@link BundlerAdapter} rather than
 * writing it literally.
 */
export const generatePages = async <Routes extends AnyRoutes, Deps>(opts: {
  routes: Routes;
  dependencies: Deps;
  outDir?: string;
}): Promise<{ files: Record<string, string> }> => {
  const outDir = path.resolve(opts.outDir ?? "generated");
  const files: Record<string, string> = {};

  for (const [routeKey, handlers] of Object.entries(opts.routes)) {
    const handler = handlers.GET;
    if (!handler || handler.type !== "static-request" || handler.extension !== "html") continue;

    const outFile = path.join(outDir, routeKey, "index.html");
    const bundler = sourceAdapter(outFile);
    const dependencies = { ...opts.dependencies, bundler } as Deps & PageDependencies;

    const view = await handler.fn(dependencies);
    const buf = Buffer.from(view.buffer, view.byteOffset, view.byteLength);

    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, buf);
    files[routeKey] = outFile;
  }

  return { files };
};
