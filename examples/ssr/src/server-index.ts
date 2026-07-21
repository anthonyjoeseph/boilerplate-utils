import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env["NODE_ENV"] === "production";
const PORT = Number(process.env["PORT"]) || 5174;

// The standalone `vite` dev server (`pnpm dev:client`), which serves
// entry-client.tsx and its dependency graph with HMR. This process never
// talks to it beyond referencing its origin in dev-only <script> tags.
const CLIENT_ORIGIN = "http://localhost:5173";

type Render = (url: string) => Promise<{ html: string; data: unknown }>;

const app = express();

if (isProduction) {
  app.use(
    express.static(path.join(__dirname, "dist/client"), { index: false })
  );
}

// Vite's React Fast Refresh preamble. Vite normally injects this itself
// when it serves index.html directly; since our dev asset server runs on a
// separate origin from this Express process, we inject it by hand instead.
const reactRefreshPreamble = `<script type="module">
      import { injectIntoGlobalHook } from "${CLIENT_ORIGIN}/@react-refresh";
      injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
    </script>
    <script type="module" src="${CLIENT_ORIGIN}/@vite/client"></script>`;

const handleRequest = async (req: express.Request, res: express.Response) => {
  const url = req.originalUrl;

  try {
    let template: string;
    let render: Render;

    if (isProduction) {
      template = await fs.readFile(
        path.join(__dirname, "dist/client/index.html"),
        "utf-8"
      );
      const prodEntryPath = path.join(__dirname, "dist/server/entry-server.js");
      ({ render } = (await import(prodEntryPath)) as { render: Render });
    } else {
      template = await fs.readFile(path.join(__dirname, "index.html"), "utf-8");
      template = template
        .replace("<!--dev-scripts-->", reactRefreshPreamble)
        .replace(
          'src="/entry-client.tsx"',
          `src="${CLIENT_ORIGIN}/entry-client.tsx"`
        );
      ({ render } = (await import("./entry-server")) as { render: Render });
    }

    const { html: appHtml, data } = await render(url);

    const html = template
      .replace("<!--app-html-->", appHtml)
      .replace(
        "<!--app-data-->",
        `<script>window.SERVER_SIDE_DATA = ${JSON.stringify(data)};</script>`
      );

    res.status(200).set({ "Content-Type": "text/html" }).send(html);
  } catch (error) {
    const err = error as Error;
    console.error(err);
    res.status(500).end(err.stack);
  }
};

app.use("*", (req, res) => {
  void handleRequest(req, res);
});

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
