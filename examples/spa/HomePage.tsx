import type { PushRouteProps } from "@boilerplate-utils/react";
import type { Route } from "./routes";

export const HomePage = ({ pushRoute }: PushRouteProps<Route>) => (
  <div>
    <h1>Home</h1>
    <button onClick={() => pushRoute({ path: "about" })}>About</button>
    <button onClick={() => pushRoute({ path: "user/[userId]", params: { userId: "42" } })}>
      User 42
    </button>
  </div>
);
