import type { ComponentType, ReactElement } from "react";
import { Subject } from "rxjs";
import type { Observable } from "rxjs";
import { PAGE_ROOT_ID, readPageData } from "./hydration.js";
import type { JsonValue } from "./json.js";

/* -------------------------------------------------------------------------- */
/* the shape a streaming page's App sees                                       */
/* -------------------------------------------------------------------------- */

/**
 * Props the App component of a `dynamicStreamingPage` receives.
 *
 * Note this differs from `dynamicPage`, where the loader's `Data` *is* the
 * props object. Here it's nested under `data` so `stream` has somewhere to
 * live that can't collide with a loader field.
 */
export interface StreamingPageProps<Data extends JsonValue | undefined, Chunk extends JsonValue> {
  /**
   * The loader's result. Resolved before the shell is flushed, so it is
   * server-rendered and serialized into the document exactly like
   * `dynamicPage`'s data — identical on both sides of hydration.
   */
  data: Data;
  /**
   * Chunks pushed by the streamed `<script>` tags, in arrival order.
   *
   * Never emits during SSR — `renderToString` is synchronous and the stream
   * has not started — so the server-rendered shell is always the component at
   * its pre-stream state. Everything after that is the client's job.
   *
   * This is the raw arrival stream, not an accumulation: a component that
   * wants a growing list should `scan` it itself.
   */
  stream: Observable<Chunk>;
}

/* -------------------------------------------------------------------------- */
/* the server/client contract                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `window` key holding the pre-hydration buffer and push function. Never
 * spelled out in user code — {@link PageStreamBootstrap} writes it and
 * {@link readPageStream} reads it, which is what keeps the two ends from
 * drifting (same rationale as `PAGE_ROOT_ID`).
 */
export const PAGE_STREAM_GLOBAL = "__pageStream";

/**
 * Id of the `<template>` marker {@link PageStreamAnchor} renders. The server
 * derives the exact markup for this element via `renderToString` on its own
 * side (see `dynamicStreamingPage` in `@boilerplate-utils/server`) and splits
 * the document on it — so this id is the only thing that has to stay in sync
 * between the two; the markup itself is never hand-duplicated.
 */
export const PAGE_STREAM_ANCHOR_ID = "__pageStreamAnchor";

interface PageStreamState<Chunk> {
  buffer: Chunk[];
  done: boolean;
  err: string | undefined;
  push: (chunk: Chunk) => void;
  complete: () => void;
  error: (message: string) => void;
}

// Plain classic (non-module) script: it must run the instant it's parsed —
// before parsing has finished, which on a streaming response is also before
// the client bundle has loaded. No user data is interpolated, so nothing here
// needs escaping.
const BOOTSTRAP_SCRIPT = `(function(){var k=${JSON.stringify(
  PAGE_STREAM_GLOBAL
)};var s=window[k]=window[k]||{};s.buffer=[];s.done=false;s.err=undefined;s.push=function(c){s.buffer.push(c)};s.complete=function(){s.done=true};s.error=function(e){s.err=e;s.done=true}})();`;

/**
 * Renders the inline bootstrap script that installs `window.__pageStream`.
 * Render this before anything that depends on it having run — the entry
 * script included, since hydration reads this global.
 *
 * Split from {@link PageStreamAnchor} (rather than one combined component)
 * because the entry script has to sit between the two: after the bootstrap
 * has installed the global, but before the anchor, so it's still part of the
 * flushed shell rather than the tail written once the stream completes.
 */
export const PageStreamBootstrap = (): ReactElement => (
  <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP_SCRIPT }} />
);

/**
 * Renders the {@link PAGE_STREAM_ANCHOR_ID} marker `dynamicStreamingPage`
 * splits the document on. Everything up to and including this element is the
 * shell (flushed immediately); everything after is the tail (written once
 * the stream completes). Push scripts are written into the gap between the
 * two — so render this last, as the last thing in your App's server output.
 */
export const PageStreamAnchor = (): ReactElement => <template id={PAGE_STREAM_ANCHOR_ID} />;

/**
 * Serializes one chunk into the `<script>` tag the server writes for it.
 * Paired with {@link PageStreamBootstrap} — the encoding and the reader live
 * together on purpose.
 *
 * Plain inline `<script>`, for the same reason the bootstrap is: it has to
 * execute the moment it is parsed, not after the document finishes.
 */
export const pageStreamChunkScript = (chunk: JsonValue): string =>
  // `<` must be escaped so a literal "</script>" in the chunk can't close the tag early.
  `<script>window[${JSON.stringify(PAGE_STREAM_GLOBAL)}].push(${JSON.stringify(chunk).replace(/</gu, "\\u003c")})</script>`;

/** Written once the source Observable completes, before the document tail. */
export const pageStreamCompleteScript = (): string =>
  `<script>window[${JSON.stringify(PAGE_STREAM_GLOBAL)}].complete()</script>`;

/** Written once the source Observable errors, before the document tail. */
export const pageStreamErrorScript = (message: string): string =>
  `<script>window[${JSON.stringify(PAGE_STREAM_GLOBAL)}].error(${JSON.stringify(message).replace(/</gu, "\\u003c")})</script>`;

/* -------------------------------------------------------------------------- */
/* client                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Client-side counterpart to {@link PageStreamBootstrap}. Drains whatever the
 * bootstrap buffered before hydration into a `Subject`, then hands the
 * bootstrap's `push`/`complete`/`error` over to that same Subject so chunks
 * arriving afterward feed it directly. Completes or errors immediately if the
 * server had already finished by the time this runs.
 */
export const readPageStream = <Chunk extends JsonValue>(): Observable<Chunk> => {
  const subject = new Subject<Chunk>();
  const globalWindow = window as unknown as Record<string, PageStreamState<Chunk> | undefined>;
  const state = globalWindow[PAGE_STREAM_GLOBAL];

  if (!state) {
    throw new Error(
      `readPageStream: no window.${PAGE_STREAM_GLOBAL} bootstrap found — did the document render <PageStreamBootstrap />?`
    );
  }

  for (const chunk of state.buffer) subject.next(chunk);

  if (state.done) {
    if (state.err !== undefined) subject.error(new Error(state.err));
    else subject.complete();
  } else {
    state.push = (chunk) => subject.next(chunk);
    state.complete = () => subject.complete();
    state.error = (message) => subject.error(new Error(message));
  }

  return subject.asObservable();
};

/**
 * Streaming counterpart to `hydratePage` — the entire body of a streaming
 * page's client entry:
 *
 * ```ts
 * import { hydrateStreamingPage } from "@boilerplate-utils/react";
 * hydrateStreamingPage(() => import("./App"));
 * ```
 *
 * Reads the serialized loader data and the buffered stream, and hydrates the
 * module's default export with both as {@link StreamingPageProps}.
 */
export const hydrateStreamingPage = async <
  Data extends JsonValue | undefined,
  Chunk extends JsonValue
>(
  loadApp: () => Promise<{ default: ComponentType<StreamingPageProps<Data, Chunk>> }>
): Promise<void> => {
  const [{ hydrateRoot }, React, { default: App }] = await Promise.all([
    import("react-dom/client"),
    import("react"),
    loadApp()
  ]);

  const root = document.getElementById(PAGE_ROOT_ID);
  if (!root) {
    throw new Error(`hydrateStreamingPage: no element with id="${PAGE_ROOT_ID}" found in the document`);
  }

  const data = readPageData<Data>();
  const stream = readPageStream<Chunk>();
  hydrateRoot(root, React.createElement(App, { data, stream }));
};
