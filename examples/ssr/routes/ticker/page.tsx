import { interval, map, take } from "rxjs";
import { dynamicStreamingPage } from "@boilerplate-utils/server";
import type { Chunk, Data } from "./App.tsx";

export const GET = dynamicStreamingPage<Record<string, string>, Data, Chunk>({
  loader: () => Promise.resolve({ startedAt: Date.now() }),
  stream: () =>
    interval(1000).pipe(
      take(10),
      map((i) => ({ count: i + 1, at: Date.now() }))
    ),
  app: () => import("./App.entry.ts"),
  document: ({ App, data }) => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        {/* React's built-in <title> hoisting only handles a single text
            child — a literal + expression as separate children silently
            renders empty, so interpolate into one string. */}
        <title>{`Streaming Ticker — started ${new Date(data.startedAt).toLocaleTimeString()}`}</title>
      </head>
      <body>
        <App />
      </body>
    </html>
  )
});
