import path from "node:path";
import express from "express";
import { pathCodec } from "@boilerplate-utils/shared";
import { serveBuiltRoutes } from "@boilerplate-utils/server/vite";
import * as R from "./routes/index.js";

const { parse } = pathCodec(...(Object.keys(R) as (keyof typeof R)[]));
const app = express();

// Manifest keys are written relative to the vite root (generated/), so
// sourceRoot must match what viteBuildInput used as its root.
app.use(
  serveBuiltRoutes({
    routes: R,
    parse,
    dependencies: {},
    outDir: path.resolve("dist"),
    sourceRoot: path.resolve("generated")
  })
);

app.get("/", (_req, res) => res.redirect("/home"));

app.listen(3000, () => console.log("http://localhost:3000"));
