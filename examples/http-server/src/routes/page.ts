import type { StaticRequest } from "@boilerplate-utils/server";

export const GET: StaticRequest = {
  type: "static-request",
  extension: "html",
  fn: () => {
    return Buffer.from(`<html>hello page</html>`);
  }
};
