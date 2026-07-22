export { default } from "./App.tsx";
import { hydrateStreamingPage } from "@boilerplate-utils/react";
if (typeof document !== "undefined") {
  void hydrateStreamingPage(() => import("./App.tsx"));
}
