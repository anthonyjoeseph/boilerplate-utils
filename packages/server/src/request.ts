import type { z } from "zod";

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
  ) => ResponseBody;
}

export interface StaticRequest<Dependencies = unknown> {
  type: "static-request";
  fn: (dependencies: Dependencies) => NodeJS.ArrayBufferView;
}

export type RequestObj<
  Params,
  RequestBody,
  ResponseBody,
  Dependencies = unknown
> =
  | DynamicRequest<Params, RequestBody, ResponseBody, Dependencies>
  | StaticRequest<Dependencies>;
