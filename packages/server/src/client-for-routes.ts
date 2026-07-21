import type { DynamicRequest, StaticRequest } from "./request.js";
import type { MethodHandlers } from "./request-handler.js";

// `unknown extends T` is only true when T is exactly `unknown`
type IsUnknown<T> = unknown extends T ? true : false;

type ClientFn<Params, ReqBody, ResBody> = IsUnknown<Params> extends true
  ? IsUnknown<ReqBody> extends true
    ? () => Promise<ResBody>
    : (body: ReqBody) => Promise<ResBody>
  : IsUnknown<ReqBody> extends true
    ? (params: Params) => Promise<ResBody>
    : (params: Params, body: ReqBody) => Promise<ResBody>;

type RouteClient<H extends MethodHandlers<any, any>> = {
  [M in keyof H as NonNullable<H[M]> extends DynamicRequest<any, any, any> | StaticRequest
    ? M
    : never]: NonNullable<H[M]> extends DynamicRequest<infer Params, infer ReqBody, infer ResBody>
    ? ClientFn<Params, ReqBody, ResBody>
    : NonNullable<H[M]> extends StaticRequest<any, infer ClientResponse>
      ? () => Promise<ClientResponse>
      : never;
};

export type ClientForRoutes<Routes extends Record<string, MethodHandlers<any, any>>> = {
  [K in keyof Routes & string]: RouteClient<Routes[K]>;
};

function buildUrl(
  baseUrl: string,
  routeKey: string,
  params?: Record<string, string>
): string {
  let url = `${baseUrl}/${routeKey}`;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`[${key}]`, encodeURIComponent(value));
    }
  }
  return url;
}

const HAS_PARAMS = /\[.+?\]/;

export const clientForRoutes = <Routes extends Record<string, MethodHandlers<any, any>>>(
  baseUrl: string,
  routes: Routes
): ClientForRoutes<Routes> => {
  const client: Record<string, Record<string, (...args: any[]) => Promise<unknown>>> = {};

  for (const [routeKey, handlers] of Object.entries(routes)) {
    client[routeKey] = {};

    for (const [method, handler] of Object.entries(handlers)) {
      if (!handler) continue;

      if (handler.type === "static-request") {
        const url = buildUrl(baseUrl, routeKey);
        const { parseResponseBody } = handler;
        client[routeKey][method] = () =>
          fetch(url, { method })
            .then(r => r.arrayBuffer())
            .then(buf => parseResponseBody ? parseResponseBody.parse(buf) : buf);
        continue;
      }

      const hasParams = HAS_PARAMS.test(routeKey);

      client[routeKey][method] = async (...args: unknown[]) => {
        let params: Record<string, string> | undefined;
        let body: unknown;

        if (hasParams) {
          params = args[0] as Record<string, string>;
          body = args[1];
        } else {
          body = args[0];
        }

        const url = buildUrl(baseUrl, routeKey, params);

        const response = await fetch(url, {
          method,
          ...(body !== undefined && {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        });

        const contentType = response.headers.get("content-type") ?? "";
        return contentType.includes("application/json")
          ? response.json()
          : response.text();
      };
    }
  }

  return client as ClientForRoutes<Routes>;
};
