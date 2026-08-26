import { AboutPage } from "./AboutPage";
import { HomePage } from "./HomePage";
import { NotFoundPage } from "./NotFoundPage";
import type { Route } from "./routes";
import { parse, format } from "./routes";
import { SignupPage } from "./SignupPage";
import { UserPage } from "./UserPage";
import { useCallback, useState } from "react";
import { match } from "ts-pattern";

export const App = () => {
  const [route, setRoute] = useState<Route>(() =>
    parse(window.location.pathname + window.location.search)
  );

  const pushRoute = useCallback(
    (next: Route) => {
      window.history.pushState(null, "", format(next));
      setRoute(next);
    },
    [format]
  );

  return match(route)
    .with({ path: "home" }, () => <HomePage pushRoute={pushRoute} />)
    .with({ path: "about" }, () => <AboutPage pushRoute={pushRoute} />)
    .with({ path: "signup" }, () => <SignupPage pushRoute={pushRoute} />)
    .with({ path: "user/[userId]" }, ({ params: { userId } }) => (
      <UserPage pushRoute={pushRoute} userId={userId} />
    ))
    .with({ path: "NotFound" }, () => <NotFoundPage pushRoute={pushRoute} />)
    .exhaustive();
};
