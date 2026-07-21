import { pathCodec } from "@boilerplate-utils/shared";
import { requestHandlerForRoutes } from "@boilerplate-utils/server";
import express from "express";
import {} from "express";
import * as R from "./routes";

const app = express();

const { parse, format } = pathCodec(...(Object.keys(R) as (keyof typeof R)[]));

const requestHandler = requestHandlerForRoutes(parse, R);

app.use(requestHandler);

app.listen(3000);
