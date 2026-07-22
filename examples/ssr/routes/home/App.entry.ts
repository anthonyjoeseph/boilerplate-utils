// Re-export the component so renderPage can import it on the server.
// Call hydratePage only in the browser — `document` is undefined in Node.
export { default } from "./App.tsx";
import { hydratePage } from "@boilerplate-utils/react";
if (typeof document !== "undefined") {
  void hydratePage(() => import("./App.tsx"));
}
