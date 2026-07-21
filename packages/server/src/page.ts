import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ComponentType, ReactElement } from "react";
import { PAGE_ROOT_ID, PageData } from "@boilerplate-utils/react";
import type { PageDependencies } from "./bundler.js";
import { dynamicRequest, staticRequest } from "./request.js";
import type { DynamicRequest, StaticRequest } from "./request.js";

/* -------------------------------------------------------------------------- */
/* the App boundary                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A module whose default export is the component mounted into the hydration
 * root, on both server and client.
 *
 * Written as `() => import("./App")` so TypeScript checks the path exists and
 * autocompletes it. At the `staticPage`/`dynamicPage` call site the function is
 * inspected (see {@link resolveAppEntry}) to recover that literal specifier and
 * resolve it to a real file — that file becomes the client bundle's entry, and
 * *only* that file: a loader can import `pg` freely because nothing about the
 * route module itself is reachable from the client build.
 */
export type AppModule<Props> = () => Promise<{ default: ComponentType<Props> }>;

/**
 * The server-only half of a page: renders the whole document and is never sent
 * to the browser. `App` is supplied by the library, not written by the
 * caller — it already is the hydration root, the serialized loader data, and
 * the client entry's script tag. The document's only job is to render it
 * somewhere inside `<body>`.
 */
export type DocumentComponent<Data = undefined> = ComponentType<{
  App: ComponentType;
  data: Data;
}>;

/* -------------------------------------------------------------------------- */
/* resolving `() => import("./X")` back to a file                              */
/* -------------------------------------------------------------------------- */

const IMPORT_SPECIFIER = /import\(\s*["'`]([^"'`]+)["'`]\s*\)/u;

/**
 * Finds the file that called `staticPage`/`dynamicPage`, by parsing a captured
 * stack trace. Works in Node/tsx/vite-node, which all preserve real file paths
 * in stack frames; it is not expected to survive a minified/bundled build,
 * which is fine — `staticPage`/`dynamicPage` only ever run in those
 * unminified contexts (`generate`, dev SSR, prod SSR reading pre-rendered
 * source), never inside the client bundle itself.
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
 * Recovers the absolute path an {@link AppModule} points at, by stringifying
 * the function and regex-matching its import specifier — `() => import("./App")`
 * stringifies to exactly that in V8, so no AST parsing is needed.
 */
const resolveAppEntry = (appModule: AppModule<any>): string => {
  const source = appModule.toString();
  const specifier = source.match(IMPORT_SPECIFIER)?.[1];
  if (!specifier) {
    throw new Error(
      `page(): \`app\` must be written as \`() => import("./Path")\` with a literal ` +
        `string specifier so it can be resolved statically. Got: ${source}`
    );
  }
  return path.resolve(path.dirname(callerFile()), specifier);
};

/* -------------------------------------------------------------------------- */
/* shared render path                                                          */
/* -------------------------------------------------------------------------- */

const renderPage = async <Data,>(input: {
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
  return `<!DOCTYPE html>${renderToString(documentEl)}`;
};

/* -------------------------------------------------------------------------- */
/* page constructors                                                           */
/* -------------------------------------------------------------------------- */

/** A page with no per-request work: rendered once, served as a file. */
export const staticPage = <Deps extends object = object>(spec: {
  app: AppModule<Record<string, never>>;
  document: DocumentComponent<Record<string, never>>;
}): StaticRequest<Deps & PageDependencies, string> => {
  const entryPath = resolveAppEntry(spec.app);

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

/**
 * A page rendered per request. `loader`'s result is passed as props to the app
 * component, handed to `document`, and serialized into the document so the
 * client hydrates without a second fetch.
 */
export const dynamicPage = <
  Params = Record<string, string>,
  Data = undefined,
  Deps extends object = object
>(spec: {
  loader?: (input: { params: Params; dependencies: Deps & PageDependencies }) => Promise<Data>;
  app: AppModule<Data>;
  document: DocumentComponent<Data>;
}): DynamicRequest<Params, unknown, string, Deps & PageDependencies> => {
  const entryPath = resolveAppEntry(spec.app);

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
