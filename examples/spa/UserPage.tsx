import type { PushRouteProps } from "@boilerplate-utils/react";
import type { Route } from "./routes";

export const UserPage = ({
  params,
  pushRoute
}: { params: { userId: string } } & PushRouteProps<Route>) => (
  <div>
    <h1>User {params.userId}</h1>
    <button onClick={() => pushRoute({ path: "home" })}>Home</button>
  </div>
);
