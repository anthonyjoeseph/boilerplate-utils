import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Plugin, UserConfig } from "vite";
import type { RequestHandler } from "express";
import type { MethodHandlers } from "./request-handler.js";
import { requestHandlerForRoutes } from "./request-handler.js";
import type { BundlerAdapter, PageDependencies } from "./bundler.js";

type AnyRoutes = Record<string, MethodHandlers<any, any>>;
type ParseFn = (url: string) => { path: string; params?: unknown };

/* -------------------------------------------------------------------------- */
/* the vite BundlerAdapter                                                     */
/* -------------------------------------------------------------------------- */

interface ManifestEntry {
  file: string;
  css?: string[];
}

/**
 * The only vite-specific knowledge in the system: how to turn a source file
 * path into either a dev-server URL, or a `.vite/manifest.json` lookup.
 */
export const viteAdapter = (opts: {
  mode: "dev" | "prod";
  /** required in prod: path to vite's `.vite/manifest.json` */
  manifestPath?: string;
  /** source root manifest keys and dev URLs are computed relative to; defaults to cwd */
  root?: string;
  /** public base path; defaults to "/" */
  base?: string;
}): BundlerAdapter => {
  const root = opts.root ?? process.cwd();
  const base = opts.base ?? "/";
  const toKey = (absPath: string) => path.relative(root, absPath).split(path.sep).join("/");

  if (opts.mode === "dev") {
    return {
      mode: "dev",
      resolveEntry: (sourcePath) => ({
        scripts: [`${base}@vite/client`, `${base}${toKey(sourcePath)}`],
        styles: []
      }),
      preambleScript: () =>
        [
          `import { injectIntoGlobalHook } from "${base}@react-refresh";`,
          "injectIntoGlobalHook(window);",
          "window.$RefreshReg$ = () => {};",
          "window.$RefreshSig$ = () => (type) => type;"
        ].join("\n")
    };
  }

  if (!opts.manifestPath) {
    throw new Error("viteAdapter: manifestPath is required in prod mode");
  }
  const manifest = JSON.parse(
    fs.readFileSync(opts.manifestPath, "utf-8")
  ) as Record<string, ManifestEntry>;

  return {
    mode: "prod",
    resolveEntry: (sourcePath) => {
      const key = toKey(sourcePath);
      const entry = manifest[key];
      if (!entry) {
        throw new Error(`viteAdapter: no manifest entry for "${key}" in ${opts.manifestPath}`);
      }
      return {
        scripts: [`${base}${entry.file}`],
        styles: (entry.css ?? []).map((css) => `${base}${css}`)
      };
    }
  };
};

/* -------------------------------------------------------------------------- */
/* build: point vite at the files `generatePages` already wrote                */
/* -------------------------------------------------------------------------- */

/**
 * Recursively finds every `index.html` under `generatedDir`, keyed by its
 * path relative to that dir. Lets `viteBuildInput` read back whatever a prior
 * `generate` run wrote to disk, without re-running `generatePages` (and
 * therefore without re-importing route modules, loaders and all) just to
 * configure the build.
 */
const discoverGeneratedFiles = (generatedDir: string): Record<string, string> => {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== "index.html") continue;
      const rel = path.relative(generatedDir, path.dirname(full)).split(path.sep).join("/");
      files[rel === "" ? "index" : rel] = full;
    }
  };
  if (fs.existsSync(generatedDir)) walk(generatedDir);
  return files;
};

/**
 * Points `vite build` at the HTML files {@link generatePages} wrote. `root` is
 * set to the generated dir so output mirrors it — `generated/home/index.html`
 * becomes `dist/home/index.html`, with no post-build rename. Nothing here is
 * virtual: vite reads the exact files you already inspected, and its built-in
 * HTML handling discovers each `<script src>`, code-splits shared chunks
 * across pages, and rewrites the tags to hashed output.
 *
 * Pass `files` if you already have the map `generatePages` returned; omit it
 * to have this discover files on disk instead, which is the usual case — the
 * `generate` step and the `vite build` step are meant to be separate
 * commands, so `vite.config.ts` doesn't need to re-run generation itself.
 */
export const viteBuildInput = (opts: {
  files?: Record<string, string>;
  generatedDir?: string;
  outDir?: string;
}): Pick<UserConfig, "root" | "build"> => {
  const generatedDir = path.resolve(opts.generatedDir ?? "generated");
  return {
    root: generatedDir,
    build: {
      outDir: path.resolve(opts.outDir ?? "dist"),
      emptyOutDir: true,
      rollupOptions: { input: opts.files ?? discoverGeneratedFiles(generatedDir) }
    }
  };
};

/* -------------------------------------------------------------------------- */
/* dev: render every request in-process through vite's own module graph        */
/* -------------------------------------------------------------------------- */

/**
 * Dev-mode middleware. Both static and dynamic pages re-render on every
 * request through `server.ssrLoadModule`, so route/loader edits are live —
 * `generatePages`'s output is never read in dev, and is never stale, because
 * nothing depends on it until build. The route module is reloaded fresh each
 * request (vite invalidates it on file change via its own module graph), so
 * this also gets HMR without a second dev-server process or a hardcoded
 * client origin: everything is one process, one origin.
 */
export const vitePagesPlugin = (opts: {
  /** path to the routes barrel module, resolved relative to vite.config.ts */
  routesEntry: string;
  /** parse fn from `pathCodec(...Object.keys(routes))` */
  parse: ParseFn;
  dependencies: object;
}): Plugin => ({
  name: "boilerplate-utils:pages",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      void (async () => {
        const url = req.originalUrl ?? req.url ?? "/";
        const parsed = opts.parse(url);
        if (parsed.path === "NotFound") {
          next();
          return;
        }

        const routesModule = (await server.ssrLoadModule(opts.routesEntry)) as Record<
          string,
          MethodHandlers | undefined
        >;
        const handler = routesModule[parsed.path]?.GET;
        if (!handler) {
          next();
          return;
        }

        const bundler = viteAdapter({ mode: "dev", root: server.config.root });
        const dependencies = { ...opts.dependencies, bundler } as PageDependencies;
        const params = ("params" in parsed ? parsed.params : {}) as Record<string, string>;

        let html: string;
        if (handler.type === "static-request") {
          const view = await handler.fn(dependencies);
          html = Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("utf-8");
        } else {
          const result = await handler.fn({ params, dependencies }, undefined);
          html = String(result.body);
        }

        const transformed = await server.transformIndexHtml(url, html);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(transformed);
      })().catch(next);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* prod: serve build output                                                    */
/* -------------------------------------------------------------------------- */

/** Static files out of `outDir` first, then dynamic pages through the route handler. */
export const serveBuiltRoutes = <Routes extends AnyRoutes, Deps extends object>(opts: {
  routes: Routes;
  parse: ParseFn;
  dependencies: Deps;
  outDir: string;
  /** source root manifest keys were written relative to; defaults to cwd */
  sourceRoot?: string;
}): RequestHandler => {
  const bundler = viteAdapter({
    mode: "prod",
    manifestPath: path.join(opts.outDir, ".vite", "manifest.json"),
    root: opts.sourceRoot ?? process.cwd()
  });
  const dependencies = { ...opts.dependencies, bundler } as Deps & PageDependencies;

  const routeHandler = requestHandlerForRoutes(
    opts.parse as (...args: any) => any,
    opts.routes as any,
    dependencies
  );
  const staticHandler = express.static(opts.outDir, { extensions: ["html"] });

  return (req, res, next) => {
    staticHandler(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      routeHandler(req, res, next);
    });
  };
};
