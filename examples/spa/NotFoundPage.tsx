import type { PushRouteProps } from "@boilerplate-utils/react";
import type { Route } from "./routes";

export const NotFoundPage = ({ pushRoute }: PushRouteProps<Route>) => (
  <div>
    <h1>Not found</h1>
    <button onClick={() => pushRoute({ path: "home" })}>Home</button>
  </div>
);
