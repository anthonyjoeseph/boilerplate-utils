import type { RequestHandler } from "express";
import type { RequestObj } from "./request.js";
export interface MethodHandlers<T = Record<string | number, string>, Dependencies = unknown> {
  GET?: RequestObj<T, any, any, Dependencies, any>;
  POST?: RequestObj<T, any, any, Dependencies, any>;
  PUT?: RequestObj<T, any, any, Dependencies, any>;
  DELETE?: RequestObj<T, any, any, Dependencies, any>;
  PATCH?: RequestObj<T, any, any, Dependencies, any>;
  HEAD?: RequestObj<T, any, any, Dependencies, any>;
  OPTIONS?: RequestObj<T, any, any, Dependencies, any>;
  CONNECT?: RequestObj<T, any, any, Dependencies, any>;
  TRACE?: RequestObj<T, any, any, Dependencies, any>;
}

export const requestHandlerForRoutes = <ParseFn extends (...args: any) => any, Dependencies>(
  parseFn: ParseFn,
  routes: {
    [
      K in ReturnType<ParseFn>["path"] as K extends "NotFound" ? never : K
    ]: Extract<ReturnType<ParseFn>, { path: K }> extends { params: unknown }
      ? MethodHandlers<
          Extract<ReturnType<ParseFn>, { params: unknown }>["params"],
          Dependencies
        >
      : MethodHandlers<Record<string | number, string>, Dependencies>;
  },
  dependencies: Dependencies
): RequestHandler => {
  const routeHandlers = routes as unknown as Record<
    string,
    MethodHandlers | undefined
  >;

  return (req, res, next) => {
    const parsed = parseFn(req.originalUrl);

    if (parsed.path === "NotFound") {
      next();
      return;
    }

    const handlers = routeHandlers[parsed.path];
    if (!handlers) {
      next();
      return;
    }

    const method = req.method.toUpperCase() as keyof MethodHandlers;
    const handler = handlers[method];
    if (handler?.type !== "dynamic-request") {
      next();
      return;
    }

    const params = "params" in parsed ? parsed.params : {};

    let requestBody: unknown = req.body;
    if (handler.parseRequestBody) {
      const result = handler.parseRequestBody.safeParse(requestBody);
      if (!result.success) {
        res.status(400).json({ error: result.error.issues });
        return;
      }
      requestBody = result.data;
    }

    void (async () => {
      const { statusCode = 200, statusMessage, headers, body } = await handler.fn(
        { params, dependencies },
        requestBody
      );

      res.status(statusCode);
      if (statusMessage) res.statusMessage = statusMessage;
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          res.setHeader(key, value);
        }
      }
      res.send(body);
    })().catch(next);
  };
};
