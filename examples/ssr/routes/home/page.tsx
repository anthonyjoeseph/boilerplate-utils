import { staticPage } from "@boilerplate-utils/server";

export const GET = staticPage({
  app: () => import("./App.entry.ts"),
  document: ({ App }) => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>SSR Example</title>
      </head>
      <body>
        <App />
      </body>
    </html>
  )
});
