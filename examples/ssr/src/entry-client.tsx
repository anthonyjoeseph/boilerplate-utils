import { hydrateRoot } from "react-dom/client";
import { App } from "./App";

declare global {
  interface Window {
    SERVER_SIDE_DATA: unknown;
  }
}

console.log("server data:", window.SERVER_SIDE_DATA);

const container = document.getElementById("app");
if (!container) throw new Error("#app element not found");
hydrateRoot(container, <App />);
