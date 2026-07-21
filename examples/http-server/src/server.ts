import { pathCodec } from "@boilerplate-utils/shared";
import express from "express";
import * as R from "./routes";

const app = express();

const { parse, format } = pathCodec(...(Object.keys(R) as (keyof typeof R)[]));

const f = parse("/ofiej/info");

for (const [key, value] of Object.entries(R)) {
  app.get(key, value.GET);
}

app.get("/health", (req, res) => {
  res.status(200);
  res.send("ok");
});

app.listen(3000);
