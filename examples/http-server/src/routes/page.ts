import type { StaticRequest } from "@boilerplate-utils/server";

export const GET: StaticRequest = {
  type: "static-request",
  extension: "html",
  fn: () => {
    return Promise.resolve(Buffer.from(`<html>hello page</html>`));
  }
};
