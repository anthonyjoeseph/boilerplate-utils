import type { PushRouteProps } from "./routes";

export const UserPage = ({
  userId,
  pushRoute
}: { userId: string } & PushRouteProps) => (
  <div>
    <h1>User {userId}</h1>
    <button onClick={() => pushRoute({ path: "home" })}>Home</button>
  </div>
);
