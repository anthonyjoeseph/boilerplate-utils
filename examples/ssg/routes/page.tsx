import { staticPage } from "@boilerplate-utils/server";

export const GET = staticPage({
  app: () => import("./App"),
  document: ({ App }) => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>SSG Example</title>
      </head>
      <body>
        <App />
      </body>
    </html>
  )
});
