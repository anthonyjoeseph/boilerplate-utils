import { pathCodec } from "@boilerplate-utils/shared";
import {
  collectStaticAssets,
  generateStatic,
  requestHandlerForRoutes,
  clientForRoutes
} from "@boilerplate-utils/server";
import express from "express";
import * as R from "./routes";

const app = express();

const { parse } = pathCodec(...(Object.keys(R) as (keyof typeof R)[]));

const requestHandler = requestHandlerForRoutes(parse, R, {});

app.use(express.static(generateStatic(await collectStaticAssets(R, {}))));

app.use(requestHandler);

app.listen(3000);

const testClient = clientForRoutes("", R);

console.log(await testClient.page.GET());
