import type { RequestHandler } from "express";
export interface MethodHandlers<T = Record<string | number, string>> {
  GET?: RequestHandler<T>;
  POST?: RequestHandler<T>;
  PUT?: RequestHandler<T>;
  DELETE?: RequestHandler<T>;
  PATCH?: RequestHandler<T>;
  HEAD?: RequestHandler<T>;
  OPTIONS?: RequestHandler<T>;
  CONNECT?: RequestHandler<T>;
  TRACE?: RequestHandler<T>;
}

export const requestHandlerForRoutes = <ParseFn extends (...args: any) => any>(
  parseFn: ParseFn,
  routes: {
    [
      K in ReturnType<ParseFn>["path"] as K extends "NotFound" ? never : K
    ]: Extract<ReturnType<ParseFn>, { path: K }> extends { params: unknown }
      ? MethodHandlers<
          Extract<ReturnType<ParseFn>, { params: unknown }>["params"]
        >
      : MethodHandlers;
  }
): RequestHandler => {
  const routeHandlers = routes as unknown as Record<
    string,
    MethodHandlers | undefined
  >;

  return (req, res, next) => {
    const parsed = parseFn(req.originalUrl ?? req.url);

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
    if (!handler) {
      next();
      return;
    }

    if ("params" in parsed) {
      req.params = parsed.params as typeof req.params;
    }

    handler(req, res, next);
  };
};
