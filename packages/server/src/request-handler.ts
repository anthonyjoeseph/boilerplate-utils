import type { ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import type { RequestHandler } from "express";
import type {
  DynamicStreamingRequest,
  HttpResponse,
  RequestObj
} from "./request.js";
type AnyHandler<T, Dependencies> =
  | RequestObj<T, any, any, Dependencies, any>
  | DynamicStreamingRequest<T, Dependencies>;

/**
 * Wires a streaming `HttpResponse<Readable>` into a response. Typed against
 * plain `http.ServerResponse` (which Express's `Response` extends) rather
 * than Express specifically, so it works both from the production request
 * handler (Express) and from `vitePagesPlugin`'s dev middleware (connect,
 * which hands middleware the raw Node response) without the two ever able to
 * drift on close/flush/buffering behavior.
 */
export const pipeStreamingResponse = (
  res: ServerResponse,
  result: HttpResponse<Readable>
): void => {
  res.statusCode = result.statusCode ?? 200;
  if (result.statusMessage) res.statusMessage = result.statusMessage;
  // Ask any reverse proxy in front of this process (nginx, several CDNs) not
  // to buffer the response — buffering would hold every chunk until the
  // connection closes, defeating the whole point of streaming them. Set
  // first so handler-provided headers can override it.
  res.setHeader("X-Accel-Buffering", "no");
  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
  }

  result.body.pipe(res);

  // compression middleware buffers writes until flushed; force each chunk
  // out as it arrives. `res.flush` only exists when such middleware is
  // installed, hence the optional call.
  result.body.on("data", () => {
    (res as unknown as { flush?: () => void }).flush?.();
  });

  // The client disconnecting doesn't automatically stop `body` (pipe() does
  // not propagate destination closure back to the source) — tie its lifetime
  // to `res`'s explicitly, so the handler's own `body.on("close", ...)`
  // cleanup (unsubscribing an rxjs source, say) fires.
  res.on("close", () => {
    result.body.destroy();
  });
};

export interface MethodHandlers<
  T = Record<string | number, string>,
  Dependencies = unknown
> {
  GET?: AnyHandler<T, Dependencies>;
  POST?: AnyHandler<T, Dependencies>;
  PUT?: AnyHandler<T, Dependencies>;
  DELETE?: AnyHandler<T, Dependencies>;
  PATCH?: AnyHandler<T, Dependencies>;
  HEAD?: AnyHandler<T, Dependencies>;
  OPTIONS?: AnyHandler<T, Dependencies>;
  CONNECT?: AnyHandler<T, Dependencies>;
  TRACE?: AnyHandler<T, Dependencies>;
}

export const requestHandlerForRoutes = <
  ParseFn extends (...args: any) => any,
  Dependencies
>(
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

    const params = "params" in parsed ? parsed.params : {};
    const method = req.method.toUpperCase() as keyof MethodHandlers;
    const handler = handlers[method];

    if (handler?.type === "dynamic-streaming-request") {
      void (async () => {
        const result = await handler.fn({
          params,
          dependencies,
          requestStream: req
        });
        pipeStreamingResponse(res, result);
      })().catch(next);
      return;
    }

    if (handler?.type !== "dynamic-request") {
      next();
      return;
    }

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
      const {
        statusCode = 200,
        statusMessage,
        headers,
        body
      } = await handler.fn({ params, dependencies }, requestBody);

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
