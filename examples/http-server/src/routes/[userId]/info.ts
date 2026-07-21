import { dynamicRequest } from "@boilerplate-utils/server";

export const GET = dynamicRequest({
  fn: ({ params }: { params: { userId: string } }) => {
    return { body: `user with id: ${params.userId}` };
  }
});
