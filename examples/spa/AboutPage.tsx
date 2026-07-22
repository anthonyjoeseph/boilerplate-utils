import type { PushRouteProps } from "@boilerplate-utils/react";
import type { Route } from "./routes";

export const AboutPage = ({ pushRoute }: PushRouteProps<Route>) => (
  <div>
    <h1>About</h1>
    <button onClick={() => pushRoute({ path: "home" })}>Home</button>
  </div>
);
