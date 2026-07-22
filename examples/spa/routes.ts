import { pathCodec } from "@boilerplate-utils/shared";

export const { parse, format } = pathCodec(
  "home",
  "about",
  "signup",
  "user/[userId]"
);

export type Route = Parameters<typeof format>[0];
