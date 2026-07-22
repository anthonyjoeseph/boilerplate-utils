import type { Readable } from "node:stream";
import type { z } from "zod";
export interface HttpResponse<Body> {
  /**
   * default 200
   */
  statusCode?: number;
  statusMessage?: string;

  /**
   * If you have multiple values with the same header name,
   * you must concatenate them with a separator -
   * usually with a comma ',' but sometimes (e.g. for cookies) with
   * a semicolon ';'. Duplicate keys are disallowed,
   * since a comma-separated list is always a legal alternative.
   * @link https://stackoverflow.com/a/3097052
   */
  headers?: Record<string, string>;
  body: Body;
}

export const httpResponse = <Body>(data: HttpResponse<Body>) => data;

export interface DynamicRequest<
  Params,
  RequestBody,
  ResponseBody,
  Dependencies = unknown
> {
  type: "dynamic-request";
  parseRequestBody?: z.ZodType<RequestBody>;
  parseResponseBody?: z.ZodType<ResponseBody>;
  fn: (
    input: {
      params: Params;
      dependencies: Dependencies;
    },
    requestBody: RequestBody
  ) => Promise<HttpResponse<ResponseBody>>;
}
export const dynamicRequest = <
  Params,
  RequestBody,
  ResponseBody,
  Dependencies = unknown
>(data: {
  parseRequestBody?: z.ZodType<RequestBody>;
  parseResponseBody?: z.ZodType<ResponseBody>;
  fn: (
    input: {
      params: Params;
      dependencies: Dependencies;
    },
    requestBody: RequestBody
  ) => Promise<HttpResponse<ResponseBody>>;
}): DynamicRequest<Params, RequestBody, ResponseBody, Dependencies> => ({
  type: "dynamic-request",
  ...data
});

export interface DynamicStreamingRequest<Params, Dependencies = unknown> {
  type: "dynamic-streaming-request";
  fn: (input: {
    params: Params;
    dependencies: Dependencies;
    requestStream: Readable;
  }) => Promise<HttpResponse<Readable>>;
}
export const dynamicStreamingRequest = <Params, Dependencies = unknown>(data: {
  fn: (input: {
    params: Params;
    dependencies: Dependencies;
    requestStream: Readable;
  }) => Promise<HttpResponse<Readable>>;
}): DynamicStreamingRequest<Params, Dependencies> => ({
  type: "dynamic-streaming-request",
  ...data
});

export interface StaticRequest<
  Dependencies = unknown,
  ClientResponse = ArrayBuffer
> {
  type: "static-request";
  extension: string;
  parseResponseBody?: z.ZodType<ClientResponse>;
  fn: (dependencies: Dependencies) => Promise<NodeJS.ArrayBufferView>;
}
export const staticRequest = <
  Dependencies = unknown,
  ClientResponse = ArrayBuffer
>(data: {
  extension: string;
  parseResponseBody?: z.ZodType<ClientResponse>;
  fn: (dependencies: Dependencies) => Promise<NodeJS.ArrayBufferView>;
}): StaticRequest<Dependencies, ClientResponse> => ({
  type: "static-request",
  ...data
});

export type RequestObj<
  Params,
  RequestBody,
  ResponseBody,
  Dependencies = unknown,
  ClientResponse = ArrayBuffer
> =
  | DynamicRequest<Params, RequestBody, ResponseBody, Dependencies>
  | DynamicStreamingRequest<Params, Dependencies>
  | StaticRequest<Dependencies, ClientResponse>;
