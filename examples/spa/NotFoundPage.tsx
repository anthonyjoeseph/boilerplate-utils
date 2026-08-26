import type { PushRouteProps } from "./routes";

export const NotFoundPage = ({ pushRoute }: PushRouteProps) => (
  <div>
    <h1>Not found</h1>
    <button onClick={() => pushRoute({ path: "home" })}>Home</button>
  </div>
);
