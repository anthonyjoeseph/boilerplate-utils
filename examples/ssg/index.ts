import { hydrateRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("app") as HTMLElement;
hydrateRoot(container, App);
