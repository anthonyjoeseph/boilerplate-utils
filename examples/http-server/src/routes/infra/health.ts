import { dynamicRequest } from "@boilerplate-utils/server";

export const GET = dynamicRequest({
  fn: () => {
    return { body: "ok" };
  }
});
