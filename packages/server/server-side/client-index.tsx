import { hydrateRoot } from "react-dom/client";
import { App } from "../apps/App";

declare global {
  interface Window {
    SERVER_SIDE_DATA: unknown;
  }
}
console.log(`\n\n\n${JSON.stringify(window.SERVER_SIDE_DATA)}\n\n\n`);

const container = document.getElementById("app") as HTMLElement;
hydrateRoot(container, <App /*  external={window.SERVER_SIDE_DATA as { id: string }} */ />);
