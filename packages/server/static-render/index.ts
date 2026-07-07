import { hydrateRoot } from "react-dom/client";
import { App } from "../apps/PlainApp";

const container = document.getElementById("app") as HTMLElement;
hydrateRoot(container, App);
