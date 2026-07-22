import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ComponentType, ReactElement } from "react";
import { NEVER } from "rxjs";
import type { Observable } from "rxjs";
import {
  PAGE_ROOT_ID,
  PAGE_STREAM_ANCHOR_ID,
  PageData,
  PageStreamAnchor,
  PageStreamBootstrap,
  pageStreamChunkScript,
  pageStreamCompleteScript,
  pageStreamErrorScript
} from "@boilerplate-utils/react";
import type { JsonValue, StreamingPageProps } from "@boilerplate-utils/react";
import type { PageDependencies } from "./bundler.js";
import { dynamicRequest, dynamicStreamingRequest, staticRequest } from "./request.js";
import type {
  DynamicRequest,
  DynamicStreamingRequest,
  StaticRequest
} from "./request.js";

/* -------------------------------------------------------------------------- */
/* the App boundary                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A module whose default export is the component mounted into the hydration
 * root, on both server and client.
 *
 * Written as `() => import("./App")` so TypeScript checks the path exists and
 * autocompletes it. At the `staticPage`/`dynamicPage` call site, the calling
 * file's own source is read back off disk (see {@link resolveAppEntry}) to
 * recover that literal specifier and resolve it to a real file — that file
 * becomes the client bundle's entry, and *only* that file: a loader can
 * import `pg` freely because nothing about the route module itself is
 * reachable from the client build.
 */
export type AppModule<Props extends JsonValue | undefined> = () => Promise<{
  default: ComponentType<Props>;
}>;

/**
 * The server-only half of a page: renders the whole document and is never sent
 * to the browser. `App` is supplied by the library, not written by the
 * caller — it already is the hydration root, the serialized loader data, and
 * the client entry's script tag. The document's only job is to render it
 * somewhere inside `<body>`.
 */
export type DocumentComponent<Data extends JsonValue | undefined = undefined> = ComponentType<{
  App: ComponentType;
  data: Data;
}>;

/* -------------------------------------------------------------------------- */
/* resolving `() => import("./X")` back to a file                              */
/* -------------------------------------------------------------------------- */

// Matches the first `app: () => import("...")` in a file's *source text*.
// Deliberately not `appModule.toString()`: any tool that transforms dynamic
// imports for its own module graph (vite's dev SSR rewrites them to
// `__vite_ssr_dynamic_import__(...)`, esbuild inlines them when bundling
// vite.config.ts) makes the runtime closure's source unrecoverable. Reading
// the file directly sidesteps whatever the loader did to the executed code.
const APP_FIELD_SPECIFIER = /app\s*:\s*\(\s*\)\s*=>\s*import\(\s*["'`]([^"'`]+)["'`]\s*\)/u;

/**
 * Finds the file that called `staticPage`/`dynamicPage`, by parsing a captured
 * stack trace. Works in Node/tsx/vite-node/vite's SSR module transform, which
 * all preserve real per-file source paths in stack frames; it is not expected
 * to survive a minified/bundled build, which is fine — `staticPage`/
 * `dynamicPage` only ever run in those unminified contexts (`generate`, dev
 * SSR, prod SSR reading pre-rendered source), never inside the client bundle
 * itself, and never through vite's *config* loader (which bundles everything
 * it statically imports into one file — route modules must only ever be
 * loaded live, e.g. via `server.ssrLoadModule`, not imported into
 * `vite.config.ts`).
 */
const callerFile = (): string => {
  const original = Error.stackTraceLimit;
  Error.stackTraceLimit = 5;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = original;

  // frame 0 is this function, frame 1 is resolveAppEntry, frame 2 is
  // staticPage/dynamicPage, frame 3 is the route module that called them.
  const frame = stack.split("\n")[4];
  const match = frame?.match(/\((.*):\d+:\d+\)\s*$/) ?? frame?.match(/at (.*):\d+:\d+\s*$/);
  const raw = match?.[1];
  if (!raw) {
    throw new Error(
      "page(): could not determine the calling file from the stack trace. " +
        "This lookup only works in unminified Node/tsx/vite-node contexts."
    );
  }
  return raw.startsWith("file://") ? fileURLToPath(raw) : raw;
};

/**
 * Recovers the absolute path an {@link AppModule} points at, by reading the
 * calling file's own source (not the runtime closure — see
 * {@link APP_FIELD_SPECIFIER}) and matching its `app: () => import("./App")`
 * field literally. Supports one `staticPage`/`dynamicPage` call per file.
 */
const resolveAppEntry = (): string => {
  const file = callerFile();
  const source = fs.readFileSync(file, "utf-8");
  const specifier = APP_FIELD_SPECIFIER.exec(source)?.[1];
  if (!specifier) {
    throw new Error(
      `page(): could not find \`app: () => import("./Path")\` with a literal string ` +
        `specifier in ${file}. Only one staticPage/dynamicPage call per file is supported.`
    );
  }
  return path.resolve(path.dirname(file), specifier);
};

/* -------------------------------------------------------------------------- */
/* the "exactly one App" guard                                                 */
/* -------------------------------------------------------------------------- */

// The document's only contract is "render the App prop somewhere inside
// <body>". Omitting it produces a page with no hydration root and no
// explanation why; rendering it twice produces a duplicate id that only the
// first copy of hydrates. Both are silent everywhere except here — count
// occurrences of the rendered marker and fail loudly if it isn't exactly one.
//
// This is a text-search heuristic, not a DOM-aware check: a false positive is
// possible if literal marker text appears elsewhere in rendered content (e.g.
// a code sample that displays `id="__page"` as text). That's rare enough to
// accept in exchange for catching the much more common mistake for free.
const countOccurrences = (haystack: string, needle: string): number =>
  needle === "" ? 0 : haystack.split(needle).length - 1;

const assertExactlyOne = (html: string, marker: string, what: string): void => {
  const count = countOccurrences(html, marker);
  if (count !== 1) {
    throw new Error(
      `page(): expected ${what} to appear exactly once in the rendered document, found ${count}. ` +
        "Render the App prop your document component receives exactly once."
    );
  }
};

const ROOT_MARKER = `id="${PAGE_ROOT_ID}"`;

/* -------------------------------------------------------------------------- */
/* shared render path                                                          */
/* -------------------------------------------------------------------------- */

const renderPage = async <Data extends JsonValue | undefined>(input: {
  appModule: AppModule<Data>;
  entryPath: string;
  document: DocumentComponent<Data>;
  bundler: PageDependencies["bundler"];
  data: Data;
}): Promise<string> => {
  const [{ renderToString }, React, { default: AppComponent }] = await Promise.all([
    import("react-dom/server"),
    import("react"),
    input.appModule()
  ]);

  const assets = input.bundler.resolveEntry(input.entryPath);

  const App: ComponentType = () =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "div",
        { id: PAGE_ROOT_ID },
        React.createElement(AppComponent as ComponentType<any>, input.data)
      ),
      ...assets.styles.map((href) => React.createElement("link", { key: href, rel: "stylesheet", href })),
      input.bundler.preambleScript
        ? React.createElement("script", {
            type: "module",
            dangerouslySetInnerHTML: { __html: input.bundler.preambleScript() }
          })
        : null,
      React.createElement(PageData, { data: input.data }),
      ...assets.scripts.map((src) => React.createElement("script", { key: src, type: "module", src }))
    ) as ReactElement;

  const documentEl = React.createElement(input.document, { App, data: input.data });
  const html = renderToString(documentEl);
  assertExactlyOne(html, ROOT_MARKER, `<App /> (element with ${ROOT_MARKER})`);

  return `<!DOCTYPE html>${html}`;
};

/* -------------------------------------------------------------------------- */
/* page constructors                                                           */
/* -------------------------------------------------------------------------- */

/** A page with no per-request work: rendered once, served as a file. */
export const staticPage = <Deps extends object = object>(spec: {
  app: AppModule<Record<string, never>>;
  document: DocumentComponent<Record<string, never>>;
}): StaticRequest<Deps & PageDependencies, string> => {
  const entryPath = resolveAppEntry();

  return staticRequest({
    extension: "html",
    fn: async (dependencies) => {
      const html = await renderPage({
        appModule: spec.app,
        entryPath,
        document: spec.document,
        bundler: dependencies.bundler,
        data: {} as Record<string, never>
      });
      return Buffer.from(html, "utf-8");
    }
  });
};

/* -------------------------------------------------------------------------- */
/* streaming pages                                                             */
/* -------------------------------------------------------------------------- */

/** An {@link AppModule} whose default export takes {@link StreamingPageProps}. */
export type StreamingAppModule<Data extends JsonValue | undefined, Chunk extends JsonValue> = () => Promise<{
  default: ComponentType<StreamingPageProps<Data, Chunk>>;
}>;

/**
 * A page whose document is flushed immediately, then extended with `<script>`
 * tags — one per `stream` emission — until the source Observable completes.
 *
 * The mechanism, end to end:
 *
 *  1. `loader` resolves. Everything below is blocked on it, so keep it cheap.
 *  2. `document` is rendered to a string with `renderToString`. The stream has
 *     not started, so this is the component at its pre-stream state.
 *  3. That string is split on `PAGE_STREAM_ANCHOR`. The part up to and
 *     including the anchor — doctype, head, hydration root, serialized data,
 *     stream bootstrap, entry script — is written and flushed. The browser
 *     paints it and starts fetching the client bundle while the response
 *     stays open.
 *  4. Each `stream` emission is written as a plain inline `<script>` that
 *     calls the bootstrap's push. Inline non-module scripts execute during
 *     parse, so each chunk lands the instant its bytes arrive.
 *  5. On complete, the tail (`</body></html>`) is written and the response
 *     ends, which completes the client's Observable too.
 *
 * Chunks that arrive before hydration are buffered by the bootstrap and
 * replayed, so nothing is lost in the window between first paint and
 * `hydrateStreamingPage`.
 *
 * The preamble and entry script are combined into one plain classic (not
 * `type="module"`) inline script here, unlike the other page constructors —
 * a few constraints collide otherwise. A deferred `type="module"` entry
 * script waits for parsing to finish before it runs; on a streaming response
 * that's the *end of the stream*, so hydration would land after the last
 * chunk. Marking it `async` fixes that timing, but React's built-in resource
 * hoisting moves any `<script async src>` to `<head>` — ahead of the
 * preamble, which then hasn't installed its hooks (e.g. react-refresh's) by
 * the time the entry evaluates. Splitting the preamble into its own earlier
 * classic script doesn't fix that either: two independent scripts each
 * kicking off their own async work (`import()`) race each other, with
 * nothing making the second wait for the first's promise to settle. The one
 * combination that actually orders correctly is a single classic script
 * whose body is one `async` IIFE — classic scripts execute the instant
 * they're parsed (same as the bootstrap and chunk scripts), and every step
 * inside the IIFE (preamble statements, then one `import()` per asset) is
 * `await`ed in turn, so nothing later starts before the thing before it
 * actually finished.
 *
 * `<App />` and the stream anchor must each render exactly once inside
 * `document` — enforced the same way as the other constructors' `<App />`
 * requirement (see the module-level guard).
 */
export const dynamicStreamingPage = <
  Params = Record<string, string>,
  Data extends JsonValue | undefined = undefined,
  Chunk extends JsonValue = JsonValue,
  Deps extends object = object
>(spec: {
  /** Resolved before the shell is flushed. Serialized for hydration, as in {@link dynamicPage}. */
  loader?: (input: {
    params: Params;
    dependencies: Deps & PageDependencies;
  }) => Promise<Data>;
  /**
   * Emissions become `<script>` chunks appended after the shell. Completion
   * ends the response; an error ends it too, after the client's Observable is
   * signalled.
   */
  stream: (input: {
    params: Params;
    dependencies: Deps & PageDependencies;
    data: Data;
  }) => Observable<Chunk>;
  app: StreamingAppModule<Data, Chunk>;
  document: DocumentComponent<Data>;
}): DynamicStreamingRequest<Params, Deps & PageDependencies> => {
  const entryPath = resolveAppEntry();

  return dynamicStreamingRequest({
    fn: async ({ params, dependencies }) => {
      const data = spec.loader ? await spec.loader({ params, dependencies }) : (undefined as Data);

      const [{ renderToString }, React, { default: AppComponent }] = await Promise.all([
        import("react-dom/server"),
        import("react"),
        spec.app()
      ]);

      const assets = dependencies.bundler.resolveEntry(entryPath);

      // One classic script, one async IIFE: the preamble's statements (if
      // any — e.g. installing react-refresh's hooks) run to completion
      // before any asset is imported, and each asset import completes before
      // the next starts. All of that has to be *one* sequential chain, not
      // separate script tags each firing its own async work — two adjacent
      // scripts each kicking off a promise race against each other, with no
      // way for the second to know the first's async work already finished.
      const entryScript = `(async()=>{${
        dependencies.bundler.preambleScript ? `${dependencies.bundler.preambleScript()}\n` : ""
      }${assets.scripts.map((src) => `await import(${JSON.stringify(src)});`).join("")}})();`;

      // Same shell shape renderPage builds, plus the stream bootstrap/anchor
      // pair; see the doc comment above for why the preamble and entry are
      // combined into one classic script here instead of the `type="module"`
      // tags the other constructors use, and why that combined script sits
      // between PageStreamBootstrap and PageStreamAnchor rather than after
      // both: the anchor is where the shell/tail split happens, so anything
      // meant to run immediately — bootstrap and entry alike — has to be
      // before it, or it ends up in the tail, sent only once the stream (and
      // hydration along with it) has already finished.
      const App: ComponentType = () =>
        React.createElement(
          React.Fragment,
          null,
          React.createElement(
            "div",
            { id: PAGE_ROOT_ID },
            // NEVER: no chunk ever emits during SSR (renderToString is
            // synchronous, and the stream doesn't start until after this
            // renders) — this is purely a type-satisfying placeholder for
            // the App's pre-stream render.
            React.createElement(AppComponent as ComponentType<any>, { data, stream: NEVER })
          ),
          ...assets.styles.map((href) => React.createElement("link", { key: href, rel: "stylesheet", href })),
          React.createElement(PageData, { data }),
          React.createElement(PageStreamBootstrap, null),
          React.createElement("script", { dangerouslySetInnerHTML: { __html: entryScript } }),
          React.createElement(PageStreamAnchor, null)
        ) as ReactElement;

      const documentEl = React.createElement(spec.document, { App, data });
      const html = renderToString(documentEl);
      assertExactlyOne(html, ROOT_MARKER, `<App /> (element with ${ROOT_MARKER})`);

      const anchorMarkup = renderToString(React.createElement("template", { id: PAGE_STREAM_ANCHOR_ID }));
      assertExactlyOne(html, anchorMarkup, "<PageStreamAnchor />");

      const anchorEnd = html.indexOf(anchorMarkup) + anchorMarkup.length;
      const shell = `<!DOCTYPE html>${html.slice(0, anchorEnd)}`;
      const tail = html.slice(anchorEnd);

      const body = new PassThrough();
      body.write(shell);

      const subscription = spec.stream({ params, dependencies, data }).subscribe({
        next: (chunk) => {
          body.write(pageStreamChunkScript(chunk));
        },
        error: (err: unknown) => {
          body.write(pageStreamErrorScript(err instanceof Error ? err.message : String(err)));
          body.write(tail);
          body.end();
        },
        complete: () => {
          body.write(pageStreamCompleteScript());
          body.write(tail);
          body.end();
        }
      });

      // Tied to `body`'s own lifecycle, not Express's `res` — the streaming
      // request handler destroys `body` when the client disconnects, which
      // fires this and stops whatever the source Observable was holding open
      // (an interval, a cursor, an upstream connection).
      body.on("close", () => {
        subscription.unsubscribe();
      });

      return {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body
      };
    }
  });
};

/**
 * A page rendered per request. `loader`'s result is passed as props to the app
 * component, handed to `document`, and serialized into the document so the
 * client hydrates without a second fetch.
 */
export const dynamicPage = <
  Params = Record<string, string>,
  Data extends JsonValue | undefined = undefined,
  Deps extends object = object
>(spec: {
  loader?: (input: { params: Params; dependencies: Deps & PageDependencies }) => Promise<Data>;
  app: AppModule<Data>;
  document: DocumentComponent<Data>;
}): DynamicRequest<Params, unknown, string, Deps & PageDependencies> => {
  const entryPath = resolveAppEntry();

  return dynamicRequest({
    fn: async ({ params, dependencies }) => {
      const data = spec.loader
        ? await spec.loader({ params, dependencies })
        : (undefined as Data);

      const html = await renderPage({
        appModule: spec.app,
        entryPath,
        document: spec.document,
        bundler: dependencies.bundler,
        data
      });

      return { body: html, headers: { "Content-Type": "text/html; charset=utf-8" } };
    }
  });
};
