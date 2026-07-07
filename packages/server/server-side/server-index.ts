import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { App } from "../apps/App";

// INCREDIBLE tutorial
// https://a5h.dev/post/build-your-own-ssr-react-app/

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.get("/", async (_req, res) => {
  const external = await fetch("https://jsonplaceholder.typicode.com/todos/1").then((response) => response.json());
  const html = `<html>
    <div id="app">${renderToString(App())}</div>
    <script>window.SERVER_SIDE_DATA = ${JSON.stringify(external)};</script>
    <script src="client-index.js"></script>
</html>`;

  res.send(html);
});

app.use(express.static(path.join(process.cwd(), "dist-ssr")));

const SERVER_PORT = 1234;
app.listen(SERVER_PORT, () => console.log(`Server running on http://localhost:${SERVER_PORT}`));
