import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("app");
if (!container) throw new Error("#app element not found");
const root = createRoot(container);
root.render(
  App({ initialPath: window.location.pathname + window.location.search })
);
