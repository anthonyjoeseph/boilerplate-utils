import type { ComponentType, ReactElement } from "react";
import { useCallback, useState } from "react";

export interface PushRouteProps<Path> {
  /** Re-routes the app to `next`, updating both the URL bar and the rendered child. */
  pushRoute: (next: Path) => void;
}

export type RouteComponent<Match, Path> = ComponentType<
  Match & PushRouteProps<Path>
>;

export interface ClientRouterProps<Path extends { path: string }> {
  /** Turns a URL (pathname + search) into the route ADT. The `parse` half of a `pathCodec(...)`. */
  parse: (url: string) => Path;
  /** Turns a route ADT back into a URL. The `format` half of a `pathCodec(...)`. */
  format: (struct: Path) => string;
  /** One component per route, keyed by its `path` discriminant. Each receives its own matched
   * variant's fields (`params`/`tail`, if any) plus `pushRoute`. */
  routes: {
    [K in Path["path"]]: RouteComponent<Extract<Path, { path: K }>, Path>;
  };
  /**
   * The URL to render on mount. `ClientRouter` never reads `window.location` itself — pass
   * `window.location.pathname + window.location.search` (or whatever the host environment
   * considers "current") from the caller.
   */
  initialPath: string;
}

/**
 * Client-only router: holds the current route ADT (produced by `parse`) in state and re-renders
 * whichever `routes` entry matches it. Navigation only ever happens through `pushRoute` — passed
 * to every routed component — which re-formats the route back into a URL, updates the address bar
 * via `history.pushState`, and re-renders.
 */
export function ClientRouter<Path extends { path: string }>({
  parse,
  format,
  routes,
  initialPath
}: ClientRouterProps<Path>): ReactElement {
  const [route, setRoute] = useState<Path>(() => parse(initialPath));

  const pushRoute = useCallback(
    (next: Path) => {
      window.history.pushState(null, "", format(next));
      setRoute(next);
    },
    [format]
  );

  const Component = routes[route.path as Path["path"]] as ComponentType<
    Path & PushRouteProps<Path>
  >;
  return <Component {...route} pushRoute={pushRoute} />;
}
