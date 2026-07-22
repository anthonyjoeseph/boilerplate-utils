export { default } from "./App.tsx";
import { hydratePage } from "@boilerplate-utils/react";
if (typeof document !== "undefined") {
  void hydratePage(() => import("./App.tsx"));
}
